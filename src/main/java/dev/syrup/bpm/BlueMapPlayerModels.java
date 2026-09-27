package dev.syrup.bpm;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.authlib.properties.Property;
import de.bluecolored.bluemap.api.BlueMapAPI;
import de.bluecolored.bluemap.api.BlueMapMap;
import de.bluecolored.bluemap.api.BlueMapWorld;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.DyedItemColor;
import net.minecraft.world.item.equipment.Equippable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

public class BlueMapPlayerModels implements ModInitializer {
    public static final String MOD_ID = "bluemap-player-models";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private static final HttpClient HTTP_CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "BPM-IO-Worker");
        t.setDaemon(true);
        return t;
    });

    private final AtomicReference<BlueMapAPI> blueMapApi = new AtomicReference<>(null);
    private int tickCounter = 0;
    private Path playersJsonPath = null;
    private Path skinsDirPath = null;

    private final Set<String> pendingSkinDownloads = ConcurrentHashMap.newKeySet();
    private final Map<String, String> cachedSkinUrls = new ConcurrentHashMap<>();
    private final Map<String, SkinInfo> skinInfoCache = new ConcurrentHashMap<>();

    private final AtomicBoolean isWriting = new AtomicBoolean(false);
    private volatile String lastWrittenJson = "";
    private long lastWriteTime = 0;

    private String modVersion = "1.0.0";

    @Override
    public void onInitialize() {
        LOGGER.info("[BlueMap-Player-Models] Initializing...");

        FabricLoader.getInstance().getModContainer(MOD_ID).ifPresent(c ->
                this.modVersion = c.getMetadata().getVersion().getFriendlyString()
        );

        // Register BlueMap API listeners
        BlueMapAPI.onEnable(this::onBlueMapEnabled);
        BlueMapAPI.onDisable(this::onBlueMapDisabled);

        // Register Server Tick to update player positions
        ServerTickEvents.END_SERVER_TICK.register(this::onServerTick);
    }

    private void onBlueMapEnabled(BlueMapAPI api) {
        this.blueMapApi.set(api);
        LOGGER.info("[BlueMap-Player-Models] BlueMap detected! Setting up web assets...");

        try {
            Path webRoot = api.getWebApp().getWebRoot();
            Path assetDir = webRoot.resolve("assets").resolve("bluemap-player-models");
            Path scriptTarget = webRoot.resolve("bluemap-player-models").resolve("player-models.js");
            Path styleTarget = webRoot.resolve("bluemap-player-models").resolve("player-models.css");
            this.skinsDirPath = assetDir.resolve("skins");

            Files.createDirectories(assetDir);
            Files.createDirectories(skinsDirPath);
            Files.createDirectories(scriptTarget.getParent());

            // Copy bundled JS & CSS to BlueMap web root (versioned and unversioned)
            copyBundledResource("/web/player-models.js", scriptTarget);
            copyBundledResource("/web/player-models.css", styleTarget);
            // Backward-compatibility copy for legacy cached configs
            copyBundledResource("/web/player-models.js", webRoot.resolve("bluemap-player-models").resolve("player-models-v7.js"));
            copyBundledResource("/web/player-models.css", webRoot.resolve("bluemap-player-models").resolve("player-models-v7.css"));
            copyBundledResource("/web/items-registry.json", assetDir.resolve("items-registry.json"));

            // Patch index.html cleanly
            patchIndexHtml(webRoot.resolve("index.html"));

            // Extract bundled mod textures directly, then check client jar fallback
            extractBundledTextures(assetDir.resolve("textures"));
            ensureTexturesExtracted(assetDir, webRoot.getParent());

            this.playersJsonPath = assetDir.resolve("players.json");
            LOGGER.info("[BlueMap-Player-Models] Web assets registered successfully.");
        } catch (Exception e) {
            LOGGER.error("[BlueMap-Player-Models] Failed to install web assets", e);
        }
    }

    private void patchIndexHtml(Path indexPath) {
        if (!Files.exists(indexPath)) return;
        try {
            String html = Files.readString(indexPath, StandardCharsets.UTF_8);
            String versionParam = modVersion + "_" + System.currentTimeMillis() / (1000 * 3600); // changes hourly or on new version

            if (!html.contains("player-models.js?v=" + versionParam)) {
                // Strip any old player-models script or link tags
                html = html.replaceAll("(?mi)^\\s*<script[^>]*player-models[^>]*>\\s*</script>\\r?\\n?", "");
                html = html.replaceAll("(?mi)^\\s*<link[^>]*player-models[^>]*>\\r?\\n?", "");

                String tag = "  <script defer src=\"./bluemap-player-models/player-models.js?v=" + versionParam + "\"></script>\n" +
                             "  <link rel=\"stylesheet\" href=\"./bluemap-player-models/player-models.css?v=" + versionParam + "\">\n</head>";
                html = html.replace("</head>", tag);
                Files.writeString(indexPath, html, StandardCharsets.UTF_8);
                LOGGER.info("[BlueMap-Player-Models] Patched index.html with cache-busting script tags (v={}).", versionParam);
            }
        } catch (Exception e) {
            LOGGER.debug("[BlueMap-Player-Models] Failed to patch index.html", e);
        }
    }

    private void extractBundledTextures(Path targetTexturesDir) {
        try {
            FabricLoader.getInstance().getModContainer(MOD_ID).ifPresent(container -> {
                container.findPath("web/textures").ifPresent(srcDir -> {
                    try (var stream = Files.walk(srcDir)) {
                        stream.forEach(source -> {
                            try {
                                Path rel = srcDir.relativize(source);
                                Path dest = targetTexturesDir.resolve(rel.toString());
                                if (Files.isDirectory(source)) {
                                    Files.createDirectories(dest);
                                } else if (!Files.exists(dest)) {
                                    Files.createDirectories(dest.getParent());
                                    Files.copy(source, dest, StandardCopyOption.REPLACE_EXISTING);
                                }
                            } catch (Exception e) {
                                LOGGER.debug("[BlueMap-Player-Models] Error extracting texture {}", source, e);
                            }
                        });
                        LOGGER.info("[BlueMap-Player-Models] Extracted bundled textures to {}", targetTexturesDir);
                    } catch (Exception e) {
                        LOGGER.warn("[BlueMap-Player-Models] Could not walk bundled textures", e);
                    }
                });
            });
        } catch (Exception e) {
            LOGGER.warn("[BlueMap-Player-Models] Could not extract bundled textures", e);
        }
    }

    private void ensureTexturesExtracted(Path assetDir, Path bluemapDir) {
        Path texturesDir = assetDir.resolve("textures");
        Path checkBanner = texturesDir.resolve("banner").resolve("banner_base.png");
        Path checkShield = texturesDir.resolve("shield").resolve("shield_base.png");
        Path checkShulker = texturesDir.resolve("shulker").resolve("shulker_box.png");
        Path checkGlint = texturesDir.resolve("misc").resolve("enchanted_glint_item.png");
        if (Files.exists(texturesDir) && Files.exists(checkBanner) && Files.exists(checkShield) && Files.exists(checkShulker) && Files.exists(checkGlint)) return;
        try {
            Files.createDirectories(texturesDir.resolve("armor").resolve("humanoid"));
            Files.createDirectories(texturesDir.resolve("armor").resolve("humanoid_leggings"));
            Files.createDirectories(texturesDir.resolve("armor").resolve("wings"));
            Files.createDirectories(texturesDir.resolve("items"));
            Files.createDirectories(texturesDir.resolve("blocks"));
            Files.createDirectories(texturesDir.resolve("banner"));
            Files.createDirectories(texturesDir.resolve("shield"));
            Files.createDirectories(texturesDir.resolve("shulker"));
            Files.createDirectories(texturesDir.resolve("misc"));
            Files.createDirectories(texturesDir.resolve("entity").resolve("trident"));

            if (bluemapDir == null || !Files.exists(bluemapDir)) return;
            try (var stream = Files.newDirectoryStream(bluemapDir, "minecraft-client-*.jar")) {
                for (Path jarPath : stream) {
                    try (var zip = new java.util.zip.ZipFile(jarPath.toFile())) {
                        var entries = zip.entries();
                        while (entries.hasMoreElements()) {
                            var entry = entries.nextElement();
                            String name = entry.getName();
                            if (name.startsWith("assets/minecraft/textures/entity/equipment/humanoid/") && name.endsWith(".png")) {
                                String fileName = Path.of(name).getFileName().toString();
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("armor").resolve("humanoid").resolve(fileName), StandardCopyOption.REPLACE_EXISTING);
                            } else if (name.startsWith("assets/minecraft/textures/entity/equipment/humanoid_leggings/") && name.endsWith(".png")) {
                                String fileName = Path.of(name).getFileName().toString();
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("armor").resolve("humanoid_leggings").resolve(fileName), StandardCopyOption.REPLACE_EXISTING);
                            } else if (name.startsWith("assets/minecraft/textures/entity/equipment/wings/") && name.endsWith(".png")) {
                                String fileName = Path.of(name).getFileName().toString();
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("armor").resolve("wings").resolve(fileName), StandardCopyOption.REPLACE_EXISTING);
                            } else if (name.startsWith("assets/minecraft/textures/item/") && (name.endsWith(".png") || name.endsWith(".png.mcmeta"))) {
                                String fileName = Path.of(name).getFileName().toString();
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("items").resolve(fileName), StandardCopyOption.REPLACE_EXISTING);
                            } else if (name.startsWith("assets/minecraft/textures/block/") && (name.endsWith(".png") || name.endsWith(".png.mcmeta"))) {
                                String fileName = Path.of(name).getFileName().toString();
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("blocks").resolve(fileName), StandardCopyOption.REPLACE_EXISTING);
                            } else if (name.startsWith("assets/minecraft/textures/misc/") && (name.endsWith(".png") || name.endsWith(".png.mcmeta"))) {
                                String fileName = Path.of(name).getFileName().toString();
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("misc").resolve(fileName), StandardCopyOption.REPLACE_EXISTING);
                            } else if (name.startsWith("assets/minecraft/textures/entity/shield/") && name.endsWith(".png")) {
                                String fileName = Path.of(name).getFileName().toString();
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("shield").resolve(fileName), StandardCopyOption.REPLACE_EXISTING);
                                if (fileName.equals("shield_base_nopattern.png")) {
                                    try (var is2 = zip.getInputStream(entry)) {
                                        Files.copy(is2, texturesDir.resolve("items").resolve("shield.png"), StandardCopyOption.REPLACE_EXISTING);
                                    }
                                }
                            } else if (name.startsWith("assets/minecraft/textures/entity/banner/") && name.endsWith(".png")) {
                                String fileName = Path.of(name).getFileName().toString();
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("banner").resolve(fileName), StandardCopyOption.REPLACE_EXISTING);
                            } else if (name.startsWith("assets/minecraft/textures/map/decorations/") && name.endsWith("_banner.png")) {
                                String fileName = Path.of(name).getFileName().toString();
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("items").resolve(fileName), StandardCopyOption.REPLACE_EXISTING);
                            } else if (name.startsWith("assets/minecraft/textures/entity/chest/") && name.endsWith(".png")) {
                                String fileName = Path.of(name).getFileName().toString();
                                String targetName = fileName.equals("normal.png") ? "chest.png" :
                                                    fileName.equals("trapped.png") ? "trapped_chest.png" :
                                                    fileName.equals("ender.png") ? "ender_chest.png" :
                                                    fileName.equals("copper.png") ? "copper_chest.png" :
                                                    fileName.equals("copper_exposed.png") ? "exposed_copper_chest.png" :
                                                    fileName.equals("copper_weathered.png") ? "weathered_copper_chest.png" :
                                                    fileName.equals("copper_oxidized.png") ? "oxidized_copper_chest.png" : fileName;
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("blocks").resolve(targetName), StandardCopyOption.REPLACE_EXISTING);
                                try (var is2 = zip.getInputStream(entry)) {
                                    Files.copy(is2, texturesDir.resolve("items").resolve(targetName), StandardCopyOption.REPLACE_EXISTING);
                                }
                            } else if (name.startsWith("assets/minecraft/textures/entity/copper_golem/") && name.endsWith(".png")) {
                                String fileName = Path.of(name).getFileName().toString();
                                String targetName = fileName.equals("copper_golem.png") ? "copper_golem_statue.png" :
                                                    fileName.equals("copper_golem_exposed.png") ? "exposed_copper_golem_statue.png" :
                                                    fileName.equals("copper_golem_weathered.png") ? "weathered_copper_golem_statue.png" :
                                                    fileName.equals("copper_golem_oxidized.png") ? "oxidized_copper_golem_statue.png" : fileName;
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("items").resolve(targetName), StandardCopyOption.REPLACE_EXISTING);
                                try (var is2 = zip.getInputStream(entry)) {
                                    Files.copy(is2, texturesDir.resolve("blocks").resolve(targetName), StandardCopyOption.REPLACE_EXISTING);
                                }
                            } else if (name.equals("assets/minecraft/textures/entity/decorated_pot/decorated_pot_base.png")) {
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("items").resolve("decorated_pot.png"), StandardCopyOption.REPLACE_EXISTING);
                                try (var is2 = zip.getInputStream(entry)) {
                                    Files.copy(is2, texturesDir.resolve("blocks").resolve("decorated_pot.png"), StandardCopyOption.REPLACE_EXISTING);
                                }
                            } else if (name.equals("assets/minecraft/textures/entity/decorated_pot/decorated_pot_side.png")) {
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("items").resolve("decorated_pot_side.png"), StandardCopyOption.REPLACE_EXISTING);
                                try (var is2 = zip.getInputStream(entry)) {
                                    Files.copy(is2, texturesDir.resolve("blocks").resolve("decorated_pot_side.png"), StandardCopyOption.REPLACE_EXISTING);
                                }
                            } else if (name.equals("assets/minecraft/textures/entity/enderdragon/dragon.png")) {
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("items").resolve("dragon_head.png"), StandardCopyOption.REPLACE_EXISTING);
                            } else if (name.equals("assets/minecraft/textures/entity/piglin/piglin.png")) {
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("items").resolve("piglin_head.png"), StandardCopyOption.REPLACE_EXISTING);
                            } else if (name.equals("assets/minecraft/textures/entity/creeper/creeper.png")) {
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("items").resolve("creeper_head.png"), StandardCopyOption.REPLACE_EXISTING);
                            } else if (name.equals("assets/minecraft/textures/entity/skeleton/skeleton.png")) {
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("items").resolve("skeleton_skull.png"), StandardCopyOption.REPLACE_EXISTING);
                            } else if (name.equals("assets/minecraft/textures/entity/skeleton/wither_skeleton.png")) {
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("items").resolve("wither_skeleton_skull.png"), StandardCopyOption.REPLACE_EXISTING);
                            } else if (name.equals("assets/minecraft/textures/entity/zombie/zombie.png")) {
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("items").resolve("zombie_head.png"), StandardCopyOption.REPLACE_EXISTING);
                            } else if (name.startsWith("assets/minecraft/textures/entity/shulker/shulker") && name.endsWith(".png")) {
                                String fileName = Path.of(name).getFileName().toString();
                                String color = fileName.replace("shulker_", "").replace(".png", "");
                                String targetName = fileName.equals("shulker.png") ? "shulker_box.png" : color + "_shulker_box.png";
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("shulker").resolve(targetName), StandardCopyOption.REPLACE_EXISTING);
                            } else if (name.equals("assets/minecraft/textures/entity/trident/trident.png")) {
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("entity").resolve("trident").resolve("trident.png"), StandardCopyOption.REPLACE_EXISTING);
                                try (var is2 = zip.getInputStream(entry)) {
                                    Files.copy(is2, texturesDir.resolve("items").resolve("trident_entity.png"), StandardCopyOption.REPLACE_EXISTING);
                                }
                            } else if (name.equals("assets/minecraft/textures/entity/conduit/base.png")) {
                                Files.createDirectories(texturesDir.resolve("entity").resolve("conduit"));
                                Files.copy(zip.getInputStream(entry), texturesDir.resolve("entity").resolve("conduit").resolve("base.png"), StandardCopyOption.REPLACE_EXISTING);
                                try (var is2 = zip.getInputStream(entry)) {
                                    Files.copy(is2, texturesDir.resolve("items").resolve("conduit.png"), StandardCopyOption.REPLACE_EXISTING);
                                }
                            }
                        }
                    }
                    LOGGER.info("[BlueMap-Player-Models] Extracted textures from {}", jarPath.getFileName());
                    break;
                }
            }
        } catch (Exception e) {
            LOGGER.warn("[BlueMap-Player-Models] Could not auto-extract textures from client jar", e);
        }
    }

    private void onBlueMapDisabled(BlueMapAPI api) {
        this.blueMapApi.set(null);
        this.playersJsonPath = null;
        this.skinsDirPath = null;
        this.cachedSkinUrls.clear();
        this.pendingSkinDownloads.clear();
        this.skinInfoCache.clear();
        LOGGER.info("[BlueMap-Player-Models] BlueMap disabled.");
    }

    private void onServerTick(MinecraftServer server) {
        BlueMapAPI api = this.blueMapApi.get();
        if (api == null || this.playersJsonPath == null) {
            return;
        }

        // Update every 10 ticks (0.5s)
        if (++tickCounter % 10 != 0) {
            return;
        }

        List<PlayerData> playersData = new ArrayList<>();

        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            // Check player visibility in BlueMap
            if (!api.getWebApp().getPlayerVisibility(player.getUUID())) {
                continue;
            }

            // Privacy check: skip invisible or spectator players
            if (player.isInvisible() || player.isSpectator()) {
                continue;
            }

            SkinInfo skinInfo = extractSkinInfo(player);
            String skinUrl = skinInfo != null ? skinInfo.url : null;
            boolean isSlim = skinInfo != null ? skinInfo.slim : ((player.getUUID().hashCode() & 1) != 0);
            String localSkinUrl = null;

            if (skinUrl != null) {
                cacheSkinLocally(skinUrl, player.getStringUUID());
                if (cachedSkinUrls.containsKey(player.getStringUUID())) {
                    localSkinUrl = "assets/bluemap-player-models/skins/" + player.getStringUUID() + ".png";
                }
            }

            boolean isMoving = player.getDeltaMovement().horizontalDistanceSqr() > 0.0004;
            boolean isSitting = player.isPassenger() || player.getPose() == net.minecraft.world.entity.Pose.SITTING;
            String vehicle = (player.isPassenger() && player.getVehicle() != null)
                    ? BuiltInRegistries.ENTITY_TYPE.getKey(player.getVehicle().getType()).toString()
                    : null;
            boolean isSleeping = player.isSleeping();
            net.minecraft.core.Direction bedOrientation = player.getBedOrientation();
            String sleepDirection = bedOrientation != null ? bedOrientation.getName() : null;

            String dimension = player.level().dimension().identifier().toString();
            List<String> mapIds = api.getWorld(player.level())
                    .map(w -> w.getMaps().stream().map(BlueMapMap::getId).toList())
                    .orElse(List.of());

            Long worldTime = null;
            if ("minecraft:overworld".equals(dimension)) {
                long t = player.level().getOverworldClockTime() % 24000L;
                if (t < 0) t += 24000L;
                worldTime = t;
            }

            PlayerEquipment equipment = new PlayerEquipment(
                extractEquipmentItem(player, player.getMainHandItem()),
                extractEquipmentItem(player, player.getOffhandItem()),
                extractEquipmentItem(player, player.getItemBySlot(EquipmentSlot.HEAD)),
                extractEquipmentItem(player, player.getItemBySlot(EquipmentSlot.CHEST)),
                extractEquipmentItem(player, player.getItemBySlot(EquipmentSlot.LEGS)),
                extractEquipmentItem(player, player.getItemBySlot(EquipmentSlot.FEET))
            );

            PlayerData data = new PlayerData(
                player.getStringUUID(),
                player.getGameProfile().name(),
                player.getX(),
                player.getY(),
                player.getZ(),
                player.getYRot(),      // Body yaw
                player.getYHeadRot(),  // Head yaw
                player.getXRot(),      // Pitch
                isMoving,
                player.isCrouching(),
                player.isSprinting(),
                player.isFallFlying(),
                player.isSwimming(),
                isSleeping,
                isSitting,
                vehicle,
                sleepDirection,
                player.getHealth(),
                player.getMaxHealth(),
                skinUrl,
                localSkinUrl,
                isSlim,
                dimension,
                mapIds,
                equipment,
                worldTime
            );

            playersData.add(data);
        }

        // Write players.json asynchronously with change detection & heartbeat
        String json = GSON.toJson(playersData);
        long now = System.currentTimeMillis();

        if (json.equals(lastWrittenJson) && (now - lastWriteTime < 5000)) {
            return;
        }

        if (isWriting.compareAndSet(false, true)) {
            lastWrittenJson = json;
            lastWriteTime = now;
            ioExecutor.submit(() -> {
                try {
                    Path tempFile = playersJsonPath.resolveSibling(playersJsonPath.getFileName() + ".tmp");
                    Files.writeString(tempFile, json, StandardCharsets.UTF_8);
                    Files.move(tempFile, playersJsonPath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                } catch (IOException e) {
                    LOGGER.debug("[BlueMap-Player-Models] Error writing players.json", e);
                } finally {
                    isWriting.set(false);
                }
            });
        }
    }

    private EquipmentItem extractEquipmentItem(ServerPlayer player, ItemStack stack) {
        if (stack == null || stack.isEmpty()) return null;
        String id = BuiltInRegistries.ITEM.getKey(stack.getItem()).toString();
        boolean isBlock = stack.getItem() instanceof BlockItem;
        String asset = null;
        try {
            Equippable equippable = stack.get(DataComponents.EQUIPPABLE);
            if (equippable != null && equippable.assetId().isPresent()) {
                asset = equippable.assetId().get().identifier().getPath();
            }
        } catch (Throwable ignored) {}

        if (asset == null) {
            String path = BuiltInRegistries.ITEM.getKey(stack.getItem()).getPath();
            int idx = path.lastIndexOf('_');
            if (idx > 0) {
                asset = path.substring(0, idx);
            }
        }

        // Standardize asset name mapping for armor sheets
        if ("golden".equals(asset)) {
            asset = "gold";
        } else if ("turtle".equals(asset)) {
            asset = "turtle_scute";
        }

        try {
            net.minecraft.world.item.component.ResolvableProfile profile = stack.get(DataComponents.PROFILE);
            if (profile != null) {
                com.mojang.authlib.GameProfile gp = profile.partialProfile();
                if (gp != null) {
                    for (Property property : gp.properties().get("textures")) {
                        SkinInfo info = skinInfoCache.computeIfAbsent(property.value(), this::parseSkinJson);
                        if (info != null && info.url != null) {
                            asset = info.url;
                        }
                    }
                }
            }
        } catch (Throwable ignored) {}

        Integer color = null;
        try {
            DyedItemColor dyedColor = stack.get(DataComponents.DYED_COLOR);
            if (dyedColor != null) {
                color = dyedColor.rgb();
            } else if ("leather".equals(asset)) {
                color = 0xA06540;
            } else {
                net.minecraft.world.item.alchemy.PotionContents potionContents = stack.get(DataComponents.POTION_CONTENTS);
                if (potionContents != null) {
                    color = potionContents.getColor();
                }
            }
        } catch (Throwable ignored) {}

        List<BannerPatternData> patterns = null;
        try {
            net.minecraft.world.level.block.entity.BannerPatternLayers bannerLayers = stack.get(DataComponents.BANNER_PATTERNS);
            if (bannerLayers != null && !bannerLayers.layers().isEmpty()) {
                patterns = new ArrayList<>();
                for (net.minecraft.world.level.block.entity.BannerPatternLayers.Layer layer : bannerLayers.layers()) {
                    String pat = layer.pattern().value().assetId().getPath();
                    String col = layer.color().getName();
                    patterns.add(new BannerPatternData(pat, col));
                }
            }
        } catch (Throwable ignored) {}

        String baseColor = null;
        try {
            net.minecraft.world.item.DyeColor dye = stack.get(DataComponents.BASE_COLOR);
            if (dye != null) {
                baseColor = dye.getName();
            }
        } catch (Throwable ignored) {}

        if (baseColor == null && id.endsWith("_banner")) {
            String colorName = id.substring(id.indexOf(':') + 1);
            if (colorName.endsWith("_banner")) {
                baseColor = colorName.substring(0, colorName.length() - "_banner".length());
            }
        }

        int[] targetPos = null;
        if ("minecraft:compass".equals(id)) {
            try {
                net.minecraft.world.item.component.LodestoneTracker tracker = stack.get(DataComponents.LODESTONE_TRACKER);
                if (tracker != null && tracker.target().isPresent()) {
                    net.minecraft.core.GlobalPos gp = tracker.target().get();
                    if (gp.dimension().equals(player.level().dimension())) {
                        targetPos = new int[]{ gp.pos().getX(), gp.pos().getZ() };
                    }
                } else if ("minecraft:overworld".equals(player.level().dimension().identifier().toString())) {
                    net.minecraft.core.BlockPos spawn = player.level().getRespawnData().pos();
                    if (spawn != null) {
                        targetPos = new int[]{ spawn.getX(), spawn.getZ() };
                    }
                }
            } catch (Throwable ignored) {}
        } else if ("minecraft:recovery_compass".equals(id)) {
            try {
                var deathLoc = player.getLastDeathLocation();
                if (deathLoc.isPresent()) {
                    net.minecraft.core.GlobalPos gp = deathLoc.get();
                    if (gp.dimension().equals(player.level().dimension())) {
                        targetPos = new int[]{ gp.pos().getX(), gp.pos().getZ() };
                    }
                }
            } catch (Throwable ignored) {}
        }
        if ("minecraft:light".equals(id)) {
            int lvl = 15;
            try {
                net.minecraft.world.item.component.BlockItemStateProperties blockState = stack.get(DataComponents.BLOCK_STATE);
                if (blockState != null && blockState.properties().containsKey("level")) {
                    lvl = Integer.parseInt(blockState.properties().get("level"));
                }
            } catch (Throwable ignored) {}
            asset = "light_" + String.format("%02d", lvl);
        } else if ("minecraft:test_block".equals(id)) {
            String mode = "start";
            try {
                net.minecraft.world.item.component.BlockItemStateProperties blockState = stack.get(DataComponents.BLOCK_STATE);
                if (blockState != null && blockState.properties().containsKey("mode")) {
                    mode = blockState.properties().get("mode").toLowerCase(Locale.ROOT);
                }
            } catch (Throwable ignored) {}
            asset = "test_block_" + mode;
        }

        boolean enchanted = stack.hasFoil();

        return new EquipmentItem(id, asset, color, stack.getCount(), isBlock, patterns, baseColor, targetPos, enchanted);
    }

    public static class SkinInfo {
        public String url;
        public boolean slim;
    }

    private SkinInfo extractSkinInfo(ServerPlayer player) {
        for (Property property : player.getGameProfile().properties().get("textures")) {
            SkinInfo info = skinInfoCache.computeIfAbsent(property.value(), this::parseSkinJson);
            if (info != null) {
                return info;
            }
        }
        return null;
    }

    private SkinInfo parseSkinJson(String base64Value) {
        try {
            String decoded = new String(Base64.getDecoder().decode(base64Value), StandardCharsets.UTF_8);
            JsonObject json = JsonParser.parseString(decoded).getAsJsonObject();
            if (json.has("textures")) {
                JsonObject textures = json.getAsJsonObject("textures");
                if (textures.has("SKIN")) {
                    JsonObject skin = textures.getAsJsonObject("SKIN");
                    SkinInfo info = new SkinInfo();
                    if (skin.has("url")) {
                        String url = skin.get("url").getAsString();
                        if (url.startsWith("http://")) {
                            url = "https://" + url.substring(7);
                        }
                        info.url = url;
                    }
                    if (skin.has("metadata")) {
                        JsonObject metadata = skin.getAsJsonObject("metadata");
                        if (metadata.has("model") && "slim".equalsIgnoreCase(metadata.get("model").getAsString())) {
                            info.slim = true;
                        }
                    }
                    return info;
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private void cacheSkinLocally(String skinUrl, String uuid) {
        if (skinsDirPath == null || skinUrl == null) return;
        Path target = skinsDirPath.resolve(uuid + ".png");

        String prevUrl = cachedSkinUrls.get(uuid);
        if (prevUrl != null && prevUrl.equals(skinUrl)) {
            return;
        }

        if (prevUrl == null && Files.exists(target)) {
            cachedSkinUrls.put(uuid, skinUrl);
            return;
        }

        if (!pendingSkinDownloads.add(uuid)) {
            return; // Download already in progress
        }

        ioExecutor.submit(() -> {
            try {
                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(skinUrl))
                        .timeout(Duration.ofSeconds(10))
                        .GET()
                        .build();
                HttpResponse<InputStream> response = HTTP_CLIENT.send(request, HttpResponse.BodyHandlers.ofInputStream());
                if (response.statusCode() == 200) {
                    Path temp = target.resolveSibling(target.getFileName() + ".tmp." + System.currentTimeMillis());
                    try (InputStream in = response.body()) {
                        Files.copy(in, temp, StandardCopyOption.REPLACE_EXISTING);
                    }
                    Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                    cachedSkinUrls.put(uuid, skinUrl);
                }
            } catch (Exception e) {
                LOGGER.debug("[BlueMap-Player-Models] Failed to cache skin for {}", uuid, e);
            } finally {
                pendingSkinDownloads.remove(uuid);
            }
        });
    }

    private void copyBundledResource(String resourcePath, Path target) throws IOException {
        try (InputStream stream = getClass().getResourceAsStream(resourcePath)) {
            if (stream == null) {
                LOGGER.warn("[BlueMap-Player-Models] Resource not found: {}", resourcePath);
                return;
            }
            Files.createDirectories(target.getParent());
            Files.copy(stream, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    public static record BannerPatternData(
        String pattern,
        String color
    ) {}

    public static record EquipmentItem(
        String id,
        String asset,
        Integer color,
        int count,
        boolean isBlock,
        List<BannerPatternData> patterns,
        String baseColor,
        int[] targetPos,
        boolean enchanted
    ) {}

    public static record PlayerEquipment(
        EquipmentItem mainHand,
        EquipmentItem offHand,
        EquipmentItem head,
        EquipmentItem chest,
        EquipmentItem legs,
        EquipmentItem feet
    ) {}

    public static record PlayerData(
        String uuid,
        String name,
        double x,
        double y,
        double z,
        float yaw,
        float headYaw,
        float pitch,
        boolean moving,
        boolean crouching,
        boolean sprinting,
        boolean fallFlying,
        boolean swimming,
        boolean sleeping,
        boolean sitting,
        String vehicle,
        String sleepDirection,
        float health,
        float maxHealth,
        String skinUrl,
        String localSkinUrl,
        boolean slim,
        String dimension,
        List<String> maps,
        PlayerEquipment equipment,
        Long worldTime
    ) {}
}
