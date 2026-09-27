/**
 * BlueMap 3D Player Models
 * Renders full 3D Minecraft player models in BlueMap's Three.js scene.
 * Includes Alex/Steve models, skin layers, armor rendering, and held items.
 */
(() => {
    "use strict";

    if (window.__blueMapPlayerModelsActive) {
        console.warn("[BlueMap-Player-Models] Already loaded, skipping duplicate execution.");
        return;
    }
    window.__blueMapPlayerModelsActive = true;
    window.__blueMapPlayerModelsV7 = true;
    window.__blueMapPlayerModelsV6 = true;
    window.__blueMapPlayerModelsV5 = true;

    const PIXEL = 1 / 16;
    const DATA_PATH = "assets/bluemap-player-models/players.json";
    const POLL_INTERVAL = 1000;

    // Face UV regions for a Minecraft cuboid: [Right, Left, Top, Bottom, Front, Back]
    const boxRegions = (x, y, width, height, depth) => [
        [x + depth + width, y + depth, depth, height],       // Right (+X)
        [x, y + depth, depth, height],                       // Left (-X)
        [x + depth, y, width, depth],                        // Top (+Y)
        [x + depth + width, y, width, depth],                // Bottom (-Y)
        [x + depth, y + depth, width, height],               // Front (+Z)
        [x + depth * 2 + width, y + depth, width, height]    // Back (-Z)
    ];

    function createBoxGeometry(Three, width, height, depth, uv, inflate = 0, textureHeight = 64, textureWidth = 64, mirror = false) {
        const geometry = new Three.BoxGeometry(
            (width + inflate * 2) * PIXEL,
            (height + inflate * 2) * PIXEL,
            (depth + inflate * 2) * PIXEL
        );
        const u = uv[0], v = uv[1];
        const regions = mirror ? [
            [u, v + depth, depth, height],                    // 0: +X gets -X texture
            [u + depth + width, v + depth, depth, height],    // 1: -X gets +X texture
            [u + depth, v, width, depth],                     // 2: +Y (Top)
            [u + depth + width, v, width, depth],             // 3: -Y (Bottom)
            [u + depth, v + depth, width, height],            // 4: +Z (Front)
            [u + depth * 2 + width, v + depth, width, height] // 5: -Z (Back)
        ] : [
            [u + depth + width, v + depth, depth, height],    // 0: +X
            [u, v + depth, depth, height],                    // 1: -X
            [u + depth, v, width, depth],                     // 2: +Y
            [u + depth + width, v, width, depth],             // 3: -Y
            [u + depth, v + depth, width, height],            // 4: +Z
            [u + depth * 2 + width, v + depth, width, height] // 5: -Z
        ];
        const attribute = geometry.attributes.uv;
        const epsU = 0.02 / textureWidth;
        const epsV = 0.02 / textureHeight;

        regions.forEach(([rx, ry, rWidth, rHeight], face) => {
            let left = (rx / textureWidth) + epsU;
            let right = ((rx + rWidth) / textureWidth) - epsU;
            if (mirror) {
                const tmp = left;
                left = right;
                right = tmp;
            }
            const top = 1 - (ry / textureHeight) - epsV;
            const bottom = 1 - ((ry + rHeight) / textureHeight) + epsV;
            const index = face * 4;

            attribute.setXY(index, left, top);
            attribute.setXY(index + 1, right, top);
            attribute.setXY(index + 2, left, bottom);
            attribute.setXY(index + 3, right, bottom);
        });

        attribute.needsUpdate = true;
        return geometry;
    }

    function createArmorArmGeometry(Three, armWidth = 4, isLeft = false, inflate = 0.55) {
        // In Minecraft, chestplate arm only covers the sleeve (rows 20 to 26, upper 6 pixels of the arm).
        // It does NOT cover the forearm (rows 26 to 32 are 100% transparent in armor textures).
        // Restricting the sleeve to height 6 (local Y in [-4, 2] * PIXEL) completely eliminates floating transparent artifacts.
        // In vanilla Minecraft (HumanoidArmorModel), armor arms are always 4 pixels wide on both Steve and Alex models,
        // ensuring square shoulder plates and exact 1:1 pixel mapping with the standard 64x32 armor texture sheet.
        const width = 4;
        const sleeveHeight = 6;
        const geometry = new Three.BoxGeometry(
            (width + inflate * 2) * PIXEL,
            sleeveHeight * PIXEL,
            (4 + inflate * 2) * PIXEL
        );

        // Adjust top Y bounds: shoulder is at local Y = +2 * PIXEL, elbow is at local Y = -4 * PIXEL.
        // Center before translate is at local Y = -1 * PIXEL.
        const pos = geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            // Top face (+Y): inflate upwards by inflate
            if (y > 0) pos.setY(i, (sleeveHeight / 2 + inflate) * PIXEL);
        }
        pos.needsUpdate = true;

        geometry.translate(0, -1 * PIXEL, 0);

        // Armor sheet arm texture layout (standard 4-wide layout on 64x32 armor sheet):
        // Outer: [40, 44], Front: [44, 48], Inner: [48, 52], Back: [52, 56]
        // Top shoulder cap: rows 16 to 20, u in [44, 48]
        // Bottom: open sleeve cuff (transparent region [0, 4, 0, 4])
        // Side sleeve rows: 20 to 26 (height 6)
        const uOuter = [40, 44];
        const uFront = [44, 48];
        const uInner = [48, 52];
        const uBack = [52, 56];
        const uTop = [44, 48];
        const vSide = [20, 26];
        const vTop = [16, 20];

        let faceDefs;
        if (!isLeft) {
            // Right arm: +X is Inner, -X is Outer
            faceDefs = [
                { u: uInner,  v: vSide, flipU: false }, // 0: +X (Inner)
                { u: uOuter,  v: vSide, flipU: false }, // 1: -X (Outer)
                { u: uTop,    v: vTop,  flipU: false }, // 2: +Y (Top)
                { u: [0, 4],  v: [0, 4],flipU: false }, // 3: -Y (Bottom, open)
                { u: uFront,  v: vSide, flipU: false }, // 4: +Z (Front)
                { u: uBack,   v: vSide, flipU: false }  // 5: -Z (Back)
            ];
        } else {
            // Left arm (mirrored across X): +X is Outer, -X is Inner
            faceDefs = [
                { u: uOuter,  v: vSide, flipU: true },  // 0: +X (Outer)
                { u: uInner,  v: vSide, flipU: true },  // 1: -X (Inner)
                { u: uTop,    v: vTop,  flipU: true },  // 2: +Y (Top)
                { u: [0, 4],  v: [0, 4],flipU: true },  // 3: -Y (Bottom, open)
                { u: uFront,  v: vSide, flipU: true },  // 4: +Z (Front)
                { u: uBack,   v: vSide, flipU: true }   // 5: -Z (Back)
            ];
        }

        const attribute = geometry.attributes.uv;
        const epsU = 0.05 / 64;
        const epsV = 0.05 / 32;

        faceDefs.forEach((def, face) => {
            let left = (def.u[0] / 64) + epsU;
            let right = (def.u[1] / 64) - epsU;
            if (def.flipU) {
                const tmp = left;
                left = right;
                right = tmp;
            }
            const top = 1 - (def.v[0] / 32) - epsV;
            const bottom = 1 - (def.v[1] / 32) + epsV;
            const index = face * 4;

            attribute.setXY(index, left, top);
            attribute.setXY(index + 1, right, top);
            attribute.setXY(index + 2, left, bottom);
            attribute.setXY(index + 3, right, bottom);
        });

        attribute.needsUpdate = true;
        return geometry;
    }

    function createArmorLegGeometry(Three, isLeft = false, inflate = 0.32) {
        // Leggings only cover the upper 9 pixels of the leg (rows 20 to 29 on 64x32 armor sheet).
        // Rows 29 to 32 (ankles) are empty on leggings and covered by boots.
        // Restricting leggings to height 9 eliminates transparent ankle geometry that bleeds neighbor texels.
        const legHeight = 9;
        const geometry = new Three.BoxGeometry(
            (4 + inflate * 2) * PIXEL,
            legHeight * PIXEL,
            (4 + inflate * 2) * PIXEL
        );

        const pos = geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            // Top face: extend upwards into belt to prevent seam gap during walking swings
            if (y > 0) pos.setY(i, (legHeight / 2 + 0.6) * PIXEL);
            // Bottom face: extend downwards by inflate
            if (y < 0) pos.setY(i, (-legHeight / 2 - inflate) * PIXEL);
        }
        pos.needsUpdate = true;

        geometry.translate(0, -4.5 * PIXEL, 0);

        // On 64x32 armor sheet, leg texture layout for rows 20 to 29:
        // Outer: [0, 4], Front: [4, 8], Inner: [8, 12], Back: [12, 16]
        // Top cap: rows 16 to 20, u in [4, 8]
        // Bottom: open cuff (transparent region [0, 4, 0, 4])
        const uOuter = [0, 4], uFront = [4, 8], uInner = [8, 12], uBack = [12, 16];
        const uTop = [4, 8];
        const vSide = [20, 29];
        const vTop = [16, 20];

        let faceDefs;
        if (!isLeft) {
            // Right leg: +X is Inner, -X is Outer
            faceDefs = [
                { u: uInner,  v: vSide, flipU: false }, // 0: +X (Inner)
                { u: uOuter,  v: vSide, flipU: false }, // 1: -X (Outer)
                { u: uTop,    v: vTop,  flipU: false }, // 2: +Y (Top)
                { u: [0, 4],  v: [0, 4],flipU: false }, // 3: -Y (Bottom, open)
                { u: uFront,  v: vSide, flipU: false }, // 4: +Z (Front)
                { u: uBack,   v: vSide, flipU: false }  // 5: -Z (Back)
            ];
        } else {
            // Left leg (mirrored across X): +X is Outer, -X is Inner
            faceDefs = [
                { u: uOuter,  v: vSide, flipU: true },  // 0: +X (Outer)
                { u: uInner,  v: vSide, flipU: true },  // 1: -X (Inner)
                { u: uTop,    v: vTop,  flipU: true },  // 2: +Y (Top)
                { u: [0, 4],  v: [0, 4],flipU: true },  // 3: -Y (Bottom, open)
                { u: uFront,  v: vSide, flipU: true },  // 4: +Z (Front)
                { u: uBack,   v: vSide, flipU: true }   // 5: -Z (Back)
            ];
        }

        const attribute = geometry.attributes.uv;
        const epsU = 0.05 / 64;
        const epsV = 0.05 / 32;

        faceDefs.forEach((def, face) => {
            let left = (def.u[0] / 64) + epsU;
            let right = (def.u[1] / 64) - epsU;
            if (def.flipU) {
                const tmp = left;
                left = right;
                right = tmp;
            }
            const top = 1 - (def.v[0] / 32) - epsV;
            const bottom = 1 - (def.v[1] / 32) + epsV;
            const index = face * 4;

            attribute.setXY(index, left, top);
            attribute.setXY(index + 1, right, top);
            attribute.setXY(index + 2, left, bottom);
            attribute.setXY(index + 3, right, bottom);
        });

        attribute.needsUpdate = true;
        return geometry;
    }

    function createLeggingsBeltGeometry(Three, inflate = 0.38) {
        // Torso waist covers bottom 5 pixels (rows 27 to 32 on 64x32 armor sheet).
        // In local torso space (origin at Y = 18 * PIXEL, torso height 12 spanning Y in [-6, 6] * PIXEL):
        // Waist spans local Y in [-6, -1] * PIXEL.
        // To overlap with legs and prevent gap during leg swings, extend belt downward by 0.6 pixels (height 5.6).
        const beltHeight = 5.6;
        const geometry = new Three.BoxGeometry(
            (8 + inflate * 2) * PIXEL,
            beltHeight * PIXEL,
            (4 + inflate * 2) * PIXEL
        );
        geometry.translate(0, -3.8 * PIXEL, 0);

        // Torso UV layout for rows 27 to 32:
        // Right (+X): [16, 20]
        // Left (-X):  [28, 32]
        // Top (+Y) / Bottom (-Y): map to transparent region [0, 4, 0, 4] so no caps bleed
        // Front (+Z): [20, 28]
        // Back (-Z):  [32, 40]
        const faceDefs = [
            { u: [16, 20], v: [27, 32] }, // 0: +X
            { u: [28, 32], v: [27, 32] }, // 1: -X
            { u: [0, 4],   v: [0, 4] },   // 2: +Y (transparent)
            { u: [0, 4],   v: [0, 4] },   // 3: -Y (transparent)
            { u: [20, 28], v: [27, 32] }, // 4: +Z
            { u: [32, 40], v: [27, 32] }  // 5: -Z
        ];

        const attribute = geometry.attributes.uv;
        const epsU = 0.02 / 64;
        const epsV = 0.02 / 32;

        faceDefs.forEach((def, face) => {
            const left = (def.u[0] / 64) + epsU;
            const right = (def.u[1] / 64) - epsU;
            const top = 1 - (def.v[0] / 32) - epsV;
            const bottom = 1 - (def.v[1] / 32) + epsV;
            const index = face * 4;

            attribute.setXY(index, left, top);
            attribute.setXY(index + 1, right, top);
            attribute.setXY(index + 2, left, bottom);
            attribute.setXY(index + 3, right, bottom);
        });

        attribute.needsUpdate = true;
        return geometry;
    }

    function createArmorBootGeometry(Three, isLeft = false, inflate = 0.6) {
        // Boots only cover the bottom 6 pixels of the leg (rows 26 to 32 on 64x32 armor sheet).
        // In local leg space (origin at Y = 12 * PIXEL, leg height 12 spanning Y in [-12, 0] * PIXEL):
        // Boots span local Y in [-12 - inflate, -6] * PIXEL (height 6 + inflate).
        // Center is Y = -9 * PIXEL.
        const geometry = new Three.BoxGeometry(
            (4 + inflate * 2) * PIXEL,
            6 * PIXEL,
            (4 + inflate * 2) * PIXEL
        );

        const pos = geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            // Bottom face: extend downwards by inflate
            if (y < 0) pos.setY(i, (-3 - inflate) * PIXEL);
        }
        pos.needsUpdate = true;

        geometry.translate(0, -9 * PIXEL, 0);

        // Boot UV layout for rows 26 to 32:
        // Outer: [0, 4]
        // Front: [4, 8]
        // Inner: [8, 12]
        // Back:  [12, 16]
        // Bottom sole: [8, 12, 16, 20]
        // Top: transparent region [0, 4, 0, 4]
        const uOuter = [0, 4], uFront = [4, 8], uInner = [8, 12], uBack = [12, 16];
        const uBottom = [8, 12];
        const vSide = [26, 32], vBottom = [16, 20];

        let faceDefs;
        if (!isLeft) {
            faceDefs = [
                { u: uInner,  v: vSide,   flipU: false }, // 0: +X (Inner)
                { u: uOuter,  v: vSide,   flipU: false }, // 1: -X (Outer)
                { u: [0, 4],  v: [0, 4],  flipU: false }, // 2: +Y (Top, transparent)
                { u: uBottom, v: vBottom, flipU: false }, // 3: -Y (Bottom sole)
                { u: uFront,  v: vSide,   flipU: false }, // 4: +Z (Front)
                { u: uBack,   v: vSide,   flipU: false }  // 5: -Z (Back)
            ];
        } else {
            faceDefs = [
                { u: uOuter,  v: vSide,   flipU: true },  // 0: +X (Outer)
                { u: uInner,  v: vSide,   flipU: true },  // 1: -X (Inner)
                { u: [0, 4],  v: [0, 4],  flipU: true },  // 2: +Y (Top, transparent)
                { u: uBottom, v: vBottom, flipU: true },  // 3: -Y (Bottom sole)
                { u: uFront,  v: vSide,   flipU: true },  // 4: +Z (Front)
                { u: uBack,   v: vSide,   flipU: true }   // 5: -Z (Back)
            ];
        }

        const attribute = geometry.attributes.uv;
        const epsU = 0.02 / 64;
        const epsV = 0.02 / 32;

        faceDefs.forEach((def, face) => {
            let left = (def.u[0] / 64) + epsU;
            let right = (def.u[1] / 64) - epsU;
            if (def.flipU) {
                const tmp = left;
                left = right;
                right = tmp;
            }
            const top = 1 - (def.v[0] / 32) - epsV;
            const bottom = 1 - (def.v[1] / 32) + epsV;
            const index = face * 4;

            attribute.setXY(index, left, top);
            attribute.setXY(index + 1, right, top);
            attribute.setXY(index + 2, left, bottom);
            attribute.setXY(index + 3, right, bottom);
        });

        attribute.needsUpdate = true;
        return geometry;
    }

    function createMinecraftEntityBoxGeometry(Three, width, height, depth, uv, inflate = 0, textureHeight = 64, textureWidth = 64, flipV = false) {
        const geometry = new Three.BoxGeometry(
            (width + inflate * 2) * PIXEL,
            (height + inflate * 2) * PIXEL,
            (depth + inflate * 2) * PIXEL
        );

        const u = uv[0], v = uv[1];
        const u0 = u;
        const u1 = u + depth;
        const u2 = u + depth + width;
        const u3 = u + 2 * depth + width;
        const u4 = u + 2 * depth + 2 * width;

        // Top/Bottom faces use width x depth
        const ut0 = u + depth;
        const ut1 = u + depth + width;
        const ut2 = u + depth + 2 * width;

        const v0 = v;
        const v1 = v + depth;
        const v2 = v + depth + height;

        const toU = (px) => px / textureWidth;
        const toV = (py) => 1.0 - (py / textureHeight);

        // When flipV is true, side face top vertices (+Y in Three.js) get v2 and bottom vertices (-Y) get v1
        const vTop = flipV ? v2 : v1;
        const vBot = flipV ? v1 : v2;

        // Exact Minecraft ModelPart$Cube face-to-vertex UV mappings:
        // Three.js BoxGeometry face order: 0:+X(East), 1:-X(West), 2:+Y(Top), 3:-Y(Bottom), 4:+Z(South/Front), 5:-Z(North/Back)
        const faceUVs = [
            // Face 0 (+X, East)
            [ [u2, vTop], [u3, vTop], [u2, vBot], [u3, vBot] ],
            // Face 1 (-X, West)
            [ [u0, vTop], [u1, vTop], [u0, vBot], [u1, vBot] ],
            // Face 2 (+Y, Top)
            [ [ut2, v1], [ut1, v1], [ut2, v0], [ut1, v0] ],
            // Face 3 (-Y, Bottom)
            [ [ut1, v0], [ut0, v0], [ut1, v1], [ut0, v1] ],
            // Face 4 (+Z, South / Front)
            [ [u3, vTop], [u4, vTop], [u3, vBot], [u4, vBot] ],
            // Face 5 (-Z, North / Back)
            [ [u1, vTop], [u2, vTop], [u1, vBot], [u2, vBot] ]
        ];

        const attribute = geometry.attributes.uv;
        const epsU = 0.02;
        const epsV = 0.02;

        faceUVs.forEach((verts, faceIdx) => {
            const baseIdx = faceIdx * 4;
            const uMin = Math.min(verts[0][0], verts[1][0], verts[2][0], verts[3][0]);
            const uMax = Math.max(verts[0][0], verts[1][0], verts[2][0], verts[3][0]);
            const vMin = Math.min(verts[0][1], verts[1][1], verts[2][1], verts[3][1]);
            const vMax = Math.max(verts[0][1], verts[1][1], verts[2][1], verts[3][1]);

            for (let i = 0; i < 4; i++) {
                let uCoord = verts[i][0];
                let vCoord = verts[i][1];
                if (uCoord === uMin) uCoord += epsU;
                else if (uCoord === uMax) uCoord -= epsU;
                if (vCoord === vMin) vCoord += epsV;
                else if (vCoord === vMax) vCoord -= epsV;
                attribute.setXY(baseIdx + i, toU(uCoord), toV(vCoord));
            }
        });

        attribute.needsUpdate = true;
        return geometry;
    }

    function createShulkerPartGeometry(Three, width, height, depth, uv, isLid = false) {
        const geometry = new Three.BoxGeometry(
            (width + (isLid ? 0.02 : 0)) * PIXEL,
            (height + (isLid ? 0.02 : 0)) * PIXEL,
            (depth + (isLid ? 0.02 : 0)) * PIXEL
        );
        const u = uv[0], v = uv[1];
        const u0 = u, u1 = u + depth, u2 = u + depth + width, u3 = u + 2 * depth + width, u4 = u + 2 * depth + 2 * width;
        const v0 = v, v1 = v + depth, v2 = v + depth + height;
        const toU = (px) => px / 64;
        const toV = (py) => 1.0 - (py / 64);

        // In authentic Shulker texture sheet:
        // Lid top (+Y) is [u1..u2, v0..v1] (16..32, 0..16)
        // Base bottom (-Y) is [u2..u3, v0..v1] (32..48, 28..44)
        const topVerts = isLid ? [ [u2, v1], [u1, v1], [u2, v0], [u1, v0] ] : [ [u2, v1], [u1, v1], [u2, v0], [u1, v0] ];
        const bottomVerts = isLid ? [ [u2, v0], [u1, v0], [u2, v1], [u1, v1] ] : [ [u3, v0], [u2, v0], [u3, v1], [u2, v1] ];

        const faceUVs = [
            // Face 0 (+X, East)
            [ [u2, v1], [u3, v1], [u2, v2], [u3, v2] ],
            // Face 1 (-X, West)
            [ [u0, v1], [u1, v1], [u0, v2], [u1, v2] ],
            // Face 2 (+Y, Top)
            topVerts,
            // Face 3 (-Y, Bottom)
            bottomVerts,
            // Face 4 (+Z, South)
            [ [u3, v1], [u4, v1], [u3, v2], [u4, v2] ],
            // Face 5 (-Z, North)
            [ [u1, v1], [u2, v1], [u1, v2], [u2, v2] ]
        ];

        const attribute = geometry.attributes.uv;
        faceUVs.forEach((verts, faceIdx) => {
            const baseIdx = faceIdx * 4;
            for (let i = 0; i < 4; i++) {
                attribute.setXY(baseIdx + i, toU(verts[i][0]), toV(verts[i][1]));
            }
        });
        attribute.needsUpdate = true;
        return geometry;
    }

    function isSkinSlim(img) {
        try {
            const canvas = document.createElement("canvas");
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            // In Alex skins, column 55 at y=20 (right arm back/side) is transparent (alpha == 0)
            const p = ctx.getImageData(55, 20, 1, 1).data;
            return p[3] === 0;
        } catch {
            return false;
        }
    }

    function createPlayerModel(Three, baseMaterial, overlayMaterial, isSlim = false) {
        const model = new Three.Group();
        const armWidth = isSlim ? 3 : 4;

        // 1. Torso
        const torsoGroup = new Three.Group();
        torsoGroup.position.set(0, 18 * PIXEL, 0);

        const torsoGeom = createBoxGeometry(Three, 8, 12, 4, [16, 16, 8, 12, 4]);
        torsoGroup.add(new Three.Mesh(torsoGeom, baseMaterial));

        const jacketGeom = createBoxGeometry(Three, 8, 12, 4, [16, 32, 8, 12, 4], 0.25);
        torsoGroup.add(new Three.Mesh(jacketGeom, overlayMaterial));

        // 2. Head
        const headGroup = new Three.Group();
        headGroup.position.set(0, 6 * PIXEL, 0);

        const headGeom = createBoxGeometry(Three, 8, 8, 8, [0, 0, 8, 8, 8]);
        headGeom.translate(0, 4 * PIXEL, 0);
        headGroup.add(new Three.Mesh(headGeom, baseMaterial));

        const hatGeom = createBoxGeometry(Three, 8, 8, 8, [32, 0, 8, 8, 8], 0.35);
        hatGeom.translate(0, 4 * PIXEL, 0);
        headGroup.add(new Three.Mesh(hatGeom, overlayMaterial));
        torsoGroup.add(headGroup);

        // 3. Right Arm
        const rightArmGroup = new Three.Group();
        const rightArmX = -(4 + armWidth / 2) * PIXEL;
        rightArmGroup.position.set(rightArmX, 4 * PIXEL, 0);

        const rightArmGeom = createBoxGeometry(Three, armWidth, 12, 4, [40, 16, armWidth, 12, 4]);
        rightArmGeom.translate(0, -4 * PIXEL, 0);
        rightArmGroup.add(new Three.Mesh(rightArmGeom, baseMaterial));

        const rightSleeveGeom = createBoxGeometry(Three, armWidth, 12, 4, [40, 32, armWidth, 12, 4], 0.25);
        rightSleeveGeom.translate(0, -4 * PIXEL, 0);
        rightArmGroup.add(new Three.Mesh(rightSleeveGeom, overlayMaterial));
        torsoGroup.add(rightArmGroup);

        // 4. Left Arm
        const leftArmGroup = new Three.Group();
        const leftArmX = (4 + armWidth / 2) * PIXEL;
        leftArmGroup.position.set(leftArmX, 4 * PIXEL, 0);

        const leftArmGeom = createBoxGeometry(Three, armWidth, 12, 4, [32, 48, armWidth, 12, 4]);
        leftArmGeom.translate(0, -4 * PIXEL, 0);
        leftArmGroup.add(new Three.Mesh(leftArmGeom, baseMaterial));

        const leftSleeveGeom = createBoxGeometry(Three, armWidth, 12, 4, [48, 48, armWidth, 12, 4], 0.25);
        leftSleeveGeom.translate(0, -4 * PIXEL, 0);
        leftArmGroup.add(new Three.Mesh(leftSleeveGeom, overlayMaterial));
        torsoGroup.add(leftArmGroup);

        // 5. Right Leg
        const rightLegGroup = new Three.Group();
        rightLegGroup.position.set(-1.9 * PIXEL, 12 * PIXEL, 0);

        const rightLegGeom = createBoxGeometry(Three, 4, 12, 4, [0, 16, 4, 12, 4]);
        rightLegGeom.translate(0, -6 * PIXEL, 0);
        rightLegGroup.add(new Three.Mesh(rightLegGeom, baseMaterial));

        const rightPantsGeom = createBoxGeometry(Three, 4, 12, 4, [0, 32, 4, 12, 4], 0.25);
        rightPantsGeom.translate(0, -6 * PIXEL, 0);
        rightLegGroup.add(new Three.Mesh(rightPantsGeom, overlayMaterial));
        model.add(rightLegGroup);

        // 6. Left Leg
        const leftLegGroup = new Three.Group();
        leftLegGroup.position.set(1.9 * PIXEL, 12 * PIXEL, 0);

        const leftLegGeom = createBoxGeometry(Three, 4, 12, 4, [16, 48, 4, 12, 4]);
        leftLegGeom.translate(0, -6 * PIXEL, 0);
        leftLegGroup.add(new Three.Mesh(leftLegGeom, baseMaterial));

        const leftPantsGeom = createBoxGeometry(Three, 4, 12, 4, [0, 48, 4, 12, 4], 0.25);
        leftPantsGeom.translate(0, -6 * PIXEL, 0);
        leftLegGroup.add(new Three.Mesh(leftPantsGeom, overlayMaterial));
        model.add(leftLegGroup);

        model.add(torsoGroup);

        return {
            root: model,
            torso: torsoGroup,
            head: headGroup,
            leftArm: leftArmGroup,
            rightArm: rightArmGroup,
            leftLeg: leftLegGroup,
            rightLeg: rightLegGroup,
            isSlim: isSlim
        };
    }

    function init() {
        if (!window.bluemap?.mapViewer || !window.BlueMap?.Three) {
            requestAnimationFrame(init);
            return;
        }

        const app = window.bluemap;
        const Three = window.BlueMap.Three;

        // Proactively clean up any previous instance, container, or animation loop
        if (window.__bpmState) {
            try {
                if (window.__bpmState.interval) clearInterval(window.__bpmState.interval);
                if (window.__bpmState.animFrame) cancelAnimationFrame(window.__bpmState.animFrame);
                if (window.__bpmState.destroyAll) window.__bpmState.destroyAll();
                if (window.__bpmState.container && window.__bpmState.container.parent) {
                    window.__bpmState.container.parent.remove(window.__bpmState.container);
                }
            } catch (_) {}
        }
        if (app.mapViewer) {
            const cleanupGroup = (parent) => {
                if (!parent || !parent.children) return;
                const matches = parent.children.filter(c => c.name === "bluemap-3d-players");
                matches.forEach(c => parent.remove(c));
            };
            cleanupGroup(app.mapViewer.markers);
            cleanupGroup(app.mapViewer.scene);
        }
        document.querySelectorAll(".bpm-player-label, .bpm-equipment-modal, .bpm-player-overlay").forEach(el => el.remove());

        const playerContainer = new Three.Group();
        playerContainer.name = "bluemap-3d-players";
        app.mapViewer.markers.add(playerContainer);

        const loadedPlayers = new Map();
        const textureCache = new Map();
        const armorTextureCache = new Map();
        const itemTextureCache = new Map();

        let itemRegistry = {};
        const registryPromise = fetch("assets/bluemap-player-models/items-registry.json")
            .then(res => res.json())
            .then(data => {
                itemRegistry = data || {};
                for (const instance of loadedPlayers.values()) {
                    if (instance.data && instance.data.equipment) {
                        updateEquipment(instance, instance.data.equipment);
                    }
                }
                return itemRegistry;
            })
            .catch(() => ({}));

        function configureTexture(texture) {
            texture.magFilter = Three.NearestFilter;
            texture.minFilter = Three.NearestFilter;
            texture.generateMipmaps = false;
            if (Three.SRGBColorSpace) {
                texture.colorSpace = Three.SRGBColorSpace;
            } else if (Three.sRGBEncoding) {
                texture.encoding = Three.sRGBEncoding;
            }
            texture.needsUpdate = true;
            return texture;
        }

        function loadSkinTexture(url) {
            if (!url) return Promise.resolve(null);
            if (textureCache.has(url)) return textureCache.get(url);

            const promise = new Promise(resolve => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => {
                    const tex = new Three.Texture(img);
                    configureTexture(tex);
                    const slim = isSkinSlim(img);
                    resolve({ texture: tex, img: img, isSlim: slim });
                };
                img.onerror = () => {
                    const fallbackImg = new Image();
                    fallbackImg.crossOrigin = "anonymous";
                    fallbackImg.onload = () => {
                        const tex = new Three.Texture(fallbackImg);
                        configureTexture(tex);
                        resolve({ texture: tex, img: fallbackImg, isSlim: false });
                    };
                    fallbackImg.onerror = () => resolve(null);
                    fallbackImg.src = new URL("assets/steve.png", document.baseURI).href;
                };
                img.src = url;
            });

            textureCache.set(url, promise);
            return promise;
        }

        function loadArmorTexture(asset, isLeggings = false, overlay = false) {
            const subDir = isLeggings ? "humanoid_leggings" : "humanoid";
            const file = overlay ? "leather_overlay.png" : `${asset}.png`;
            const url = `assets/bluemap-player-models/textures/armor/${subDir}/${file}`;

            if (armorTextureCache.has(url)) return armorTextureCache.get(url);

            const promise = new Promise(resolve => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => {
                    const canvas = document.createElement("canvas");
                    canvas.width = img.naturalWidth || img.width;
                    canvas.height = img.naturalHeight || img.height;
                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(img, 0, 0);

                    const sx = canvas.width / 64;
                    const sy = canvas.height / 32;

                    if (!isLeggings) {
                        // For outer armor (humanoid):
                        // 1. Arm forearm (x in 40..56, y in 26..32): chestplate sleeve ends at y=26
                        ctx.clearRect(40 * sx, 26 * sy, 16 * sx, 6 * sy);
                        // 2. Helmet overlay area (x in 32..64, y in 0..16)
                        ctx.clearRect(32 * sx, 0, 32 * sx, 16 * sy);
                        // 3. Boot thigh area (x in 0..16, y in 20..26): boots only use y in 26..32
                        ctx.clearRect(0, 20 * sy, 16 * sx, 6 * sy);
                    } else {
                        // For leggings (humanoid_leggings):
                        // 1. Torso chest area (x in 16..40, y in 16..27): leggings belt only uses y in 27..32
                        ctx.clearRect(16 * sx, 16 * sy, 24 * sx, 11 * sy);
                        // 2. Leg ankle area (x in 0..16, y in 29..32): leggings legs only use y in 20..29
                        ctx.clearRect(0, 29 * sy, 16 * sx, 3 * sy);
                    }

                    const tex = new Three.CanvasTexture(canvas);
                    tex.userData.isShared = true;
                    configureTexture(tex);
                    resolve(tex);
                };
                img.onerror = () => resolve(null);
                img.src = url;
            });

            armorTextureCache.set(url, promise);
            return promise;
        }

        const activeAnimatedTextures = [];

        function registerAnimatedTexture(img, canvas, ctx, tex, mcmetaUrl) {
            const w = img.naturalWidth;
            const totalFrames = Math.floor(img.naturalHeight / w);
            if (totalFrames <= 1) return;
            if (activeAnimatedTextures.some(a => a.img === img || a.tex === tex)) return;

            const animEntry = {
                canvas: canvas,
                ctx: ctx,
                img: img,
                w: w,
                totalFrames: totalFrames,
                frameSequence: null,
                frameDurations: null,
                uniformDuration: 0.1, // default 2 ticks (100ms)
                totalSteps: totalFrames,
                currentStep: 0,
                timer: 0,
                tex: tex
            };
            activeAnimatedTextures.push(animEntry);

            if (mcmetaUrl) {
                fetch(mcmetaUrl)
                    .then(res => res.ok ? res.json() : null)
                    .then(data => {
                        if (!data || !data.animation) return;
                        const anim = data.animation;
                        const baseFrametime = (typeof anim.frametime === "number" && anim.frametime > 0) ? anim.frametime : 1;
                        const defaultStepSec = baseFrametime * 0.05; // 1 tick = 50ms

                        if (Array.isArray(anim.frames) && anim.frames.length > 0) {
                            animEntry.frameSequence = [];
                            animEntry.frameDurations = [];
                            for (const f of anim.frames) {
                                if (typeof f === "number") {
                                    animEntry.frameSequence.push(f);
                                    animEntry.frameDurations.push(defaultStepSec);
                                } else if (f && typeof f === "object") {
                                    animEntry.frameSequence.push(f.index !== undefined ? f.index : 0);
                                    const ft = (typeof f.time === "number" && f.time > 0) ? f.time : baseFrametime;
                                    animEntry.frameDurations.push(ft * 0.05);
                                }
                            }
                            animEntry.totalSteps = animEntry.frameSequence.length;
                        } else {
                            animEntry.uniformDuration = defaultStepSec;
                            animEntry.totalSteps = totalFrames;
                        }
                    })
                    .catch(() => {});
            }
        }

        const GLINT_INTENSITY_ITEM = 0.36;
        const GLINT_INTENSITY_ARMOR = 0.28;
        const GLINT_SPEED = 0.11;

        const glintUniforms = {
            uGlintTime: { value: 0 }
        };

        let glintItemTex = null;
        let glintArmorTex = null;

        function getGlintTexture(Three, isArmor) {
            if (isArmor && glintArmorTex) return glintArmorTex;
            if (!isArmor && glintItemTex) return glintItemTex;

            const path = isArmor ? "textures/misc/enchanted_glint_armor.png" : "textures/misc/enchanted_glint_item.png";
            const loader = new Three.TextureLoader();
            const tex = loader.load("assets/bluemap-player-models/" + path);
            tex.wrapS = Three.RepeatWrapping;
            tex.wrapT = Three.RepeatWrapping;
            tex.generateMipmaps = true;

            if (isArmor) glintArmorTex = tex;
            else glintItemTex = tex;

            return tex;
        }

        function applyGlintToMaterial(Three, mat, isArmor = false) {
            if (!mat || mat.userData.hasGlint) return;
            mat.userData.hasGlint = true;

            const glintTex = getGlintTexture(Three, isArmor);
            const intensity = isArmor ? GLINT_INTENSITY_ARMOR : GLINT_INTENSITY_ITEM;
            const speed1 = GLINT_SPEED;
            const speed2 = GLINT_SPEED * 1.18;

            mat.customProgramCacheKey = () => (isArmor ? "glint_armor" : "glint_item");

            mat.onBeforeCompile = (shader) => {
                shader.uniforms.uGlintTex = { value: glintTex };
                shader.uniforms.uGlintTime = glintUniforms.uGlintTime;

                shader.vertexShader = shader.vertexShader.replace(
                    "#include <uv_pars_vertex>",
                    `#include <uv_pars_vertex>
                    varying vec2 vGlintUv;`
                );
                shader.vertexShader = shader.vertexShader.replace(
                    "void main() {",
                    `void main() {
                    vGlintUv = uv;`
                );

                shader.fragmentShader = shader.fragmentShader.replace(
                    "#include <common>",
                    `#include <common>
                    varying vec2 vGlintUv;
                    uniform sampler2D uGlintTex;
                    uniform float uGlintTime;`
                );

                shader.fragmentShader = shader.fragmentShader.replace(
                    "#include <dithering_fragment>",
                    `#include <dithering_fragment>
                    vec2 gUv1 = vGlintUv * 1.8 + vec2(uGlintTime * ${speed1.toFixed(3)}, uGlintTime * ${speed1.toFixed(3)});
                    vec2 gUv2 = vGlintUv * 1.8 + vec2(-uGlintTime * ${(speed1 * 0.85).toFixed(3)}, uGlintTime * ${speed2.toFixed(3)});
                    vec4 gCol1 = texture2D(uGlintTex, gUv1);
                    vec4 gCol2 = texture2D(uGlintTex, gUv2);
                    vec3 glintRgb = (gCol1.rgb + gCol2.rgb) * (${intensity.toFixed(2)} * gl_FragColor.a);
                    gl_FragColor.rgb += glintRgb;`
                );
            };
            mat.needsUpdate = true;
        }

        function loadItemTexture(relPath, fallbackRelPath = null, tertiaryRelPath = null) {
            if (!relPath) return Promise.resolve(null);
            const key = relPath;
            if (itemTextureCache.has(key)) return itemTextureCache.get(key);

            const candidates = [relPath];
            if (fallbackRelPath && fallbackRelPath !== relPath) {
                candidates.push(fallbackRelPath);
            }
            if (tertiaryRelPath && !candidates.includes(tertiaryRelPath)) {
                candidates.push(tertiaryRelPath);
            }
            if (relPath.startsWith("textures/items/")) {
                candidates.push("textures/blocks/" + relPath.slice(15));
            } else if (relPath.startsWith("textures/blocks/")) {
                candidates.push("textures/items/" + relPath.slice(16));
            }

            const promise = new Promise(resolve => {
                const tryLoad = (idx) => {
                    if (idx >= candidates.length) {
                        resolve(null);
                        return;
                    }
                    const img = new Image();
                    img.crossOrigin = "anonymous";
                    img.onload = () => {
                        let finalSource = img;
                        let isAnimated = false;
                        let animCanvas = null;
                        let animCtx = null;
                        // For animated textures (e.g. 16x64, 16x80 strips)
                        if (img.naturalHeight > img.naturalWidth && img.naturalWidth > 0) {
                            animCanvas = document.createElement("canvas");
                            animCanvas.width = img.naturalWidth;
                            animCanvas.height = img.naturalWidth;
                            animCtx = animCanvas.getContext("2d");
                            animCtx.drawImage(img, 0, 0, img.naturalWidth, img.naturalWidth, 0, 0, img.naturalWidth, img.naturalWidth);
                            finalSource = animCanvas;
                            isAnimated = true;
                        }
                        const tex = new Three.Texture(finalSource);
                        configureTexture(tex);
                        if (isAnimated) {
                            registerAnimatedTexture(img, animCanvas, animCtx, tex, "assets/bluemap-player-models/" + candidates[idx] + ".mcmeta");
                        }
                        resolve(tex);
                    };
                    img.onerror = () => tryLoad(idx + 1);
                    img.src = "assets/bluemap-player-models/" + candidates[idx];
                };
                tryLoad(0);
            });

            itemTextureCache.set(key, promise);
            return promise;
        }

        const dynamicTextureCache = new Map();
        function preloadDynamicTextures(prefix, count) {
            for (let i = 0; i < count; i++) {
                const frameStr = String(i).padStart(2, "0");
                const relPath = `textures/items/${prefix}_${frameStr}.png`;
                if (!dynamicTextureCache.has(relPath)) {
                    loadItemTexture(relPath).then(tex => {
                        if (tex) dynamicTextureCache.set(relPath, tex);
                    });
                }
            }
        }

        const rawImageCache = new Map();
        function loadRawImage(relPath) {
            if (!relPath) return Promise.resolve(null);
            if (rawImageCache.has(relPath)) return rawImageCache.get(relPath);

            const promise = new Promise(resolve => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = "assets/bluemap-player-models/" + relPath;
            });

            rawImageCache.set(relPath, promise);
            return promise;
        }

        const DYE_COLORS = {
            white: 0xf9fffe,
            orange: 0xf9801d,
            magenta: 0xc74ebd,
            light_blue: 0x3ab3da,
            yellow: 0xfed83d,
            lime: 0x80c71f,
            pink: 0xf38baa,
            gray: 0x474f52,
            light_gray: 0x9d9d97,
            cyan: 0x169c9c,
            purple: 0x8932b8,
            blue: 0x3c44aa,
            brown: 0x835432,
            green: 0x5e7c16,
            red: 0xb02e26,
            black: 0x1d1d21
        };

        const bannerCompositeCache = new Map();
        function getCustomBannerTexture(Three, baseColorName, patterns) {
            const pKey = (patterns && patterns.length > 0)
                ? patterns.map(p => p.pattern + ":" + p.color).join(";")
                : "plain";
            const cacheKey = `${baseColorName}_${pKey}`;
            if (bannerCompositeCache.has(cacheKey)) {
                return bannerCompositeCache.get(cacheKey);
            }

            const p = (async () => {
                const canvas = document.createElement("canvas");
                canvas.width = 64;
                canvas.height = 64;
                const ctx = canvas.getContext("2d", { willReadFrequently: true });

                function drawTinted(img, colorHex) {
                    const w = img.naturalWidth || img.width || 64;
                    const h = img.naturalHeight || img.height || 64;
                    const tempCanvas = document.createElement("canvas");
                    tempCanvas.width = w;
                    tempCanvas.height = h;
                    const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
                    tempCtx.drawImage(img, 0, 0);

                    const imgData = tempCtx.getImageData(0, 0, w, h);
                    const d = imgData.data;
                    const dr = ((colorHex >> 16) & 0xff) / 255;
                    const dg = ((colorHex >> 8) & 0xff) / 255;
                    const db = (colorHex & 0xff) / 255;

                    for (let i = 0; i < d.length; i += 4) {
                        if (d[i + 3] > 0) {
                            d[i] = Math.round(d[i] * dr);
                            d[i + 1] = Math.round(d[i + 1] * dg);
                            d[i + 2] = Math.round(d[i + 2] * db);
                        }
                    }
                    tempCtx.putImageData(imgData, 0, 0);
                    ctx.drawImage(tempCanvas, 0, 0, 64, 64);
                }

                const baseImg = await loadRawImage("textures/banner/base.png");
                if (baseImg) {
                    const baseHex = DYE_COLORS[baseColorName] ?? (typeof baseColorName === "number" ? baseColorName : 0xffffff);
                    drawTinted(baseImg, baseHex);
                }

                if (patterns && patterns.length > 0) {
                    for (const pat of patterns) {
                        const patName = pat.pattern.replace(/^minecraft:/, "").replace(/^banner\//, "");
                        const patImg = await loadRawImage("textures/banner/" + patName + ".png");
                        if (patImg) {
                            const patHex = DYE_COLORS[pat.color] ?? (typeof pat.color === "number" ? pat.color : 0xffffff);
                            drawTinted(patImg, patHex);
                        }
                    }
                }

                const tex = new Three.CanvasTexture(canvas);
                configureTexture(tex);
                return tex;
            })();

            bannerCompositeCache.set(cacheKey, p);
            return p;
        }

        const shieldCompositeCache = new Map();
        function getCustomShieldTexture(Three, baseColorName, patterns) {
            const pKey = (patterns && patterns.length > 0)
                ? patterns.map(p => p.pattern + ":" + p.color).join(";")
                : "plain";
            const cacheKey = `${baseColorName || "plain"}_${pKey}`;
            if (shieldCompositeCache.has(cacheKey)) {
                return shieldCompositeCache.get(cacheKey);
            }

            const p = (async () => {
                const canvas = document.createElement("canvas");
                canvas.width = 64;
                canvas.height = 64;
                const ctx = canvas.getContext("2d", { willReadFrequently: true });

                function drawTinted(img, colorHex) {
                    const w = img.naturalWidth || img.width || 64;
                    const h = img.naturalHeight || img.height || 64;
                    const tempCanvas = document.createElement("canvas");
                    tempCanvas.width = w;
                    tempCanvas.height = h;
                    const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
                    tempCtx.drawImage(img, 0, 0);

                    const imgData = tempCtx.getImageData(0, 0, w, h);
                    const d = imgData.data;
                    const dr = ((colorHex >> 16) & 0xff) / 255;
                    const dg = ((colorHex >> 8) & 0xff) / 255;
                    const db = (colorHex & 0xff) / 255;

                    for (let i = 0; i < d.length; i += 4) {
                        if (d[i + 3] > 0) {
                            d[i] = Math.round(d[i] * dr);
                            d[i + 1] = Math.round(d[i + 1] * dg);
                            d[i + 2] = Math.round(d[i + 2] * db);
                        }
                    }
                    tempCtx.putImageData(imgData, 0, 0);
                    ctx.drawImage(tempCanvas, 0, 0, 64, 64);
                }

                // 1. Draw shield_base.png (handle and wooden frame)
                const shieldBaseImg = await loadRawImage("textures/shield/shield_base.png");
                if (shieldBaseImg) {
                    ctx.drawImage(shieldBaseImg, 0, 0, 64, 64);
                }

                // 2. Draw base cloth tinted with baseColor
                const baseImg = await loadRawImage("textures/shield/base.png");
                if (baseImg) {
                    const baseHex = DYE_COLORS[baseColorName || "white"] ?? 0xffffff;
                    drawTinted(baseImg, baseHex);
                }

                // 3. Draw pattern layers
                if (patterns && patterns.length > 0) {
                    for (const pat of patterns) {
                        const patName = pat.pattern.replace(/^minecraft:/, "").replace(/^shield\//, "").replace(/^banner\//, "");
                        const patImg = await loadRawImage("textures/shield/" + patName + ".png");
                        if (patImg) {
                            const patHex = DYE_COLORS[pat.color] ?? 0xffffff;
                            drawTinted(patImg, patHex);
                        }
                    }
                }

                const tex = new Three.CanvasTexture(canvas);
                configureTexture(tex);
                return tex;
            })();

            shieldCompositeCache.set(cacheKey, p);
            return p;
        }

        const dyedItemCanvasCache = new Map();
        function getDyedItemCanvas(cleanId, color) {
            const cacheKey = `${cleanId}_${color}`;
            if (dyedItemCanvasCache.has(cacheKey)) {
                return dyedItemCanvasCache.get(cacheKey);
            }

            const p = (async () => {
                const baseImg = await loadRawImage("textures/items/" + cleanId + ".png");
                if (!baseImg) return null;

                const w = baseImg.naturalWidth || baseImg.width || 16;
                const h = baseImg.naturalHeight || baseImg.height || 16;
                const canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext("2d", { willReadFrequently: true });

                const tempCanvas = document.createElement("canvas");
                tempCanvas.width = w;
                tempCanvas.height = h;
                const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
                tempCtx.drawImage(baseImg, 0, 0);

                const imgData = tempCtx.getImageData(0, 0, w, h);
                const d = imgData.data;
                const dr = ((color >> 16) & 0xff) / 255;
                const dg = ((color >> 8) & 0xff) / 255;
                const db = (color & 0xff) / 255;

                for (let i = 0; i < d.length; i += 4) {
                    if (d[i + 3] > 0) {
                        d[i] = Math.round(d[i] * dr);
                        d[i + 1] = Math.round(d[i + 1] * dg);
                        d[i + 2] = Math.round(d[i + 2] * db);
                    }
                }
                tempCtx.putImageData(imgData, 0, 0);
                ctx.drawImage(tempCanvas, 0, 0);

                const overlayImg = await loadRawImage("textures/items/" + cleanId + "_overlay.png");
                if (overlayImg) {
                    ctx.drawImage(overlayImg, 0, 0);
                }

                return canvas;
            })();

            dyedItemCanvasCache.set(cacheKey, p);
            return p;
        }

        const potionCanvasCache = new Map();
        function getPotionOrArrowCanvas(cleanId, color) {
            const potionColor = (color !== null && color !== undefined) ? (color & 0xffffff) : 0x385dc6;
            const cacheKey = `${cleanId}_${potionColor}`;
            if (potionCanvasCache.has(cacheKey)) {
                return potionCanvasCache.get(cacheKey);
            }

            const p = (async () => {
                const isArrow = cleanId === "tipped_arrow";
                const layer0Path = isArrow ? "textures/items/tipped_arrow_head.png" : "textures/items/potion_overlay.png";
                const layer1Path = isArrow ? "textures/items/tipped_arrow_base.png" : ("textures/items/" + cleanId + ".png");

                const layer0Img = await loadRawImage(layer0Path);
                const layer1Img = await loadRawImage(layer1Path);
                if (!layer0Img && !layer1Img) return null;

                const canvas = document.createElement("canvas");
                canvas.width = 16;
                canvas.height = 16;
                const ctx = canvas.getContext("2d", { willReadFrequently: true });

                if (layer0Img) {
                    const tempCanvas = document.createElement("canvas");
                    tempCanvas.width = 16;
                    tempCanvas.height = 16;
                    const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
                    tempCtx.drawImage(layer0Img, 0, 0);

                    const imgData = tempCtx.getImageData(0, 0, 16, 16);
                    const d = imgData.data;
                    const dr = ((potionColor >> 16) & 0xff) / 255;
                    const dg = ((potionColor >> 8) & 0xff) / 255;
                    const db = (potionColor & 0xff) / 255;

                    for (let i = 0; i < d.length; i += 4) {
                        if (d[i + 3] > 0) {
                            d[i] = Math.round(d[i] * dr);
                            d[i + 1] = Math.round(d[i + 1] * dg);
                            d[i + 2] = Math.round(d[i + 2] * db);
                        }
                    }
                    tempCtx.putImageData(imgData, 0, 0);
                    ctx.drawImage(tempCanvas, 0, 0);
                }

                if (layer1Img) {
                    ctx.drawImage(layer1Img, 0, 0);
                }

                return canvas;
            })();

            potionCanvasCache.set(cacheKey, p);
            return p;
        }

        const potTextureCache = new Map();
        function getDecoratedPotTexture(Three, item) {
            const cacheKey = "default_pot";
            if (potTextureCache.has(cacheKey)) {
                return potTextureCache.get(cacheKey);
            }

            const p = (async () => {
                // 1. Try pre-rendered composite texture first
                const compTex = await loadItemTexture("textures/items/decorated_pot_composite.png");
                if (compTex) return compTex;

                // 2. Dynamic canvas fallback
                const [baseImg, sideImg] = await Promise.all([
                    loadRawImage("textures/items/decorated_pot.png"),
                    loadRawImage("textures/items/decorated_pot_side.png")
                ]);

                if (!baseImg) return null;
                const canvas = document.createElement("canvas");
                canvas.width = 64;
                canvas.height = 64;
                const ctx = canvas.getContext("2d");

                // Top (14x14): base (0, 13, 14, 14) -> (14, 0)
                ctx.drawImage(baseImg, 0, 13, 14, 14, 14, 0, 14, 14);
                // Bottom (14x14): base (14, 13, 14, 14) -> (28, 0)
                ctx.drawImage(baseImg, 14, 13, 14, 14, 28, 0, 14, 14);

                // 4 Sides: if sideImg available, use (1, 0, 14, 16)
                if (sideImg) {
                    ctx.drawImage(sideImg, 1, 0, 14, 16, 28, 14, 14, 16); // Right (+X)
                    ctx.drawImage(sideImg, 1, 0, 14, 16, 0, 14, 14, 16);  // Left (-X)
                    ctx.drawImage(sideImg, 1, 0, 14, 16, 14, 14, 14, 16); // Front (+Z)
                    ctx.drawImage(sideImg, 1, 0, 14, 16, 42, 14, 14, 16); // Back (-Z)
                }

                // Neck & rim: base (0, 0, 32, 12) -> (0, 32)
                ctx.drawImage(baseImg, 0, 0, 32, 12, 0, 32, 32, 12);

                const tex = new Three.CanvasTexture(canvas);
                configureTexture(tex);
                return tex;
            })();

            potTextureCache.set(cacheKey, p);
            return p;
        }

        const extrudedGeomCache = new Map();

        function createExtrudedGeometry(Three, img, isTool) {
            const canvas = document.createElement("canvas");
            const w = img.naturalWidth || img.width || 16;
            const h = img.naturalHeight || img.height || 16;
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);

            const imgData = ctx.getImageData(0, 0, w, h);
            const data = imgData.data;

            const isOpaque = (px, py) => {
                if (px < 0 || px >= w || py < 0 || py >= h) return false;
                return data[(py * w + px) * 4 + 3] > 32;
            };

            const positions = [];
            const uvs = [];
            const indices = [];

            // Half-depth of voxel and slight overlap epsilon to seal all diagonal cracks
            const halfDepth = 0.5 * PIXEL;
            const pixelSize = (16 * PIXEL) / w;
            const eps = 0.04 * pixelSize; // Overlap adjacent pixels to prevent diagonal gaps and rasterizer dropouts
            const zFront = halfDepth + 0.001 * PIXEL;
            const zBack = -halfDepth - 0.001 * PIXEL;

            function addQuad(p0, p1, p2, p3, uv0, uv1, uv2, uv3) {
                const base = positions.length / 3;
                positions.push(...p0, ...p1, ...p2, ...p3);
                uvs.push(...uv0, ...uv1, ...uv2, ...uv3);
                indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            }

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    if (!isOpaque(x, y)) continue;

                    const y3 = h - 1 - y;
                    const x0 = x * pixelSize - eps;
                    const x1 = (x + 1) * pixelSize + eps;
                    const y0 = y3 * pixelSize - eps;
                    const y1 = (y3 + 1) * pixelSize + eps;

                    // Clamped/safe UVs slightly inset into the pixel to prevent GPU border-bleeding
                    const u0 = (x + 0.02) / w;
                    const u1 = (x + 0.98) / w;
                    const v0 = (y3 + 0.02) / h;
                    const v1 = (y3 + 0.98) / h;

                    // Pixel center UV for edge faces - guaranteed solid opacity (alpha == 1.0)
                    const uMid = (x + 0.5) / w;
                    const vMid = (y3 + 0.5) / h;
                    const edgeUv = [uMid, vMid];

                    // Front quad (+Z)
                    addQuad(
                        [x0, y0, halfDepth], [x1, y0, halfDepth], [x1, y1, halfDepth], [x0, y1, halfDepth],
                        [u0, v0], [u1, v0], [u1, v1], [u0, v1]
                    );

                    // Back quad (-Z)
                    addQuad(
                        [x1, y0, -halfDepth], [x0, y0, -halfDepth], [x0, y1, -halfDepth], [x1, y1, -halfDepth],
                        [u1, v0], [u0, v0], [u0, v1], [u1, v1]
                    );

                    // Top edge
                    if (!isOpaque(x, y - 1)) {
                        addQuad(
                            [x0, y1, zFront], [x1, y1, zFront], [x1, y1, zBack], [x0, y1, zBack],
                            edgeUv, edgeUv, edgeUv, edgeUv
                        );
                    }

                    // Bottom edge
                    if (!isOpaque(x, y + 1)) {
                        addQuad(
                            [x0, y0, zBack], [x1, y0, zBack], [x1, y0, zFront], [x0, y0, zFront],
                            edgeUv, edgeUv, edgeUv, edgeUv
                        );
                    }

                    // Left edge
                    if (!isOpaque(x - 1, y)) {
                        addQuad(
                            [x0, y0, zBack], [x0, y0, zFront], [x0, y1, zFront], [x0, y1, zBack],
                            edgeUv, edgeUv, edgeUv, edgeUv
                        );
                    }

                    // Right edge
                    if (!isOpaque(x + 1, y)) {
                        addQuad(
                            [x1, y0, zFront], [x1, y0, zBack], [x1, y1, zBack], [x1, y1, zFront],
                            edgeUv, edgeUv, edgeUv, edgeUv
                        );
                    }
                }
            }

            const geom = new Three.BufferGeometry();
            geom.setAttribute("position", new Three.Float32BufferAttribute(positions, 3));
            geom.setAttribute("uv", new Three.Float32BufferAttribute(uvs, 2));
            geom.setIndex(indices);
            geom.computeVertexNormals();

            // Centered at origin (-8 * PIXEL, -8 * PIXEL, 0) matching vanilla Minecraft model specs
            geom.translate(-8 * PIXEL, -8 * PIXEL, 0);

            return geom;
        }

        function getOrCreateExtrudedGeometry(Three, img, cacheKey) {
            if (extrudedGeomCache.has(cacheKey)) {
                return extrudedGeomCache.get(cacheKey);
            }
            const geom = createExtrudedGeometry(Three, img);
            geom.userData.isCached = true;
            extrudedGeomCache.set(cacheKey, geom);
            return geom;
        }

        function setupEquipmentGroups(parts) {
            const headArmor = new Three.Group();
            parts.head.add(headArmor);

            const torsoArmor = new Three.Group();
            parts.torso.add(torsoArmor);

            const rightArmArmor = new Three.Group();
            parts.rightArm.add(rightArmArmor);

            const leftArmArmor = new Three.Group();
            parts.leftArm.add(leftArmArmor);

            const rightLegArmor = new Three.Group();
            parts.rightLeg.add(rightLegArmor);

            const leftLegArmor = new Three.Group();
            leftLegArmor.position.z = 0.0005 * PIXEL;
            parts.leftLeg.add(leftLegArmor);

            // Hand items attached directly to arms
            const mainHandItem = new Three.Group();
            parts.rightArm.add(mainHandItem);

            const offHandItem = new Three.Group();
            parts.leftArm.add(offHandItem);

            parts.equipGroups = {
                head: headArmor,
                torso: torsoArmor,
                rightArm: rightArmArmor,
                leftArm: leftArmArmor,
                rightLeg: rightLegArmor,
                leftLeg: leftLegArmor,
                mainHand: mainHandItem,
                offHand: offHandItem
            };
        }

        function clearGroup(group) {
            while (group.children.length > 0) {
                const obj = group.children[0];
                group.remove(obj);
                if (obj.geometry && !obj.geometry.userData?.isCached) {
                    obj.geometry.dispose();
                }
                if (obj.material) {
                    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                    mats.forEach(m => {
                        if (!m.userData?.isShared) {
                            if (m.map && m.map.userData?.isDynamic) {
                                m.map.dispose();
                            }
                            m.dispose();
                        }
                    });
                }
                if (obj.children && obj.children.length > 0) {
                    clearGroup(obj);
                }
            }
        }

        function itemFace(from, to, direction) {
            const middle = from.map((value, index) => (value + to[index]) / 2);
            switch (direction) {
                case "east": return {
                    width: to[2] - from[2], height: to[1] - from[1],
                    position: [to[0], middle[1], middle[2]], rotation: [0, Math.PI / 2, 0]
                };
                case "west": return {
                    width: to[2] - from[2], height: to[1] - from[1],
                    position: [from[0], middle[1], middle[2]], rotation: [0, -Math.PI / 2, 0]
                };
                case "up": return {
                    width: to[0] - from[0], height: to[2] - from[2],
                    position: [middle[0], to[1], middle[2]], rotation: [-Math.PI / 2, 0, 0]
                };
                case "down": return {
                    width: to[0] - from[0], height: to[2] - from[2],
                    position: [middle[0], from[1], middle[2]], rotation: [Math.PI / 2, 0, 0]
                };
                case "north": return {
                    width: to[0] - from[0], height: to[1] - from[1],
                    position: [middle[0], middle[1], from[2]], rotation: [0, Math.PI, 0]
                };
                default: return {
                    width: to[0] - from[0], height: to[1] - from[1],
                    position: [middle[0], middle[1], to[2]], rotation: [0, 0, 0]
                };
            }
        }

        function setPlaneUv(geometry, uv, rotation = 0) {
            const [left, top, right, bottom] = uv.map(Number);
            const corners = [
                [left / 16, 1 - top / 16],
                [right / 16, 1 - top / 16],
                [left / 16, 1 - bottom / 16],
                [right / 16, 1 - bottom / 16]
            ];
            const orders = {
                0: [0, 1, 2, 3],
                90: [2, 0, 3, 1],
                180: [3, 2, 1, 0],
                270: [1, 3, 0, 2]
            };
            const order = orders[((Number(rotation) % 360) + 360) % 360] || orders[0];
            const attribute = geometry.attributes.uv;
            order.forEach((corner, index) => attribute.setXY(index, ...corners[corner]));
            attribute.needsUpdate = true;
        }

        const FACE_SHADE = {
            up: 1.0,
            down: 0.5,
            south: 0.85,
            north: 0.85,
            east: 0.7,
            west: 0.7
        };

        function getTextureTintColor(texPath) {
            if (!texPath) return null;
            if (texPath.includes("grass_block_top") || texPath.includes("grass_block_side_overlay") ||
                texPath.includes("short_grass") || texPath.includes("tall_grass") || texPath.includes("fern") ||
                texPath.includes("sugar_cane") || /(^|[\/\\])bush(\.png)?$/.test(texPath)) {
                return 0x79C05A; // Standard Minecraft grass green
            }
            if (texPath.includes("leaves") && !texPath.includes("azalea") && !texPath.includes("cherry") && !texPath.includes("flowering") && !texPath.includes("pale_oak") && !texPath.includes("poplar")) {
                if (texPath.includes("birch")) return 0x80a755;
                if (texPath.includes("spruce")) return 0x619961;
                return 0x59ae30; // Oak/Jungle/Acacia/Dark Oak leaves
            }
            if (/(^|[\/\\])vine(\.png)?$/.test(texPath) || texPath.includes("lily_pad")) {
                return 0x59ae30;
            }
            if (texPath.includes("water_") || texPath.includes("water_still") || texPath.includes("water_flow")) {
                return 0x3f76e4;
            }
            if (texPath.includes("redstone_dust")) {
                return 0xff2200;
            }
            return null;
        }

        function getDefaultFaceUv(from, to, direction) {
            switch (direction) {
                case "down": return [from[0], 16 - to[2], to[0], 16 - from[2]];
                case "up": return [from[0], from[2], to[0], to[2]];
                case "north": return [16 - to[0], 16 - to[1], 16 - from[0], 16 - from[1]];
                case "south": return [from[0], 16 - to[1], to[0], 16 - from[1]];
                case "west": return [from[2], 16 - to[1], to[2], 16 - from[1]];
                case "east": return [16 - to[2], 16 - to[1], 16 - from[2], 16 - from[1]];
                default: return [0, 0, 16, 16];
            }
        }

        function renderVanillaElementModel(Three, parentGroup, elements, renderId, ownerGroup, isEnchanted = false) {
            elements.forEach(el => {
                const from = el.from, to = el.to;
                for (const [direction, face] of Object.entries(el.faces || {})) {
                    if (!face || !face.tex) continue;
                    const descriptor = itemFace(from, to, direction);
                    if (descriptor.width <= 0 || descriptor.height <= 0) continue;

                    const geom = new Three.PlaneGeometry(
                        descriptor.width * PIXEL,
                        descriptor.height * PIXEL
                    );
                    setPlaneUv(geom, face.uv || getDefaultFaceUv(from, to, direction), face.rotation || 0);

                    const shade = FACE_SHADE[direction] || 0.8;
                    const tintHex = getTextureTintColor(face.tex);
                    const baseColor = tintHex !== null ? new Three.Color(tintHex) : new Three.Color(0xffffff);
                    baseColor.multiplyScalar(shade);

                    const isOverlay = face.tex.includes("overlay");
                    const isTranslucent = face.tex.includes("glass") || face.tex.includes("ice") || face.tex.includes("water");
                    const mat = new Three.MeshBasicMaterial({
                        color: baseColor,
                        transparent: true,
                        alphaTest: isTranslucent ? 0.05 : 0.5,
                        side: Three.DoubleSide,
                        depthWrite: !isOverlay && !isTranslucent,
                        polygonOffset: isOverlay,
                        polygonOffsetFactor: -1,
                        polygonOffsetUnits: -1,
                        visible: false
                    });

                    if (isEnchanted) {
                        applyGlintToMaterial(Three, mat, false);
                    }

                    loadItemTexture(face.tex).then(tex => {
                        if (ownerGroup.userData.renderId !== renderId) return;
                        if (tex) {
                            mat.map = tex;
                            mat.visible = true;
                            mat.needsUpdate = true;
                        }
                    });

                    const mesh = new Three.Mesh(geom, mat);
                    // Center relative to block origin [8, 8, 8] with tiny normal offset for overlays
                    const normalOffset = 0.002 * PIXEL;
                    let posX = (descriptor.position[0] - 8) * PIXEL;
                    let posY = (descriptor.position[1] - 8) * PIXEL;
                    let posZ = (descriptor.position[2] - 8) * PIXEL;
                    if (isOverlay) {
                        if (direction === "north") posZ -= normalOffset;
                        else if (direction === "south") posZ += normalOffset;
                        else if (direction === "east") posX += normalOffset;
                        else if (direction === "west") posX -= normalOffset;
                        else if (direction === "up") posY += normalOffset;
                        else if (direction === "down") posY -= normalOffset;
                    }

                    mesh.position.set(posX, posY, posZ);
                    mesh.rotation.set(...descriptor.rotation);
                    parentGroup.add(mesh);
                }
            });
        }

        function applyMinecraftItemTransform(Three, object, entry, isMainHand) {
            if (!entry) return;
            const d = (!isMainHand && entry.dl) ? entry.dl : (entry.d || null);
            let r, t, s;
            if (d) {
                r = d.r || [0, 0, 0];
                t = d.t || [0, 0, 0];
                s = d.s || [1, 1, 1];
            } else {
                if (entry.t === "model") {
                    r = [75, 45, 0]; t = [0, 2.5, 0]; s = [0.375, 0.375, 0.375];
                } else if (entry.tool || entry.t === "tool") {
                    r = [0, -90, 55]; t = [0, 4.0, 0.5]; s = [0.85, 0.85, 0.85];
                } else {
                    r = [0, 0, 0]; t = [0, 3, 1]; s = [0.55, 0.55, 0.55];
                }
            }

            // Minecraft hand attachment in Three.js arm space:
            // S @ rx(-90 deg) @ ry(180 deg) @ trans(0, 2/16, -10/16)
            const mHand = new Three.Matrix4();
            mHand.set(
                -1,  0, 0, 0,
                 0,  0, 1, -10 * PIXEL,
                 0,  1, 0,   2 * PIXEL,
                 0,  0, 0, 1
            );

            // Item model local transform: translation * rotationXYZ * scale
            // tx, ty, tz are in pixel units (1/16th block)
            const tx = (isMainHand || (entry && entry.dl) ? t[0] : -t[0]) * PIXEL;
            const ty = t[1] * PIXEL;
            const tz = t[2] * PIXEL;

            const rx = (r[0] * Math.PI) / 180;
            const ry = (r[1] * Math.PI) / 180;
            const rz = (r[2] * Math.PI) / 180;

            const mItem = new Three.Matrix4();
            const rotEuler = new Three.Euler(rx, ry, rz, "XYZ");
            const rotQuat = new Three.Quaternion().setFromEuler(rotEuler);
            mItem.compose(
                new Three.Vector3(tx, ty, tz),
                rotQuat,
                new Three.Vector3(s[0], s[1], s[2])
            );

            const mTotal = new Three.Matrix4().multiplyMatrices(mHand, mItem);
            mTotal.decompose(object.position, object.quaternion, object.scale);
        }

        function renderHeldItem(group, item, isMainHand, playerSkinUrl, instance) {
            if (!item || !item.id) return;
            const cleanId = item.id.replace(/^minecraft:/, "");

            group.userData.renderId = (group.userData.renderId || 0) + 1;
            const currentRenderId = group.userData.renderId;

            registryPromise.then(reg => {
                if (group.userData.renderId !== currentRenderId) return;

                let entry = reg[cleanId];
                if (!entry) {
                    const isTool = cleanId.includes("sword") || cleanId.includes("pickaxe") || cleanId.includes("axe") ||
                        cleanId.includes("shovel") || cleanId.includes("hoe") || cleanId.includes("rod") ||
                        cleanId.includes("stick") || cleanId.includes("trident") || cleanId.includes("mace");
                    const texPath = item.isBlock ? `textures/blocks/${cleanId}.png` : `textures/items/${cleanId}.png`;
                    entry = { t: "gen", tool: isTool, tex: texPath };
                }

                if (cleanId === "light") {
                    const lightAsset = item.asset || "light_15";
                    entry = {
                        t: "gen",
                        tool: false,
                        tex: `textures/items/${lightAsset}.png`,
                        d: { r: [0, 0, 0], t: [0, 3, 1], s: [0.55, 0.55, 0.55] }
                    };
                }

                if (cleanId === "test_block") {
                    const testAsset = item.asset || "test_block_start";
                    const testTex = `textures/blocks/${testAsset}.png`;
                    entry = {
                        t: "model",
                        elements: [{
                            from: [0, 0, 0],
                            to: [16, 16, 16],
                            faces: {
                                down: { tex: testTex },
                                up: { tex: testTex },
                                north: { tex: testTex },
                                south: { tex: testTex },
                                west: { tex: testTex },
                                east: { tex: testTex }
                            }
                        }],
                        d: { r: [75, 45, 0], t: [0, 2.5, 0], s: [0.375, 0.375, 0.375] },
                        dl: { r: [75, -135, 0], t: [0, 2.5, 0], s: [0.375, 0.375, 0.375] }
                    };
                }

                if (entry.t === "shield") {
                    // Full Vanilla Shield: plate (12x22x1) + handle (2x6x6) strapped to the outer forearm
                    const shieldGroup = new Three.Group();

                    const plateGeom = createMinecraftEntityBoxGeometry(Three, 12, 22, 1, [0, 0], 0, 64, 64);
                    plateGeom.translate(0, 0, -1.5 * PIXEL);

                    const handleGeom = createMinecraftEntityBoxGeometry(Three, 2, 6, 6, [26, 0], 0, 64, 64);
                    handleGeom.translate(0, 0, 2.0 * PIXEL);

                    const mat = new Three.MeshBasicMaterial({
                        color: 0xffffff,
                        transparent: true,
                        alphaTest: 0.5,
                        side: Three.DoubleSide,
                        visible: false
                    });
                    if (item.enchanted) applyGlintToMaterial(Three, mat, false);

                    shieldGroup.add(new Three.Mesh(plateGeom, mat));
                    shieldGroup.add(new Three.Mesh(handleGeom, mat));

                    // Mounted on outer forearm, plate facing sideways/outward, handle encircling forearm
                    const xSide = isMainHand ? -2.0 * PIXEL : 2.0 * PIXEL;
                    shieldGroup.position.set(xSide, -5.5 * PIXEL, 0);
                    shieldGroup.rotation.set(
                        -Math.PI / 2 + 0.15,
                        isMainHand ? (Math.PI / 2) : (-Math.PI / 2),
                        0
                    );

                    group.add(shieldGroup);

                    const hasBannerCustomization = item.baseColor || (item.patterns && item.patterns.length > 0);
                    const shieldTexPromise = hasBannerCustomization
                        ? getCustomShieldTexture(Three, item.baseColor, item.patterns)
                        : loadItemTexture("textures/items/shield.png");

                    shieldTexPromise.then(tex => {
                        if (group.userData.renderId !== currentRenderId) return;
                        if (tex) {
                            mat.map = tex;
                            mat.visible = true;
                            mat.needsUpdate = true;
                        }
                    });
                    return;
                }

                if (cleanId.endsWith("_banner")) {
                    // Full 3D Minecraft Banner: 42px wooden pole, 20px crossbar, 40px hanging cloth flag
                    // In Minecraft, banners in hand face sideways (crossbar front-to-back) with pole upright
                    const bannerGroup = new Three.Group();
                    const baseColorName = item.baseColor || cleanId.replace(/_banner$/, "");

                    // 1. Pole: 2x42x2, uv [44, 0], gripped in fist (y=0) and extending upwards to y=42px
                    const poleGeom = createBoxGeometry(Three, 2, 42, 2, [44, 0, 2, 42, 2], 0, 64);
                    poleGeom.translate(0, 21 * PIXEL, 0);

                    // 2. Crossbar: 20x2x2, uv [0, 42], placed across top of pole (y=41px)
                    const barGeom = createBoxGeometry(Three, 20, 2, 2, [0, 42, 20, 2, 2], 0, 64);
                    barGeom.translate(0, 41 * PIXEL, 0);

                    // 3. Flag: 20x40x1, uv [0, 0], hanging down in front of pole with clear depth clearance (z=1.6px)
                    const flagGeom = createBoxGeometry(Three, 20, 40, 1, [0, 0, 20, 40, 1], 0, 64);
                    flagGeom.translate(0, 20 * PIXEL, 1.6 * PIXEL);

                    const woodMat = new Three.MeshBasicMaterial({
                        transparent: true,
                        alphaTest: 0.5,
                        side: Three.FrontSide,
                        depthWrite: true,
                        visible: false
                    });
                    const flagMat = new Three.MeshBasicMaterial({
                        color: 0xffffff,
                        transparent: true,
                        alphaTest: 0.5,
                        side: Three.FrontSide,
                        depthWrite: true,
                        polygonOffset: true,
                        polygonOffsetFactor: -1,
                        polygonOffsetUnits: -1,
                        visible: false
                    });
                    if (item.enchanted) applyGlintToMaterial(Three, flagMat, false);

                    const poleMesh = new Three.Mesh(poleGeom, woodMat);
                    const barMesh = new Three.Mesh(barGeom, woodMat);
                    const flagMesh = new Three.Mesh(flagGeom, flagMat);

                    bannerGroup.add(poleMesh);
                    bannerGroup.add(barMesh);
                    bannerGroup.add(flagMesh);

                    // Scale and orientation in player hand: authentic Minecraft 3rd-person held banner transform
                    applyMinecraftItemTransform(Three, bannerGroup, {
                        d: {
                            r: [0, 90, 0],
                            t: [0, -1.0, 0.5],
                            s: [0.25, 0.25, 0.25]
                        },
                        dl: {
                            r: [0, -90, 0],
                            t: [0, -1.0, 0.5],
                            s: [0.25, 0.25, 0.25]
                        }
                    }, isMainHand);

                    group.add(bannerGroup);

                    loadItemTexture("textures/banner/banner_base.png").then(tex => {
                        if (group.userData.renderId !== currentRenderId) return;
                        if (tex) {
                            woodMat.map = tex;
                            woodMat.visible = true;
                            woodMat.needsUpdate = true;
                        }
                    });

                    getCustomBannerTexture(Three, baseColorName, item.patterns).then(tex => {
                        if (group.userData.renderId !== currentRenderId) return;
                        if (tex) {
                            flagMat.map = tex;
                            flagMat.visible = true;
                            flagMat.needsUpdate = true;
                        }
                    });
                    return;
                }

                if (cleanId.endsWith("_head") || cleanId.endsWith("_skull")) {
                    // 3D Mini Mob Skull / Player Head held in hand
                    const headGroup = new Three.Group();

                    if (cleanId === "player_head") {
                        // Base Head (8x8x8) + Outer Hat Layer (8x8x8, inflate 0.25)
                        const baseGeom = createBoxGeometry(Three, 8, 8, 8, [0, 0, 8, 8, 8], 0, 64, 64);
                        const hatGeom = createBoxGeometry(Three, 8, 8, 8, [32, 0, 8, 8, 8], 0.25, 64, 64);
                        const mat = new Three.MeshBasicMaterial({
                            transparent: true,
                            alphaTest: 0.5,
                            side: Three.FrontSide,
                            depthWrite: true,
                            visible: false
                        });
                        if (item.enchanted) applyGlintToMaterial(Three, mat, false);
                        headGroup.add(new Three.Mesh(baseGeom, mat));
                        headGroup.add(new Three.Mesh(hatGeom, mat));

                        headGroup.scale.set(0.5, 0.5, 0.5);
                        headGroup.position.set(
                            isMainHand ? -0.5 * PIXEL : 0.5 * PIXEL,
                            -8.5 * PIXEL,
                            1.5 * PIXEL
                        );
                        headGroup.rotation.set(
                            25 * Math.PI / 180,
                            (isMainHand ? 45 : -45) * Math.PI / 180,
                            0
                        );
                        group.add(headGroup);

                        const skinPath = (item.asset && item.asset.startsWith("http")) ? item.asset : (playerSkinUrl || "textures/items/player_head.png");
                        const loadPromise = skinPath.startsWith("http")
                            ? loadSkinTexture(skinPath).then(res => res ? res.texture : null)
                            : loadItemTexture(skinPath);
                        loadPromise.then(tex => {
                            if (group.userData.renderId !== currentRenderId) return;
                            if (tex) {
                                mat.map = tex;
                                mat.visible = true;
                                mat.needsUpdate = true;
                            }
                        });
                        return;
                    }

                    if (cleanId === "piglin_head") {
                        // Piglin Head: Head (10x8x8), Snout (4x4x1), Tusks (1x2x1), Ears (1x5x4)
                        const mat = new Three.MeshBasicMaterial({
                            transparent: true,
                            alphaTest: 0.5,
                            side: Three.FrontSide,
                            depthWrite: true,
                            visible: false
                        });
                        if (item.enchanted) applyGlintToMaterial(Three, mat, false);

                        // Main head (10x8x8)
                        const headGeom = createBoxGeometry(Three, 10, 8, 8, [0, 0, 10, 8, 8], 0, 64, 64);
                        headGroup.add(new Three.Mesh(headGeom, mat));

                        // Snout (4x4x1)
                        const snoutGeom = createBoxGeometry(Three, 4, 4, 1, [31, 1, 4, 4, 1], 0, 64, 64);
                        const snoutMesh = new Three.Mesh(snoutGeom, mat);
                        snoutMesh.position.set(0, -2 * PIXEL, 4.5 * PIXEL);
                        headGroup.add(snoutMesh);

                        // Tusks (1x2x1 each)
                        const lTuskGeom = createBoxGeometry(Three, 1, 2, 1, [2, 4, 1, 2, 1], 0, 64, 64);
                        const lTuskMesh = new Three.Mesh(lTuskGeom, mat);
                        lTuskMesh.position.set(2.5 * PIXEL, -3 * PIXEL, 4.5 * PIXEL);
                        headGroup.add(lTuskMesh);

                        const rTuskGeom = createBoxGeometry(Three, 1, 2, 1, [2, 0, 1, 2, 1], 0, 64, 64);
                        const rTuskMesh = new Three.Mesh(rTuskGeom, mat);
                        rTuskMesh.position.set(-2.5 * PIXEL, -3 * PIXEL, 4.5 * PIXEL);
                        headGroup.add(rTuskMesh);

                        // Ears (1x5x4 each, drooping outward at 30 degrees)
                        const lEarGeom = createBoxGeometry(Three, 1, 5, 4, [51, 6, 1, 5, 4], 0, 64, 64);
                        lEarGeom.translate(0.5 * PIXEL, -2.5 * PIXEL, 0);
                        const lEarGroup = new Three.Group();
                        lEarGroup.position.set(4.5 * PIXEL, 2 * PIXEL, 0);
                        lEarGroup.rotation.z = 30 * Math.PI / 180;
                        lEarGroup.add(new Three.Mesh(lEarGeom, mat));
                        headGroup.add(lEarGroup);

                        const rEarGeom = createBoxGeometry(Three, 1, 5, 4, [39, 6, 1, 5, 4], 0, 64, 64);
                        rEarGeom.translate(-0.5 * PIXEL, -2.5 * PIXEL, 0);
                        const rEarGroup = new Three.Group();
                        rEarGroup.position.set(-4.5 * PIXEL, 2 * PIXEL, 0);
                        rEarGroup.rotation.z = -30 * Math.PI / 180;
                        rEarGroup.add(new Three.Mesh(rEarGeom, mat));
                        headGroup.add(rEarGroup);

                        headGroup.scale.set(0.5, 0.5, 0.5);
                        headGroup.position.set(
                            isMainHand ? -0.5 * PIXEL : 0.5 * PIXEL,
                            -8.5 * PIXEL,
                            1.5 * PIXEL
                        );
                        headGroup.rotation.set(
                            25 * Math.PI / 180,
                            (isMainHand ? 45 : -45) * Math.PI / 180,
                            0
                        );
                        group.add(headGroup);

                        loadItemTexture("textures/items/piglin_head.png").then(tex => {
                            if (group.userData.renderId !== currentRenderId) return;
                            if (tex) {
                                mat.map = tex;
                                mat.visible = true;
                                mat.needsUpdate = true;
                            }
                        });
                        return;
                    }

                    if (cleanId === "dragon_head") {
                        // Ender Dragon Head: Upper Head (16x16x16), Upper Lip/Snout (12x5x16), Jaw (12x4x16), Horns (2x4x6), Nostrils (2x2x4)
                        const mat = new Three.MeshBasicMaterial({
                            transparent: true,
                            alphaTest: 0.5,
                            side: Three.FrontSide,
                            depthWrite: true,
                            visible: false
                        });
                        if (item.enchanted) applyGlintToMaterial(Three, mat, false);

                        // Upper head (16x16x16)
                        const upperHeadGeom = createBoxGeometry(Three, 16, 16, 16, [112, 30, 16, 16, 16], 0, 256, 256);
                        headGroup.add(new Three.Mesh(upperHeadGeom, mat));

                        // Upper lip / snout (12x5x16)
                        const lipGeom = createBoxGeometry(Three, 12, 5, 16, [176, 44, 12, 5, 16], 0, 256, 256);
                        const lipMesh = new Three.Mesh(lipGeom, mat);
                        lipMesh.position.set(0, -1.5 * PIXEL, 14 * PIXEL);
                        headGroup.add(lipMesh);

                        // Jaw (12x4x16)
                        const jawGeom = createBoxGeometry(Three, 12, 4, 16, [176, 65, 12, 4, 16], 0, 256, 256);
                        const jawMesh = new Three.Mesh(jawGeom, mat);
                        jawMesh.position.set(0, -6 * PIXEL, 14 * PIXEL);
                        headGroup.add(jawMesh);

                        // Horns (2x4x6 each)
                        const rHornGeom = createBoxGeometry(Three, 2, 4, 6, [0, 0, 2, 4, 6], 0, 256, 256, false);
                        const rHornMesh = new Three.Mesh(rHornGeom, mat);
                        rHornMesh.position.set(4 * PIXEL, 10 * PIXEL, -2 * PIXEL);
                        headGroup.add(rHornMesh);

                        const lHornGeom = createBoxGeometry(Three, 2, 4, 6, [0, 0, 2, 4, 6], 0, 256, 256, true);
                        const lHornMesh = new Three.Mesh(lHornGeom, mat);
                        lHornMesh.position.set(-4 * PIXEL, 10 * PIXEL, -2 * PIXEL);
                        headGroup.add(lHornMesh);

                        // Nostrils (2x2x4 each)
                        const rNostrilGeom = createBoxGeometry(Three, 2, 2, 4, [112, 0, 2, 2, 4], 0, 256, 256, false);
                        const rNostrilMesh = new Three.Mesh(rNostrilGeom, mat);
                        rNostrilMesh.position.set(4 * PIXEL, 2 * PIXEL, 20 * PIXEL);
                        headGroup.add(rNostrilMesh);

                        const lNostrilGeom = createBoxGeometry(Three, 2, 2, 4, [112, 0, 2, 2, 4], 0, 256, 256, true);
                        const lNostrilMesh = new Three.Mesh(lNostrilGeom, mat);
                        lNostrilMesh.position.set(-4 * PIXEL, 2 * PIXEL, 20 * PIXEL);
                        headGroup.add(lNostrilMesh);

                        headGroup.scale.set(0.375, 0.375, 0.375);
                        headGroup.position.set(
                            0,
                            -11.0 * PIXEL,
                            0.5 * PIXEL
                        );
                        headGroup.rotation.set(
                            90 * Math.PI / 180,
                            0,
                            0
                        );
                        group.add(headGroup);

                        loadItemTexture("textures/items/dragon_head.png").then(tex => {
                            if (group.userData.renderId !== currentRenderId) return;
                            if (tex) {
                                mat.map = tex;
                                mat.visible = true;
                                mat.needsUpdate = true;
                            }
                        });
                        return;
                    }

                    // Standard mob skulls (skeleton_skull, wither_skeleton_skull, zombie_head, creeper_head)
                    const headGeom = createBoxGeometry(Three, 8, 8, 8, [0, 0, 8, 8, 8], 0, 64, 64);
                    const mat = new Three.MeshBasicMaterial({
                        transparent: true,
                        alphaTest: 0.5,
                        side: Three.FrontSide,
                        depthWrite: true,
                        visible: false
                    });
                    if (item.enchanted) applyGlintToMaterial(Three, mat, false);
                    const headMesh = new Three.Mesh(headGeom, mat);
                    headGroup.add(headMesh);

                    headGroup.scale.set(0.5, 0.5, 0.5);
                    headGroup.position.set(
                        isMainHand ? -0.5 * PIXEL : 0.5 * PIXEL,
                        -8.5 * PIXEL,
                        1.5 * PIXEL
                    );
                    headGroup.rotation.set(
                        25 * Math.PI / 180,
                        (isMainHand ? 45 : -45) * Math.PI / 180,
                        0
                    );
                    group.add(headGroup);

                    const texPath = `textures/items/${cleanId}.png`;
                    loadItemTexture(texPath).then(tex => {
                        if (group.userData.renderId !== currentRenderId) return;
                        if (tex) {
                            mat.map = tex;
                            mat.visible = true;
                            mat.needsUpdate = true;
                        }
                    });
                    return;
                }

                if (cleanId === "chest" || cleanId.endsWith("_chest")) {
                    // Full 3D Vanilla Chest: Bottom (14x10x14), Lid (14x5x14), Lock (2x4x1)
                    const chestGroup = new Three.Group();

                    const bottomGeom = createMinecraftEntityBoxGeometry(Three, 14, 10, 14, [0, 19], 0, 64, 64, true);
                    bottomGeom.translate(0, -3.0 * PIXEL, 0);

                    const lidGeom = createMinecraftEntityBoxGeometry(Three, 14, 5, 14, [0, 0], 0, 64, 64, true);
                    lidGeom.translate(0, 3.5 * PIXEL, 0);

                    const lockGeom = createMinecraftEntityBoxGeometry(Three, 2, 4, 1, [0, 0], 0, 64, 64, true);
                    lockGeom.translate(0, 1.0 * PIXEL, 7.51 * PIXEL);

                    const mat = new Three.MeshBasicMaterial({
                        transparent: true,
                        alphaTest: 0.5,
                        side: Three.FrontSide,
                        depthWrite: true,
                        visible: false
                    });
                    if (item.enchanted) applyGlintToMaterial(Three, mat, false);

                    chestGroup.add(new Three.Mesh(bottomGeom, mat));
                    chestGroup.add(new Three.Mesh(lidGeom, mat));
                    chestGroup.add(new Three.Mesh(lockGeom, mat));

                    const chestEntry = {
                        d: (entry && entry.d) ? entry.d : { r: [75, 315, 0], t: [0, 2.5, 0], s: [0.375, 0.375, 0.375] },
                        dl: (entry && entry.dl) ? entry.dl : null
                    };
                    applyMinecraftItemTransform(Three, chestGroup, chestEntry, isMainHand);
                    group.add(chestGroup);

                    const texName = cleanId.replace(/^waxed_/, "");
                    const primaryTex = `textures/items/${texName}.png`;
                    const fallbackTex = texName.includes("copper") ? "textures/items/copper_chest.png" : "textures/items/chest.png";

                    loadItemTexture(primaryTex, `textures/blocks/${texName}.png`, fallbackTex).then(tex => {
                        if (group.userData.renderId !== currentRenderId) return;
                        if (tex) {
                            mat.map = tex;
                            mat.visible = true;
                            mat.needsUpdate = true;
                        }
                    });
                    return;
                }

                if (cleanId === "decorated_pot") {
                    // Full 3D Vanilla Decorated Pot: Body (14x16x14), Collar (6x1x6), Flared Rim (8x3x8)
                    const potGroup = new Three.Group();

                    const bodyGeom = createBoxGeometry(Three, 14, 16, 14, [0, 0, 14, 16, 14], 0, 64, 64);
                    const collarGeom = createBoxGeometry(Three, 6, 1, 6, [0, 37, 6, 1, 6], 0.2, 64, 64);
                    collarGeom.translate(0, 8.5 * PIXEL, 0);
                    const rimGeom = createBoxGeometry(Three, 8, 3, 8, [0, 32, 8, 3, 8], -0.1, 64, 64);
                    rimGeom.translate(0, 10.5 * PIXEL, 0);

                    const mat = new Three.MeshBasicMaterial({
                        transparent: true,
                        alphaTest: 0.5,
                        side: Three.FrontSide,
                        depthWrite: true,
                        visible: false
                    });
                    if (item.enchanted) applyGlintToMaterial(Three, mat, false);

                    potGroup.add(new Three.Mesh(bodyGeom, mat));
                    potGroup.add(new Three.Mesh(collarGeom, mat));
                    potGroup.add(new Three.Mesh(rimGeom, mat));

                    const potEntry = {
                        d: (entry && entry.d) ? entry.d : { r: [0, 90, 0], t: [0, 2, 0.5], s: [0.375, 0.375, 0.375] },
                        dl: (entry && entry.dl) ? entry.dl : null
                    };
                    applyMinecraftItemTransform(Three, potGroup, potEntry, isMainHand);
                    group.add(potGroup);

                    getDecoratedPotTexture(Three, item).then(tex => {
                        if (group.userData.renderId !== currentRenderId) return;
                        if (tex) {
                            mat.map = tex;
                            mat.visible = true;
                            mat.needsUpdate = true;
                        }
                    });
                    return;
                }

                if (cleanId.endsWith("shulker_box")) {
                    // Full 3D Vanilla Shulker Box: Lid (16x12x16, uv [0, 0]), Base (16x8x16, uv [0, 28])
                    const shulkerGroup = new Three.Group();

                    const lidGeom = createShulkerPartGeometry(Three, 16, 12, 16, [0, 0], true);
                    lidGeom.translate(0, 2.0 * PIXEL, 0);

                    const baseGeom = createShulkerPartGeometry(Three, 16, 8, 16, [0, 28], false);
                    baseGeom.translate(0, -4.0 * PIXEL, 0);

                    const mat = new Three.MeshBasicMaterial({
                        transparent: true,
                        alphaTest: 0.5,
                        side: Three.FrontSide,
                        depthWrite: true,
                        visible: false
                    });
                    if (item.enchanted) applyGlintToMaterial(Three, mat, false);

                    shulkerGroup.add(new Three.Mesh(lidGeom, mat));
                    shulkerGroup.add(new Three.Mesh(baseGeom, mat));

                    const shulkerEntry = {
                        d: (entry && entry.d) ? entry.d : { r: [75, 315, 0], t: [0, 2.5, 0], s: [0.375, 0.375, 0.375] },
                        dl: (entry && entry.dl) ? entry.dl : null
                    };
                    applyMinecraftItemTransform(Three, shulkerGroup, shulkerEntry, isMainHand);
                    group.add(shulkerGroup);

                    loadItemTexture(`textures/shulker/${cleanId}.png`, `textures/items/${cleanId}.png`, `textures/blocks/${cleanId}.png`).then(tex => {
                        if (group.userData.renderId !== currentRenderId) return;
                        if (tex) {
                            mat.map = tex;
                            mat.visible = true;
                            mat.needsUpdate = true;
                        }
                    });
                    return;
                }

                if (cleanId === "conduit") {
                    // Authentic 3D Conduit Shell (6x6x6, uv [0, 0] on 32x16 texture)
                    const conduitGroup = new Three.Group();
                    const conduitGeom = createMinecraftEntityBoxGeometry(Three, 6, 6, 6, [0, 0], 0, 16, 32);
                    const mat = new Three.MeshBasicMaterial({
                        transparent: true,
                        alphaTest: 0.5,
                        side: Three.FrontSide,
                        depthWrite: true,
                        visible: false
                    });
                    if (item.enchanted) applyGlintToMaterial(Three, mat, false);
                    conduitGroup.add(new Three.Mesh(conduitGeom, mat));

                    const conduitEntry = {
                        d: (entry && entry.d) ? entry.d : { r: [75, 315, 0], t: [0, 2.5, 0], s: [0.5, 0.5, 0.5] },
                        dl: (entry && entry.dl) ? entry.dl : { r: [75, -45, 0], t: [0, 2.5, 0], s: [0.5, 0.5, 0.5] }
                    };
                    applyMinecraftItemTransform(Three, conduitGroup, conduitEntry, isMainHand);
                    group.add(conduitGroup);

                    loadItemTexture("textures/entity/conduit/base.png", "textures/items/conduit.png").then(tex => {
                        if (group.userData.renderId !== currentRenderId) return;
                        if (tex) {
                            mat.map = tex;
                            mat.visible = true;
                            mat.needsUpdate = true;
                        }
                    });
                    return;
                }

                if (cleanId === "trident") {
                    // Full 3D Vanilla Trident: Pole (1x25x1), Base (3x2x1), 3 Spikes (1x4x1 each)
                    // Held like spears: upright along the arm with 60 deg angle, shaft gripped in fist
                    const tridentGroup = new Three.Group();

                    // Grip point: closer to the tip (8 px of pole in front, 17 px behind)
                    const poleGeom = createMinecraftEntityBoxGeometry(Three, 1, 25, 1, [0, 6], 0, 32, 32);
                    poleGeom.translate(0, -4.5 * PIXEL, 0);

                    const baseGeom = createMinecraftEntityBoxGeometry(Three, 3, 2, 1, [4, 0], 0, 32, 32);
                    baseGeom.translate(0, 9.0 * PIXEL, 0);

                    const lSpikeGeom = createMinecraftEntityBoxGeometry(Three, 1, 4, 1, [4, 3], 0, 32, 32);
                    lSpikeGeom.translate(-1.5 * PIXEL, 11.0 * PIXEL, 0);

                    const mSpikeGeom = createMinecraftEntityBoxGeometry(Three, 1, 4, 1, [0, 0], 0, 32, 32);
                    mSpikeGeom.translate(0, 12.0 * PIXEL, 0);

                    const rSpikeGeom = createMinecraftEntityBoxGeometry(Three, 1, 4, 1, [4, 3], 0, 32, 32);
                    rSpikeGeom.translate(1.5 * PIXEL, 11.0 * PIXEL, 0);

                    const mat = new Three.MeshBasicMaterial({
                        transparent: true,
                        alphaTest: 0.5,
                        side: Three.DoubleSide,
                        depthWrite: true,
                        visible: false
                    });
                    if (item.enchanted) applyGlintToMaterial(Three, mat, false);

                    tridentGroup.add(new Three.Mesh(poleGeom, mat));
                    tridentGroup.add(new Three.Mesh(baseGeom, mat));
                    tridentGroup.add(new Three.Mesh(lSpikeGeom, mat));
                    tridentGroup.add(new Three.Mesh(mSpikeGeom, mat));
                    tridentGroup.add(new Three.Mesh(rSpikeGeom, mat));

                    // Position held like spears: pointing forward along +Z, prongs angled 45 deg
                    tridentGroup.position.set(0, -8.5 * PIXEL, 2.0 * PIXEL);
                    tridentGroup.rotation.set(Math.PI / 2, isMainHand ? (Math.PI / 4) : (-Math.PI / 4), 0);
                    group.add(tridentGroup);

                    loadItemTexture("textures/entity/trident/trident.png", "textures/items/trident_entity.png").then(tex => {
                        if (group.userData.renderId !== currentRenderId) return;
                        if (tex) {
                            mat.map = tex;
                            mat.visible = true;
                            mat.needsUpdate = true;
                        }
                    });
                    return;
                }

                if (cleanId.includes("copper_golem_statue")) {
                    // Full 3D Copper Golem Statue: Body, Head, Nose, Rod, Arms, Legs matching official Model
                    const statueGroup = new Three.Group();

                    const bodyGeom = createBoxGeometry(Three, 8, 6, 6, [0, 15], 0, 64, 64);
                    bodyGeom.translate(0, -3.0 * PIXEL, 0);

                    const headGeom = createBoxGeometry(Three, 8, 5, 10, [0, 0], 0.015, 64, 64);
                    headGeom.translate(0, 2.5 * PIXEL, 1.0 * PIXEL);

                    const noseGeom = createBoxGeometry(Three, 2, 3, 2, [56, 0], 0, 64, 64);
                    noseGeom.translate(0, 1.5 * PIXEL, 6.0 * PIXEL);

                    const rodLowerGeom = createBoxGeometry(Three, 2, 4, 2, [37, 8], 0, 64, 64);
                    rodLowerGeom.translate(0, 7.0 * PIXEL, 1.0 * PIXEL);

                    const rodBulbGeom = createBoxGeometry(Three, 4, 4, 4, [37, 0], 0, 64, 64);
                    rodBulbGeom.translate(0, 11.0 * PIXEL, 1.0 * PIXEL);

                    const rArmGeom = createBoxGeometry(Three, 3, 10, 4, [36, 16], 0, 64, 64);
                    rArmGeom.translate(-5.5 * PIXEL, -5.0 * PIXEL, 0);

                    const lArmGeom = createBoxGeometry(Three, 3, 10, 4, [50, 16], 0, 64, 64);
                    lArmGeom.translate(5.5 * PIXEL, -5.0 * PIXEL, 0);

                    const rLegGeom = createBoxGeometry(Three, 4, 5, 4, [0, 27], 0, 64, 64);
                    rLegGeom.translate(-2.0 * PIXEL, -8.5 * PIXEL, 0);

                    const lLegGeom = createBoxGeometry(Three, 4, 5, 4, [16, 27], 0, 64, 64);
                    lLegGeom.translate(2.0 * PIXEL, -8.5 * PIXEL, 0);

                    const mat = new Three.MeshBasicMaterial({
                        transparent: true,
                        alphaTest: 0.5,
                        side: Three.FrontSide,
                        depthWrite: true,
                        visible: false
                    });
                    if (item.enchanted) applyGlintToMaterial(Three, mat, false);

                    statueGroup.add(new Three.Mesh(bodyGeom, mat));
                    statueGroup.add(new Three.Mesh(headGeom, mat));
                    statueGroup.add(new Three.Mesh(noseGeom, mat));
                    statueGroup.add(new Three.Mesh(rodLowerGeom, mat));
                    statueGroup.add(new Three.Mesh(rodBulbGeom, mat));
                    statueGroup.add(new Three.Mesh(rArmGeom, mat));
                    statueGroup.add(new Three.Mesh(lArmGeom, mat));
                    statueGroup.add(new Three.Mesh(rLegGeom, mat));
                    statueGroup.add(new Three.Mesh(lLegGeom, mat));

                    applyMinecraftItemTransform(Three, statueGroup, entry, isMainHand);
                    group.add(statueGroup);

                    let entityBase = "copper_golem";
                    if (cleanId.includes("oxidized")) entityBase = "copper_golem_oxidized";
                    else if (cleanId.includes("weathered")) entityBase = "copper_golem_weathered";
                    else if (cleanId.includes("exposed")) entityBase = "copper_golem_exposed";

                    loadItemTexture(
                        `textures/entity/copper_golem/${entityBase}.png`,
                        `textures/items/${cleanId}.png`,
                        `textures/items/${entityBase}_statue.png`
                    ).then(tex => {
                        if (group.userData.renderId !== currentRenderId) return;
                        if (tex) {
                            mat.map = tex;
                            mat.visible = true;
                            mat.needsUpdate = true;
                        }
                    });
                    return;
                }

                if (cleanId === "potion" || cleanId === "splash_potion" || cleanId === "lingering_potion" || cleanId === "tipped_arrow") {
                    getPotionOrArrowCanvas(cleanId, item.color).then(canvas => {
                        if (group.userData.renderId !== currentRenderId) return;
                        if (canvas) {
                            const geom = getOrCreateExtrudedGeometry(Three, canvas, `${cleanId}_potion_${item.color || "default"}`);
                            const tex = new Three.CanvasTexture(canvas);
                            tex.userData.isDynamic = true;
                            configureTexture(tex);
                            const mat = new Three.MeshBasicMaterial({
                                map: tex,
                                transparent: true,
                                alphaTest: 0.5,
                                side: Three.DoubleSide,
                                depthWrite: true
                            });
                            if (item.enchanted) applyGlintToMaterial(Three, mat, false);
                            const mesh = new Three.Mesh(geom, mat);
                            applyMinecraftItemTransform(Three, mesh, entry, isMainHand);
                            group.add(mesh);
                        }
                    });
                    return;
                }

                if (entry.t === "model" && entry.elements && entry.elements.length > 0) {
                    // 3D Block Model (elements cuboids)
                    const blockGroup = new Three.Group();
                    renderVanillaElementModel(Three, blockGroup, entry.elements, currentRenderId, group, item.enchanted);
                    applyMinecraftItemTransform(Three, blockGroup, entry, isMainHand);
                    group.add(blockGroup);
                } else {
                    const isLeather = cleanId.startsWith("leather_") || cleanId === "leather_horse_armor";
                    const activeColor = (item.color !== null && item.color !== undefined) ? item.color : (isLeather ? 0xa06540 : null);

                    if (activeColor !== null) {
                        // Dyed 2D Item (e.g. leather armor held in hand)
                        getDyedItemCanvas(cleanId, activeColor).then(canvas => {
                            if (group.userData.renderId !== currentRenderId) return;
                            if (canvas) {
                                const geom = getOrCreateExtrudedGeometry(Three, canvas, `${cleanId}_dyed_${activeColor}`);
                                const tex = new Three.CanvasTexture(canvas);
                                tex.userData.isDynamic = true;
                                configureTexture(tex);
                                const mat = new Three.MeshBasicMaterial({
                                    map: tex,
                                    transparent: true,
                                    alphaTest: 0.5,
                                    side: Three.DoubleSide,
                                    depthWrite: true
                                });
                                if (item.enchanted) applyGlintToMaterial(Three, mat, false);
                                const mesh = new Three.Mesh(geom, mat);
                                applyMinecraftItemTransform(Three, mesh, entry, isMainHand);
                                group.add(mesh);
                            }
                        });
                    } else {
                        // 2D Extruded Item / Tool / Bow / Crossbow (official Minecraft display transforms)
                        let activeTex = entry.tex;
                        const isDynamicItem = (cleanId === "clock" || cleanId === "compass" || cleanId === "recovery_compass");
                        let initialFrame = -1;
                        if (isDynamicItem) {
                            preloadDynamicTextures(cleanId, cleanId === "clock" ? 64 : 32);
                            if (cleanId === "clock") {
                                const worldTime = instance?.data?.worldTime;
                                if (worldTime !== null && worldTime !== undefined) {
                                    const timeFraction = (((worldTime - 6000) % 24000 + 24000) % 24000) / 24000;
                                    initialFrame = Math.floor(timeFraction * 64 + 0.5) % 64;
                                } else {
                                    initialFrame = Math.floor((performance.now() / 100) % 64);
                                }
                            } else {
                                const handItem = isMainHand ? instance?.data?.equipment?.mainHand : instance?.data?.equipment?.offHand;
                                const targetPos = handItem?.targetPos || item.targetPos;
                                if (targetPos && Array.isArray(targetPos) && targetPos.length >= 2 && instance?.currentPos) {
                                    const dx = (targetPos[0] + 0.5) - instance.currentPos.x;
                                    const dz = (targetPos[1] + 0.5) - instance.currentPos.z;
                                    const angle = Math.atan2(dz, dx) / (2 * Math.PI);
                                    const visY = (((instance.currentYaw || 0) / 360) % 1 + 1) % 1;
                                    const rot = ((0.75 - visY + angle) % 1 + 1) % 1;
                                    initialFrame = (16 + Math.round(rot * 32)) % 32;
                                } else {
                                    initialFrame = Math.floor((performance.now() / 80) % 32);
                                }
                            }
                            if (initialFrame >= 0) {
                                const frameStr = String(initialFrame).padStart(2, "0");
                                activeTex = `textures/items/${cleanId}_${frameStr}.png`;
                            }
                        }

                        loadItemTexture(activeTex, entry.tex, `textures/blocks/${cleanId}.png`).then(tex => {
                            if (group.userData.renderId !== currentRenderId) return;
                            if (tex && tex.image) {
                                const geom = getOrCreateExtrudedGeometry(Three, tex.image, entry.tex);
                                const tintHex = getTextureTintColor(entry.tex || cleanId);
                                const isTranslucent = cleanId.includes("glass") || (entry.tex && (entry.tex.includes("glass") || entry.tex.includes("ice") || entry.tex.includes("water")));
                                const mat = new Three.MeshBasicMaterial({
                                    color: tintHex !== null ? tintHex : 0xffffff,
                                    map: tex,
                                    transparent: true,
                                    alphaTest: isTranslucent ? 0.05 : 0.5,
                                    side: Three.DoubleSide,
                                    depthWrite: true
                                });
                                if (item.enchanted) applyGlintToMaterial(Three, mat, false);
                                const mesh = new Three.Mesh(geom, mat);
                                applyMinecraftItemTransform(Three, mesh, entry, isMainHand);
                                group.add(mesh);

                                if (isDynamicItem && instance) {
                                    if (!instance.dynamicHeldItems) instance.dynamicHeldItems = [];
                                    instance.dynamicHeldItems.push({
                                        type: cleanId,
                                        mesh: mesh,
                                        mat: mat,
                                        item: item,
                                        isMainHand: isMainHand,
                                        lastFrame: initialFrame
                                    });
                                }
                            }
                        });
                    }
                }
            });
        }

        function updateEquipment(instance, equipment) {
            if (!instance.parts || !instance.parts.equipGroups) return;
            const groups = instance.parts.equipGroups;
            const armWidth = instance.parts.isSlim ? 3 : 4;

            // Clear all equipment groups
            Object.values(groups).forEach(clearGroup);
            instance.dynamicHeldItems = [];

            if (!equipment) return;

            function createArmorMat(asset, isLeggings, color, isEnchanted) {
                const mat = new Three.MeshBasicMaterial({
                    transparent: true,
                    alphaTest: 0.5,
                    side: Three.FrontSide,
                    depthWrite: true,
                    polygonOffset: true,
                    polygonOffsetFactor: isLeggings ? -2 : -3,
                    polygonOffsetUnits: isLeggings ? -2 : -3
                });
                if (asset === "leather" && (color === null || color === undefined)) {
                    color = 0xA06540;
                }
                if (color !== null && color !== undefined) {
                    mat.color.setHex(color);
                }
                loadArmorTexture(asset, isLeggings).then(tex => {
                    if (tex) {
                        mat.map = tex;
                        mat.needsUpdate = true;
                    }
                });
                if (isEnchanted) {
                    applyGlintToMaterial(Three, mat, true);
                }
                return mat;
            }

            function createLeatherOverlayMat(isLeggings, isEnchanted) {
                const mat = new Three.MeshBasicMaterial({
                    transparent: true,
                    alphaTest: 0.5,
                    side: Three.FrontSide,
                    depthWrite: true,
                    polygonOffset: true,
                    polygonOffsetFactor: isLeggings ? -2.2 : -3.2,
                    polygonOffsetUnits: isLeggings ? -2.2 : -3.2
                });
                loadArmorTexture("leather", isLeggings, true).then(tex => {
                    if (tex) {
                        mat.map = tex;
                        mat.needsUpdate = true;
                    }
                });
                if (isEnchanted) {
                    applyGlintToMaterial(Three, mat, true);
                }
                return mat;
            }

            // 1. HELMET / WORN HEADS
            if (equipment.head && equipment.head.id) {
                const headCleanId = equipment.head.id.replace(/^minecraft:/, "");
                if (headCleanId === "piglin_head") {
                    const mat = new Three.MeshBasicMaterial({
                        transparent: true,
                        alphaTest: 0.5,
                        side: Three.FrontSide,
                        depthWrite: true,
                        visible: false
                    });
                    if (equipment.head.enchanted) applyGlintToMaterial(Three, mat, true);

                    const piglinGroup = new Three.Group();
                    const headGeom = createBoxGeometry(Three, 10, 8, 8, [0, 0, 10, 8, 8], 0.1, 64, 64);
                    piglinGroup.add(new Three.Mesh(headGeom, mat));

                    const snoutGeom = createBoxGeometry(Three, 4, 4, 1, [31, 1, 4, 4, 1], 0.1, 64, 64);
                    const snoutMesh = new Three.Mesh(snoutGeom, mat);
                    snoutMesh.position.set(0, -2 * PIXEL, 4.5 * PIXEL);
                    piglinGroup.add(snoutMesh);

                    const lTuskGeom = createBoxGeometry(Three, 1, 2, 1, [2, 4, 1, 2, 1], 0, 64, 64);
                    const lTuskMesh = new Three.Mesh(lTuskGeom, mat);
                    lTuskMesh.position.set(2.5 * PIXEL, -3 * PIXEL, 4.5 * PIXEL);
                    piglinGroup.add(lTuskMesh);

                    const rTuskGeom = createBoxGeometry(Three, 1, 2, 1, [2, 0, 1, 2, 1], 0, 64, 64);
                    const rTuskMesh = new Three.Mesh(rTuskGeom, mat);
                    rTuskMesh.position.set(-2.5 * PIXEL, -3 * PIXEL, 4.5 * PIXEL);
                    piglinGroup.add(rTuskMesh);

                    // Ears drooping outward at 30 degrees
                    const lEarGeom = createBoxGeometry(Three, 1, 5, 4, [51, 6, 1, 5, 4], 0, 64, 64);
                    lEarGeom.translate(0.5 * PIXEL, -2.5 * PIXEL, 0);
                    const lEarGroup = new Three.Group();
                    lEarGroup.position.set(4.5 * PIXEL, 2 * PIXEL, 0);
                    lEarGroup.rotation.z = 30 * Math.PI / 180;
                    lEarGroup.add(new Three.Mesh(lEarGeom, mat));
                    piglinGroup.add(lEarGroup);

                    const rEarGeom = createBoxGeometry(Three, 1, 5, 4, [39, 6, 1, 5, 4], 0, 64, 64);
                    rEarGeom.translate(-0.5 * PIXEL, -2.5 * PIXEL, 0);
                    const rEarGroup = new Three.Group();
                    rEarGroup.position.set(-4.5 * PIXEL, 2 * PIXEL, 0);
                    rEarGroup.rotation.z = -30 * Math.PI / 180;
                    rEarGroup.add(new Three.Mesh(rEarGeom, mat));
                    piglinGroup.add(rEarGroup);

                    piglinGroup.position.set(0, 4 * PIXEL, 0);
                    groups.head.add(piglinGroup);

                    loadItemTexture("textures/items/piglin_head.png").then(tex => {
                        if (tex) {
                            mat.map = tex;
                            mat.visible = true;
                            mat.needsUpdate = true;
                        }
                    });
                } else if (headCleanId === "dragon_head") {
                    const mat = new Three.MeshBasicMaterial({
                        transparent: true,
                        alphaTest: 0.5,
                        side: Three.FrontSide,
                        depthWrite: true,
                        visible: false
                    });
                    if (equipment.head.enchanted) applyGlintToMaterial(Three, mat, true);

                    const dragonGroup = new Three.Group();
                    const upperHeadGeom = createBoxGeometry(Three, 16, 16, 16, [112, 30, 16, 16, 16], 0, 256, 256);
                    dragonGroup.add(new Three.Mesh(upperHeadGeom, mat));

                    const lipGeom = createBoxGeometry(Three, 12, 5, 16, [176, 44, 12, 5, 16], 0, 256, 256);
                    const lipMesh = new Three.Mesh(lipGeom, mat);
                    lipMesh.position.set(0, -1.5 * PIXEL, 14 * PIXEL);
                    dragonGroup.add(lipMesh);

                    const jawGeom = createBoxGeometry(Three, 12, 4, 16, [176, 65, 12, 4, 16], 0, 256, 256);
                    const jawMesh = new Three.Mesh(jawGeom, mat);
                    jawMesh.position.set(0, -6 * PIXEL, 14 * PIXEL);
                    dragonGroup.add(jawMesh);

                    const rHornGeom = createBoxGeometry(Three, 2, 4, 6, [0, 0, 2, 4, 6], 0, 256, 256, false);
                    const rHornMesh = new Three.Mesh(rHornGeom, mat);
                    rHornMesh.position.set(4 * PIXEL, 10 * PIXEL, -2 * PIXEL);
                    dragonGroup.add(rHornMesh);

                    const lHornGeom = createBoxGeometry(Three, 2, 4, 6, [0, 0, 2, 4, 6], 0, 256, 256, true);
                    const lHornMesh = new Three.Mesh(lHornGeom, mat);
                    lHornMesh.position.set(-4 * PIXEL, 10 * PIXEL, -2 * PIXEL);
                    dragonGroup.add(lHornMesh);

                    const rNostrilGeom = createBoxGeometry(Three, 2, 2, 4, [112, 0, 2, 2, 4], 0, 256, 256, false);
                    const rNostrilMesh = new Three.Mesh(rNostrilGeom, mat);
                    rNostrilMesh.position.set(4 * PIXEL, 2 * PIXEL, 20 * PIXEL);
                    dragonGroup.add(rNostrilMesh);

                    const lNostrilGeom = createBoxGeometry(Three, 2, 2, 4, [112, 0, 2, 2, 4], 0, 256, 256, true);
                    const lNostrilMesh = new Three.Mesh(lNostrilGeom, mat);
                    lNostrilMesh.position.set(-4 * PIXEL, 2 * PIXEL, 20 * PIXEL);
                    dragonGroup.add(lNostrilMesh);

                    dragonGroup.scale.set(0.75, 0.75, 0.75);
                    dragonGroup.position.set(0, 4 * PIXEL, -2 * PIXEL);
                    groups.head.add(dragonGroup);

                    loadItemTexture("textures/items/dragon_head.png").then(tex => {
                        if (tex) {
                            mat.map = tex;
                            mat.visible = true;
                            mat.needsUpdate = true;
                        }
                    });
                } else if (equipment.head.asset) {
                    const asset = equipment.head.asset;
                    const mat = createArmorMat(asset, false, equipment.head.color, equipment.head.enchanted);
                    const geom = createBoxGeometry(Three, 8, 8, 8, [0, 0, 8, 8, 8], 0.6, 32);
                    geom.translate(0, 4 * PIXEL, 0);
                    groups.head.add(new Three.Mesh(geom, mat));

                    if (asset === "leather") {
                        const oMat = createLeatherOverlayMat(false, equipment.head.enchanted);
                        const oGeom = createBoxGeometry(Three, 8, 8, 8, [0, 0, 8, 8, 8], 0.62, 32);
                        oGeom.translate(0, 4 * PIXEL, 0);
                        groups.head.add(new Three.Mesh(oGeom, oMat));
                    }
                }
            }

            // 2. CHESTPLATE / ELYTRA
            instance.elytraWings = null;
            if (equipment.chest && equipment.chest.asset) {
                const asset = equipment.chest.asset;
                if (asset === "elytra" || equipment.chest.id?.includes("elytra")) {
                    const mat = new Three.MeshBasicMaterial({
                        transparent: true,
                        alphaTest: 0.1,
                        side: Three.DoubleSide,
                        depthWrite: false
                    });
                    if (equipment.chest.enchanted) {
                        applyGlintToMaterial(Three, mat, true);
                    }
                    const url = "assets/bluemap-player-models/textures/armor/wings/elytra.png";
                    const img = new Image();
                    img.crossOrigin = "anonymous";
                    img.onload = () => {
                        const tex = new Three.Texture(img);
                        configureTexture(tex);
                        mat.map = tex;
                        mat.needsUpdate = true;
                    };
                    img.src = url;

                    const rWingGeom = createBoxGeometry(Three, 10, 20, 2, [22, 0, 10, 20, 2], 0, 32);
                    rWingGeom.translate(5 * PIXEL, -10 * PIXEL, 0);
                    const rWing = new Three.Mesh(rWingGeom, mat);
                    rWing.position.set(0, 10 * PIXEL, 2.5 * PIXEL);
                    rWing.rotation.set(0.26, 0, -0.26);
                    groups.torso.add(rWing);

                    const lWingGeom = createBoxGeometry(Three, 10, 20, 2, [22, 0, 10, 20, 2], 0, 32);
                    lWingGeom.translate(-5 * PIXEL, -10 * PIXEL, 0);
                    const lWing = new Three.Mesh(lWingGeom, mat);
                    lWing.position.set(0, 10 * PIXEL, 2.5 * PIXEL);
                    lWing.rotation.set(0.26, 0, 0.26);
                    groups.torso.add(lWing);

                    instance.elytraWings = { left: lWing, right: rWing };
                } else {
                    instance.elytraWings = null;
                    const mat = createArmorMat(asset, false, equipment.chest.color, equipment.chest.enchanted);

                    // Torso
                    const torsoGeom = createBoxGeometry(Three, 8, 12, 4, [16, 16, 8, 12, 4], 0.65, 32);
                    groups.torso.add(new Three.Mesh(torsoGeom, mat));

                    // Right Arm
                    const rArmGeom = createArmorArmGeometry(Three, armWidth, false, 0.55);
                    groups.rightArm.add(new Three.Mesh(rArmGeom, mat));

                    // Left Arm
                    const lArmGeom = createArmorArmGeometry(Three, armWidth, true, 0.55);
                    groups.leftArm.add(new Three.Mesh(lArmGeom, mat));

                    if (asset === "leather") {
                        const oMat = createLeatherOverlayMat(false, equipment.chest.enchanted);
                        const oTorso = createBoxGeometry(Three, 8, 12, 4, [16, 16, 8, 12, 4], 0.67, 32);
                        groups.torso.add(new Three.Mesh(oTorso, oMat));

                        const oRArm = createArmorArmGeometry(Three, armWidth, false, 0.57);
                        groups.rightArm.add(new Three.Mesh(oRArm, oMat));

                        const oLArm = createArmorArmGeometry(Three, armWidth, true, 0.57);
                        groups.leftArm.add(new Three.Mesh(oLArm, oMat));
                    }
                }
            }

            // 3. LEGGINGS
            if (equipment.legs && equipment.legs.asset) {
                const asset = equipment.legs.asset;
                const mat = createArmorMat(asset, true, equipment.legs.color, equipment.legs.enchanted);

                // Belt / Pants top
                const beltGeom = createLeggingsBeltGeometry(Three, 0.38);
                groups.torso.add(new Three.Mesh(beltGeom, mat));

                // Right Leg
                const rLegGeom = createArmorLegGeometry(Three, false, 0.32);
                groups.rightLeg.add(new Three.Mesh(rLegGeom, mat));

                // Left Leg
                const lLegGeom = createArmorLegGeometry(Three, true, 0.32);
                groups.leftLeg.add(new Three.Mesh(lLegGeom, mat));

                if (asset === "leather") {
                    const oMat = createLeatherOverlayMat(true, equipment.legs.enchanted);
                    const oBelt = createLeggingsBeltGeometry(Three, 0.40);
                    groups.torso.add(new Three.Mesh(oBelt, oMat));

                    const oRLeg = createArmorLegGeometry(Three, false, 0.34);
                    groups.rightLeg.add(new Three.Mesh(oRLeg, oMat));

                    const oLLeg = createArmorLegGeometry(Three, true, 0.34);
                    groups.leftLeg.add(new Three.Mesh(oLLeg, oMat));
                }
            }

            // 4. BOOTS
            if (equipment.feet && equipment.feet.asset) {
                const asset = equipment.feet.asset;
                const mat = createArmorMat(asset, false, equipment.feet.color, equipment.feet.enchanted);

                // Right Boot
                const rBootGeom = createArmorBootGeometry(Three, false, 0.6);
                groups.rightLeg.add(new Three.Mesh(rBootGeom, mat));

                // Left Boot
                const lBootGeom = createArmorBootGeometry(Three, true, 0.6);
                groups.leftLeg.add(new Three.Mesh(lBootGeom, mat));

                if (asset === "leather") {
                    const oMat = createLeatherOverlayMat(false, equipment.feet.enchanted);
                    const oRBoot = createArmorBootGeometry(Three, false, 0.62);
                    groups.rightLeg.add(new Three.Mesh(oRBoot, oMat));

                    const oLBoot = createArmorBootGeometry(Three, true, 0.62);
                    groups.leftLeg.add(new Three.Mesh(oLBoot, oMat));
                }
            }

            // 5. MAIN HAND
            if (equipment.mainHand && equipment.mainHand.id) {
                renderHeldItem(groups.mainHand, equipment.mainHand, true, instance.data?.skinUrl, instance);
            }

            // 6. OFF HAND
            if (equipment.offHand && equipment.offHand.id) {
                renderHeldItem(groups.offHand, equipment.offHand, false, instance.data?.skinUrl, instance);
            }
        }

        function destroyPlayerModel(parts) {
            if (!parts) return;
            if (parts.equipGroups) {
                Object.values(parts.equipGroups).forEach(clearGroup);
            }
            if (parts.root) {
                parts.root.traverse(child => {
                    if (child.geometry && !child.geometry.userData?.isCached) {
                        child.geometry.dispose();
                    }
                });
                if (parts.root.parent) {
                    parts.root.parent.remove(parts.root);
                }
            }
        }

        function destroyPlayerInstance(instance) {
            if (!instance) return;
            instance.dynamicHeldItems = [];
            destroyPlayerModel(instance.parts);
            if (instance.baseMaterial) instance.baseMaterial.dispose();
            if (instance.overlayMaterial) instance.overlayMaterial.dispose();
        }

        function createPlayerInstance(data) {
            const isSlimInitial = Boolean(data.slim);

            const baseMaterial = new Three.MeshBasicMaterial({
                color: 0xffffff,
                side: Three.FrontSide
            });
            baseMaterial.userData.isShared = true;

            const overlayMaterial = new Three.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                alphaTest: 0.5,
                depthWrite: true,
                side: Three.FrontSide,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -1
            });
            overlayMaterial.userData.isShared = true;

            let parts = createPlayerModel(Three, baseMaterial, overlayMaterial, isSlimInitial);
            setupEquipmentGroups(parts);

            playerContainer.add(parts.root);

            const instance = {
                data: data,
                parts: parts,
                baseMaterial: baseMaterial,
                overlayMaterial: overlayMaterial,
                dynamicHeldItems: [],
                currentPos: new Three.Vector3(data.x, data.y, data.z),
                targetPos: new Three.Vector3(data.x, data.y, data.z),
                currentYaw: data.yaw || 0,
                targetYaw: data.yaw || 0,
                currentHeadYaw: data.headYaw !== undefined ? data.headYaw : (data.yaw || 0),
                targetHeadYaw: data.headYaw !== undefined ? data.headYaw : (data.yaw || 0),
                currentPitch: data.pitch || 0,
                animTime: 0,
                idleTime: 0,
                idleOffset: (data.uuid ? (data.uuid.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 100) * 0.1 : Math.random() * 10),
                elytraWings: null
            };

            if (data.equipment) {
                updateEquipment(instance, data.equipment);
            }

            const initialSkin = data.localSkinUrl || data.skinUrl;
            if (initialSkin) {
                loadSkinTexture(initialSkin).then(result => {
                    if (!result) return;
                    baseMaterial.map = result.texture;
                    baseMaterial.needsUpdate = true;
                    overlayMaterial.map = result.texture;
                    overlayMaterial.needsUpdate = true;

                    // If detected model type differs from initial, rebuild model with proper arm width
                    const detectedSlim = data.slim !== undefined ? (Boolean(data.slim) || Boolean(result.isSlim)) : Boolean(result.isSlim);
                    if (detectedSlim !== instance.parts.isSlim) {
                        destroyPlayerModel(instance.parts);
                        instance.parts = createPlayerModel(Three, baseMaterial, overlayMaterial, detectedSlim);
                        setupEquipmentGroups(instance.parts);
                        playerContainer.add(instance.parts.root);
                        updateEquipment(instance, instance.data.equipment);
                    }
                });
            }

            return instance;
        }

        function ensureNativePlayerLabels() {
            // Keep native 2D playerhead icon hidden
            document.querySelectorAll('img[alt="playerhead"], .bm-marker-player > img').forEach(img => {
                img.style.setProperty("display", "none", "important");
                img.style.setProperty("visibility", "hidden", "important");
                img.style.setProperty("opacity", "0", "important");
            });
        }

        async function fetchPlayers() {
            try {
                ensureNativePlayerLabels();
                const response = await fetch(`${DATA_PATH}?_t=${Date.now()}`);
                if (!response.ok) return;

                const playersList = await response.json();
                if (!Array.isArray(playersList)) return;

                const activeUuids = new Set();

                for (const pData of playersList) {
                    activeUuids.add(pData.uuid);
                    let instance = loadedPlayers.get(pData.uuid);

                    if (!instance) {
                        instance = createPlayerInstance(pData);
                        loadedPlayers.set(pData.uuid, instance);
                    } else {
                        instance.targetPos.set(pData.x, pData.y, pData.z);
                        instance.targetYaw = pData.yaw || 0;
                        instance.targetHeadYaw = pData.headYaw !== undefined ? pData.headYaw : (pData.yaw || 0);

                        if (pData.slim !== undefined && Boolean(pData.slim) !== instance.parts.isSlim) {
                            destroyPlayerModel(instance.parts);
                            instance.parts = createPlayerModel(Three, instance.baseMaterial, instance.overlayMaterial, Boolean(pData.slim));
                            setupEquipmentGroups(instance.parts);
                            playerContainer.add(instance.parts.root);
                            updateEquipment(instance, pData.equipment);
                        }

                        const newSkin = pData.localSkinUrl || pData.skinUrl;
                        const oldSkin = instance.data.localSkinUrl || instance.data.skinUrl;
                        if (newSkin && newSkin !== oldSkin) {
                            loadSkinTexture(newSkin).then(result => {
                                if (!result) return;
                                instance.baseMaterial.map = result.texture;
                                instance.baseMaterial.needsUpdate = true;
                                instance.overlayMaterial.map = result.texture;
                                instance.overlayMaterial.needsUpdate = true;

                                const detectedSlim = pData.slim !== undefined ? (Boolean(pData.slim) || Boolean(result.isSlim)) : Boolean(result.isSlim);
                                if (detectedSlim !== instance.parts.isSlim) {
                                    destroyPlayerModel(instance.parts);
                                    instance.parts = createPlayerModel(Three, instance.baseMaterial, instance.overlayMaterial, detectedSlim);
                                    setupEquipmentGroups(instance.parts);
                                    playerContainer.add(instance.parts.root);
                                    updateEquipment(instance, pData.equipment);
                                }
                            });
                        }

                        if (JSON.stringify(instance.data.equipment) !== JSON.stringify(pData.equipment)) {
                            updateEquipment(instance, pData.equipment);
                        }
                        instance.data = pData;
                    }
                }

                for (const [uuid, instance] of loadedPlayers.entries()) {
                    if (!activeUuids.has(uuid)) {
                        destroyPlayerInstance(instance);
                        loadedPlayers.delete(uuid);
                    }
                }
            } catch (err) {
                // Ignore transient network errors
            }
        }

        function updateDynamicHeldItems(instance, now) {
            if (!instance.dynamicHeldItems || instance.dynamicHeldItems.length === 0) return;
            for (let i = 0; i < instance.dynamicHeldItems.length; i++) {
                const dyn = instance.dynamicHeldItems[i];
                if (!dyn.mat) continue;

                let targetFrame = 0;
                if (dyn.type === "clock") {
                    const worldTime = instance.data?.worldTime;
                    if (worldTime !== null && worldTime !== undefined) {
                        const timeFraction = (((worldTime - 6000) % 24000 + 24000) % 24000) / 24000;
                        targetFrame = Math.floor(timeFraction * 64 + 0.5) % 64;
                    } else {
                        // Non-overworld dimension (Nether / End): spin continuously
                        targetFrame = Math.floor((now / 100) % 64);
                    }
                } else if (dyn.type === "compass" || dyn.type === "recovery_compass") {
                    const handItem = dyn.isMainHand ? instance.data?.equipment?.mainHand : instance.data?.equipment?.offHand;
                    const targetPos = handItem?.targetPos || dyn.item?.targetPos;
                    if (targetPos && Array.isArray(targetPos) && targetPos.length >= 2) {
                        const dx = (targetPos[0] + 0.5) - instance.currentPos.x;
                        const dz = (targetPos[1] + 0.5) - instance.currentPos.z;
                        const angleFromEntityToPos = Math.atan2(dz, dx) / (2 * Math.PI);
                        const visualRotationY = ((instance.currentYaw / 360) % 1 + 1) % 1;
                        const rot = ((0.75 - visualRotationY + angleFromEntityToPos) % 1 + 1) % 1;
                        targetFrame = (16 + Math.round(rot * 32)) % 32;
                    } else {
                        // No target (e.g. Nether/End without lodestone, or recovery compass before death): spin continuously
                        targetFrame = Math.floor((now / 80) % 32);
                    }
                }

                if (targetFrame !== dyn.lastFrame) {
                    dyn.lastFrame = targetFrame;
                    const frameStr = String(targetFrame).padStart(2, "0");
                    const texPath = `textures/items/${dyn.type}_${frameStr}.png`;
                    const cached = dynamicTextureCache.get(texPath);
                    if (cached) {
                        dyn.mat.map = cached;
                        dyn.mat.needsUpdate = true;
                    } else {
                        loadItemTexture(texPath).then(tex => {
                            if (tex) {
                                dynamicTextureCache.set(texPath, tex);
                                if (dyn.mat && dyn.lastFrame === targetFrame) {
                                    dyn.mat.map = tex;
                                    dyn.mat.needsUpdate = true;
                                }
                            }
                        });
                    }
                }
            }
        }

        function lerpAngleDeg(current, target, factor) {
            let diff = (target - current + 540) % 360 - 180;
            return current + diff * factor;
        }

        let lastFrameTime = performance.now();

        function updateScene() {
            const now = performance.now();
            const delta = Math.min((now - lastFrameTime) / 1000, 0.1);
            lastFrameTime = now;

            // Animate dynamic multi-frame textures (e.g. sculk sensor, stonecutter saw, prismarine, etc.)
            if (activeAnimatedTextures.length > 0) {
                for (let i = 0; i < activeAnimatedTextures.length; i++) {
                    const anim = activeAnimatedTextures[i];
                    anim.timer += delta;
                    const stepDuration = anim.frameDurations ? anim.frameDurations[anim.currentStep] : anim.uniformDuration;
                    if (anim.timer >= stepDuration) {
                        anim.timer = 0;
                        anim.currentStep = (anim.currentStep + 1) % anim.totalSteps;
                        const frameIdx = anim.frameSequence ? anim.frameSequence[anim.currentStep] : anim.currentStep;
                        anim.ctx.clearRect(0, 0, anim.w, anim.w);
                        anim.ctx.drawImage(anim.img, 0, frameIdx * anim.w, anim.w, anim.w, 0, 0, anim.w, anim.w);
                        anim.tex.needsUpdate = true;
                    }
                }
            }

            // Advance enchantment glint animation time
            glintUniforms.uGlintTime.value += delta;

            const lerpFactor = Math.min(delta * 10, 1.0);
            const currentMapId = app.mapViewer?.map?.id;

            // Sync 3D player models container visibility with BlueMap "Players" marker set
            let markerSetVisible = true;
            if (app.playerMarkerManager) {
                try {
                    const pSet = app.playerMarkerManager.getPlayerMarkerSet(false);
                    if (pSet) {
                        markerSetVisible = Boolean(pSet.visible);
                    }
                } catch (_) {}
            }
            playerContainer.visible = markerSetVisible;
            if (!markerSetVisible) {
                animId = requestAnimationFrame(updateScene);
                if (window.__bpmState) window.__bpmState.animFrame = animId;
                return;
            }

            for (const instance of loadedPlayers.values()) {
                const { parts, currentPos, targetPos, data } = instance;

                // Dimension and map visibility check
                let isVisible = true;
                if (currentMapId && data.maps && data.maps.length > 0) {
                    isVisible = data.maps.includes(currentMapId);
                }
                if (isVisible && app.playerMarkerManager) {
                    try {
                        const nativeMarker = app.playerMarkerManager.getPlayerMarker(data.uuid);
                        if (nativeMarker) {
                            if (nativeMarker.data?.foreign || !nativeMarker.visible) {
                                isVisible = false;
                            }
                        }
                    } catch (_) {}
                }

                parts.root.visible = isVisible;
                if (!isVisible) continue;

                // Position Lerp
                currentPos.lerp(targetPos, lerpFactor);
                parts.root.position.copy(currentPos);

                // Smooth Rotation Interpolation
                instance.currentYaw = lerpAngleDeg(instance.currentYaw, instance.targetYaw || 0, lerpFactor);
                instance.currentHeadYaw = lerpAngleDeg(instance.currentHeadYaw, instance.targetHeadYaw !== undefined ? instance.targetHeadYaw : (instance.targetYaw || 0), lerpFactor);
                instance.currentPitch += ((data.pitch || 0) - instance.currentPitch) * lerpFactor;

                const isSleeping = Boolean(data.sleeping);
                const isFlyingOrSwimming = Boolean(data.fallFlying || data.swimming);
                const isSitting = Boolean(data.sitting);
                const isMount = Boolean(data.vehicle && (data.vehicle.includes("horse") || data.vehicle.includes("camel") || data.vehicle.includes("donkey") || data.vehicle.includes("mule") || data.vehicle.includes("pig") || data.vehicle.includes("strider") || data.vehicle.includes("llama")));

                // Body rotation (root Y-rotation)
                if (isSleeping) {
                    let sleepYaw = instance.currentYaw;
                    if (data.sleepDirection) {
                        const dir = String(data.sleepDirection).toLowerCase();
                        if (dir === "north") sleepYaw = 0;
                        else if (dir === "south") sleepYaw = 180;
                        else if (dir === "east") sleepYaw = 90;
                        else if (dir === "west") sleepYaw = 270;
                    }
                    parts.root.rotation.y = -Three.MathUtils.degToRad(sleepYaw);
                    parts.root.rotation.x = -Math.PI / 2;
                    parts.root.rotation.z = 0;

                    // Align sleeping model: head on pillow, feet towards foot of bed
                    parts.torso.position.set(0, -6 * PIXEL, 0);
                    parts.rightLeg.position.set(-1.9 * PIXEL, -12 * PIXEL, 0);
                    parts.leftLeg.position.set(1.9 * PIXEL, -12 * PIXEL, 0);
                } else if (isFlyingOrSwimming) {
                    parts.root.rotation.y = -Three.MathUtils.degToRad(instance.currentYaw);
                    parts.root.rotation.x = -Math.PI / 2;
                    parts.root.rotation.z = 0;

                    parts.torso.position.set(0, 18 * PIXEL, 0);
                    parts.rightLeg.position.set(-1.9 * PIXEL, 12 * PIXEL, 0);
                    parts.leftLeg.position.set(1.9 * PIXEL, 12 * PIXEL, 0);
                } else if (isSitting) {
                    parts.root.rotation.y = -Three.MathUtils.degToRad(instance.currentYaw);
                    parts.root.rotation.x = 0;
                    parts.root.rotation.z = 0;

                    if (!data.vehicle) {
                        parts.root.position.y = currentPos.y - 9 * PIXEL;
                    }
                    parts.torso.position.set(0, 18 * PIXEL, 0);
                    parts.rightLeg.position.set(-1.9 * PIXEL, 12 * PIXEL, 0);
                    parts.leftLeg.position.set(1.9 * PIXEL, 12 * PIXEL, 0);
                } else {
                    parts.root.rotation.y = -Three.MathUtils.degToRad(instance.currentYaw);
                    parts.root.rotation.x = 0;
                    parts.root.rotation.z = 0;

                    parts.torso.position.set(0, 18 * PIXEL, 0);
                    parts.rightLeg.position.set(-1.9 * PIXEL, 12 * PIXEL, 0);
                    parts.leftLeg.position.set(1.9 * PIXEL, 12 * PIXEL, 0);
                }

                // Dynamic held items (Clock, Compass, Recovery Compass)
                if (instance.dynamicHeldItems && instance.dynamicHeldItems.length > 0) {
                    updateDynamicHeldItems(instance, now);
                }

                // Head relative yaw (clamped to [-45, 45] deg)
                let headYawDiff = (instance.currentHeadYaw - instance.currentYaw + 540) % 360 - 180;
                headYawDiff = Math.max(-45, Math.min(45, headYawDiff));
                if (isSleeping || isFlyingOrSwimming) {
                    parts.head.rotation.y = 0;
                } else {
                    parts.head.rotation.y = -Three.MathUtils.degToRad(headYawDiff);
                }

                // Elytra wings spread animation
                if (instance.elytraWings) {
                    if (data.fallFlying) {
                        instance.elytraWings.left.rotation.set(0.1, 0.4, 0.6);
                        instance.elytraWings.right.rotation.set(0.1, -0.4, -0.6);
                    } else {
                        instance.elytraWings.left.rotation.set(0.26, 0, 0.26);
                        instance.elytraWings.right.rotation.set(0.26, 0, -0.26);
                    }
                }

                // Arm & Leg animation with Minecraft-accurate held item pose & idle animation
                const isMoving = (!isSitting && !isSleeping) && (data.moving || currentPos.distanceTo(targetPos) > 0.05);
                const hasMainHand = Boolean(data.equipment?.mainHand?.id);
                const hasOffHand = Boolean(data.equipment?.offHand?.id);

                const baseRightX = hasMainHand ? -0.40 : 0;
                const baseLeftX = hasOffHand ? -0.40 : 0;
                const baseRightY = hasMainHand ? -0.1 : 0;
                const baseLeftY = hasOffHand ? 0.1 : 0;

                const isSprinting = Boolean(data.sprinting && isMoving);
                const animSpeed = isSprinting ? 18 : 12;

                // Advance idle breathing animation time
                instance.idleTime = (instance.idleTime || 0) + delta;
                const idlePhase = instance.idleTime * 2.2 + (instance.idleOffset || 0);

                // Idle breathing terms (matching vanilla Minecraft HumanoidModel.setupAnim)
                const idleArmZ = Math.cos(idlePhase * 0.9) * 0.035 + 0.035;
                const idleArmX = Math.sin(idlePhase * 0.7) * 0.03;
                const idleTorsoY = Math.sin(idlePhase * 0.9) * (0.08 * PIXEL);
                const idleTorsoRotX = Math.sin(idlePhase * 0.9) * 0.008;

                // Head pitch
                if (isSleeping) {
                    parts.head.rotation.x = 0;
                } else if (isFlyingOrSwimming) {
                    parts.head.rotation.x = -Math.PI / 4;
                } else {
                    const idleHeadPitch = !isMoving ? -idleTorsoRotX * 1.2 : 0;
                    parts.head.rotation.x = Three.MathUtils.degToRad(instance.currentPitch) + idleHeadPitch;
                }

                if (isSleeping) {
                    // Resting straight along torso in bed
                    parts.rightArm.rotation.set(0, 0, 0);
                    parts.leftArm.rotation.set(0, 0, 0);
                    parts.rightLeg.rotation.set(0, 0, 0);
                    parts.leftLeg.rotation.set(0, 0, 0);
                    const sleepBreath = Math.sin(idlePhase * 0.8) * (0.05 * PIXEL);
                    parts.torso.position.y = -6 * PIXEL + sleepBreath;
                    parts.torso.rotation.set(0, 0, 0);
                    parts.head.position.y = 6 * PIXEL;
                } else if (isFlyingOrSwimming) {
                    // Limbs aligned with body when flying/swimming
                    parts.rightArm.rotation.set(0, 0, 0);
                    parts.leftArm.rotation.set(0, 0, 0);
                    parts.rightLeg.rotation.set(0, 0, 0);
                    parts.leftLeg.rotation.set(0, 0, 0);
                    parts.torso.rotation.set(0, 0, 0);
                    parts.head.position.y = 6 * PIXEL;
                    parts.torso.position.y = 18 * PIXEL;
                } else if (isSitting) {
                    if (isMount) {
                        parts.torso.rotation.x = idleTorsoRotX;
                        parts.torso.position.y = 18 * PIXEL + idleTorsoY;
                        parts.head.position.y = 6 * PIXEL;

                        parts.rightLeg.rotation.set(-0.78, -0.25, -0.08);
                        parts.leftLeg.rotation.set(-0.78, 0.25, 0.08);

                        parts.rightArm.rotation.set(baseRightX - 0.62831855, baseRightY, 0);
                        parts.leftArm.rotation.set(baseLeftX - 0.62831855, baseLeftY, 0);
                    } else {
                        // Authentic floor / chair / boat sitting pose matching Image 1
                        parts.torso.rotation.x = idleTorsoRotX;
                        parts.torso.rotation.y = 0;
                        parts.torso.rotation.z = 0;
                        parts.torso.position.set(0, 18 * PIXEL + idleTorsoY, 0);
                        parts.head.position.y = 6 * PIXEL;

                        // Legs flat on ground/seat, splayed OUTWARD in wide V-shape (matching Image 1)
                        parts.rightLeg.rotation.set(-1.45, -0.10, -0.32);
                        parts.leftLeg.rotation.set(-1.45, 0.10, 0.32);

                        // Normal sitting arms (pointing forward/down, no flare)
                        const targetRightX = baseRightX - 0.62831855 + idleArmX * (hasMainHand ? 0.35 : 1.0);
                        const targetLeftX = baseLeftX - 0.62831855 - idleArmX * (hasOffHand ? 0.35 : 1.0);
                        const targetRightZ = -idleArmZ * (hasMainHand ? 0.4 : 1.0);
                        const targetLeftZ = idleArmZ * (hasOffHand ? 0.4 : 1.0);

                        parts.rightArm.rotation.x += (targetRightX - parts.rightArm.rotation.x) * 0.2;
                        parts.leftArm.rotation.x += (targetLeftX - parts.leftArm.rotation.x) * 0.2;
                        parts.rightArm.rotation.y += (baseRightY - parts.rightArm.rotation.y) * 0.2;
                        parts.leftArm.rotation.y += (baseLeftY - parts.leftArm.rotation.y) * 0.2;
                        parts.rightArm.rotation.z += (targetRightZ - parts.rightArm.rotation.z) * 0.2;
                        parts.leftArm.rotation.z += (targetLeftZ - parts.leftArm.rotation.z) * 0.2;
                    }
                } else if (isMoving) {
                    instance.animTime += delta * animSpeed;
                    const swing = Math.sin(instance.animTime) * (isSprinting ? 0.8 : 0.6);
                    parts.rightArm.rotation.x = baseRightX + (hasMainHand ? swing * 0.25 : swing);
                    parts.leftArm.rotation.x = baseLeftX - (hasOffHand ? swing * 0.25 : swing);
                    parts.rightLeg.rotation.x = -swing;
                    parts.leftLeg.rotation.x = swing;
                    parts.rightLeg.rotation.y = 0;
                    parts.leftLeg.rotation.y = 0;
                    parts.rightLeg.rotation.z = 0;
                    parts.leftLeg.rotation.z = 0;
                    // Decay idle arm flare while walking
                    parts.rightArm.rotation.z += (0 - parts.rightArm.rotation.z) * 0.2;
                    parts.leftArm.rotation.z += (0 - parts.leftArm.rotation.z) * 0.2;
                    parts.rightArm.rotation.y += (baseRightY - parts.rightArm.rotation.y) * 0.2;
                    parts.leftArm.rotation.y += (baseLeftY - parts.leftArm.rotation.y) * 0.2;

                    if (data.crouching) {
                        parts.torso.rotation.x = 0.45;
                        parts.head.position.y = 4 * PIXEL;
                        parts.torso.position.y = 15 * PIXEL;
                    } else if (isSprinting) {
                        parts.torso.rotation.x = 0.15;
                        parts.head.position.y = 6 * PIXEL;
                        parts.torso.position.y = 18 * PIXEL;
                    } else {
                        parts.torso.rotation.x = 0;
                        parts.head.position.y = 6 * PIXEL;
                        parts.torso.position.y = 18 * PIXEL;
                    }
                } else {
                    // Standing stationary idle breathing animation
                    const targetRightX = baseRightX + idleArmX * (hasMainHand ? 0.35 : 1.0);
                    const targetLeftX = baseLeftX - idleArmX * (hasOffHand ? 0.35 : 1.0);
                    const targetRightZ = -idleArmZ * (hasMainHand ? 0.4 : 1.0);
                    const targetLeftZ = idleArmZ * (hasOffHand ? 0.4 : 1.0);

                    parts.rightArm.rotation.x += (targetRightX - parts.rightArm.rotation.x) * 0.2;
                    parts.leftArm.rotation.x += (targetLeftX - parts.leftArm.rotation.x) * 0.2;
                    parts.rightArm.rotation.z += (targetRightZ - parts.rightArm.rotation.z) * 0.2;
                    parts.leftArm.rotation.z += (targetLeftZ - parts.leftArm.rotation.z) * 0.2;
                    parts.rightLeg.rotation.x *= 0.85;
                    parts.leftLeg.rotation.x *= 0.85;
                    parts.rightLeg.rotation.y = 0;
                    parts.leftLeg.rotation.y = 0;
                    parts.rightLeg.rotation.z = 0;
                    parts.leftLeg.rotation.z = 0;
                    parts.rightArm.rotation.y += (baseRightY - parts.rightArm.rotation.y) * 0.2;
                    parts.leftArm.rotation.y += (baseLeftY - parts.leftArm.rotation.y) * 0.2;

                    // Crouching pose vs Sprinting tilt vs Idle Breathing
                    const crouchFactor = data.crouching ? 0.5 : 1.0;
                    const breathY = idleTorsoY * crouchFactor;
                    const breathRotX = idleTorsoRotX * crouchFactor;

                    if (data.crouching) {
                        parts.torso.rotation.x = 0.45 + breathRotX;
                        parts.head.position.y = 4 * PIXEL;
                        parts.torso.position.y = 15 * PIXEL + breathY;
                    } else {
                        parts.torso.rotation.x = breathRotX;
                        parts.head.position.y = 6 * PIXEL;
                        parts.torso.position.y = 18 * PIXEL + breathY;
                    }
                }
            }

            animId = requestAnimationFrame(updateScene);
            if (window.__bpmState) window.__bpmState.animFrame = animId;
        }

        let animId = null;
        const pollId = setInterval(fetchPlayers, POLL_INTERVAL);
        fetchPlayers();
        animId = requestAnimationFrame(updateScene);

        window.__bpmState = {
            interval: pollId,
            animFrame: animId,
            container: playerContainer,
            loadedPlayers: loadedPlayers,
            destroyAll: () => {
                for (const instance of loadedPlayers.values()) {
                    destroyPlayerInstance(instance);
                }
                loadedPlayers.clear();
            }
        };

        console.log("[BlueMap-Player-Models] 3D Player Models loaded successfully!");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
