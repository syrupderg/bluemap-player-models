import os
import json

def main():
    items_def_dir = os.environ.get('MC_ITEMS_DIR', '/home/syrup/Downloads/mc/minecraft-26.3-client/assets/minecraft/items')
    item_models_dir = os.environ.get('MC_ITEM_MODELS_DIR', 'item')
    block_models_dir = os.environ.get('MC_BLOCK_MODELS_DIR', '/home/syrup/Downloads/mc/minecraft-26.3-client/assets/minecraft/models/block')

    all_models = {}
    if os.path.exists(item_models_dir):
        for f in os.listdir(item_models_dir):
            if f.endswith('.json'):
                with open(os.path.join(item_models_dir, f)) as fp:
                    data = json.load(fp)
                    all_models['item/' + f[:-5]] = data
                    all_models['minecraft:item/' + f[:-5]] = data

    if os.path.exists(block_models_dir):
        for f in os.listdir(block_models_dir):
            if f.endswith('.json'):
                with open(os.path.join(block_models_dir, f)) as fp:
                    data = json.load(fp)
                    all_models['block/' + f[:-5]] = data
                    all_models['minecraft:block/' + f[:-5]] = data

    def get_primary_model_name(m):
        if not isinstance(m, dict): return None
        t = m.get('type')
        if t == 'minecraft:model': return m.get('model')
        elif t == 'minecraft:special': return m.get('base') or m.get('model')
        elif t == 'minecraft:condition': return get_primary_model_name(m.get('on_false')) or get_primary_model_name(m.get('on_true'))
        elif t == 'minecraft:select':
            if 'fallback' in m:
                res = get_primary_model_name(m['fallback'])
                if res: return res
            cases = m.get('cases', [])
            if cases: return get_primary_model_name(cases[0].get('model'))
        elif t == 'minecraft:range_dispatch':
            if 'fallback' in m:
                res = get_primary_model_name(m['fallback'])
                if res: return res
            entries = m.get('entries', [])
            if entries: return get_primary_model_name(entries[0].get('model'))
        elif t == 'minecraft:composite':
            models = m.get('models', [])
            if models: return get_primary_model_name(models[0])
        return None

    def resolve_display(model_key, visited=None):
        if visited is None: visited = set()
        if not isinstance(model_key, str) or model_key in visited or model_key not in all_models:
            return {}
        visited.add(model_key)
        model = all_models[model_key]
        parent_key = model.get('parent')
        res = {}
        if parent_key:
            res = resolve_display(parent_key, visited).copy()
        if 'display' in model:
            for k, v in model['display'].items():
                res[k] = v
        return res

    with open('src/main/resources/web/items-registry.json') as fp:
        reg = json.load(fp)

    updated = 0
    for k, entry in reg.items():
        def_file = os.path.join(items_def_dir, k + '.json')
        model_name = None
        if os.path.exists(def_file):
            with open(def_file) as df:
                ddata = json.load(df)
                model_name = get_primary_model_name(ddata.get('model'))
        if not model_name:
            if ('item/' + k) in all_models: model_name = 'item/' + k
            elif ('block/' + k) in all_models: model_name = 'block/' + k

        disp = resolve_display(model_name) if model_name else {}
        if 'thirdperson_righthand' in disp:
            tpr = disp['thirdperson_righthand']
            entry['d'] = {
                'r': tpr.get('rotation', [0, 0, 0]),
                't': tpr.get('translation', [0, 0, 0]),
                's': tpr.get('scale', [1, 1, 1])
            }
            if 'thirdperson_lefthand' in disp:
                tpl = disp['thirdperson_lefthand']
                mirrored_r = [tpr.get('rotation', [0,0,0])[0], -tpr.get('rotation', [0,0,0])[1], -tpr.get('rotation', [0,0,0])[2]]
                mirrored_t = [-tpr.get('translation', [0,0,0])[0], tpr.get('translation', [0,0,0])[1], tpr.get('translation', [0,0,0])[2]]
                if (tpl.get('rotation', [0,0,0]) != mirrored_r or
                    tpl.get('translation', [0,0,0]) != mirrored_t or
                    tpl.get('scale', [1,1,1]) != tpr.get('scale', [1,1,1])):
                    entry['dl'] = {
                        'r': tpl.get('rotation', [0, 0, 0]),
                        't': tpl.get('translation', [0, 0, 0]),
                        's': tpl.get('scale', [1, 1, 1])
                    }
            updated += 1

    targets = [
        'src/main/resources/web/items-registry.json',
        'build/resources/main/web/items-registry.json',
        '/home/syrup/Downloads/server/bluemap/web/assets/bluemap-player-models/items-registry.json'
    ]

    dumped = json.dumps(reg, separators=(',', ':'))
    for target in targets:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, 'w') as fp:
            fp.write(dumped)
        print(f'Wrote {len(reg)} items to {target} ({len(dumped)} bytes)')

    print(f'Done! Successfully updated {updated} items with Minecraft display transforms.')

if __name__ == '__main__':
    main()
