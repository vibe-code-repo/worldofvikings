#!/usr/bin/env python3
"""
Textur-Katalog — indiziert alle Texturen unter assets/ und macht sie durchsuchbar.

Das Original-Rip (`assets/textures/`) liegt flach mit ~2800 Dateien und ohne
Ordnerstruktur; das HD-Pack (`assets/textures-hd/`) ist nach Prefab sortiert und
hat Saison-Varianten. Dieses Werkzeug legt darüber eine gemeinsame Kategorisierung.

  Index bauen:   python3 tools/texture-catalog.py build
  Suchen:        python3 tools/texture-catalog.py find leaf
                 python3 tools/texture-catalog.py find --cat terrain --map d
                 python3 tools/texture-catalog.py find grass --hd
  Übersicht:     python3 tools/texture-catalog.py stats

Ausgabe von `build`:
  assets/catalog/textures.json  — vollständiger Index
  assets/catalog/textures.tsv   — eine Zeile pro Datei, direkt grep-bar
"""

import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIRS = {
    "orig": os.path.join(ROOT, "assets/textures"),
    "hd": os.path.join(ROOT, "assets/textures-hd"),
}
OUT_DIR = os.path.join(ROOT, "assets/catalog")
JSON_PATH = os.path.join(OUT_DIR, "textures.json")
TSV_PATH = os.path.join(OUT_DIR, "textures.tsv")

# ── Map-Typ aus dem Namenssuffix ─────────────────────────────────────────────
# Valheim benennt Texturen nach Unity-Konvention: _d albedo, _n normal,
# _m Metallic/Smoothness-Maske, _e Emission.
MAP_SUFFIX = [
    (r"_d(_hildir)?$", "albedo"),
    (r"(_n|_nrm|_normal|_normal_generated)$", "normal"),
    (r"(_m|_metal|_metallic)$", "mask"),
    (r"_e$", "emission"),
    (r"(_ao|_occlusion)$", "ao"),
    (r"(_s|_specular)$", "specular"),
    (r"(_h|_height|_disp)$", "height"),
    (r"_mask$", "mask"),
    (r"_icon$", "icon"),
    (r"(_albedo)$", "albedo"),
]

# ── Kategorie-Regeln, erste Übereinstimmung gewinnt ──────────────────────────
# Die Reihenfolge ist bewusst: Spezifisches vor Allgemeinem. "forest_groundcover"
# muss z. B. vor der Vegetation-Regel bei "forest" landen, weil es Bodenbewuchs ist.
# SPECIAL steht ganz oben und fängt Namen ab, die eine spätere Regel falsch
# einsortieren würde (z. B. "PetRock" ist eine Kreatur, kein Fels).
CATEGORY_RULES = [
    # SPECIAL: Namen, die eine spätere Regel falsch einsortieren würde
    ("kreaturen", r"(petrock|heathrock_?troll|rockgolem|leviathan)"),
    ("bauteile", r"(marble(bench|table|throne|floor|wall|pillar))"),
    ("ui", r"(atlas|notosans|^fallback-|mapicon|minimap|_icon$|^icon|^ui_|button|crosshair|cursor|font|_bkg$|badconnection|^logo|^menu|tutorial|^bar_|_hp_|^skill_|slider|panel|separator|item_background|drops_pixel|esctoexit|^point\d|^ps[45]|xbox|^rotate_|sneak_|nostroke|^merch|^biome_|^damage$|^dot$|^heart$|radial|tooltip|^inventory|^hud|^compendium|^trophy_?bg|^emote|^chat|checkbox|^arrow_?(up|down|left|right)$|^lock$|^plus$|^minus$|^close$|_text$|^aware$|_bg$|^crossplay|^file_local|inputfield|^knob|scrollbar|selection_frame|^pvp_|^space$|^stagger|text_?field|^toggle|^trophies$|^vertical$|^horizontal$|^transparent$|^hover|^wet$|^blank|^dropdown|^spinner|^progress|braidline|^teleport_\d)"),
    ("lut", r"(^ldr_|^lut_|colorgrading)"),
    ("vfx", r"(flipbook|particle|partciel|_fx|^fx_|smoke|flame|fire_|spark|trail|glow|_ray|beam|splash|bubble|blood|dust|lightning|magic|rune_glow|shockwave|softnoise|^noise|_noise|gradient|flare|halo|decal|fireworks|sphere-normal|^perlin|^voronoi|dissolve|^mask\d|^alpha_|^soft_?circle|^ripple|clawmarks|cylindrical_normal|hemisphere_n|diffuse_grey|flowmask|normalmap\d|winddirection|^emission$|^payload)"),
    # Achtung Teilwort-Treffer: `rain` ohne Anker verschluckt „ter-rain-tile",
    # `hen`/`pike`/`hare` weiter unten sonst „kitchen"/„spike"/„share".
    ("himmel_wasser", r"(^sky|cloud|moon|^sun|star(field|s)?_|water|wave|foam|caustic|ocean|(^|_)rain|snowfall|mist_|(^|_)fog)"),
    ("terrain", r"(^terrain|groundcover|^grass_|^dirt|^mud|^sand|^snow(_|$)|^moss|^cliff|rock(s)?[_ 0-9]|^stone_?(floor|ground|wall_texture)|heightmap|^forest_?(d|n)?$|^heath(_|$)|ashlands_ground|mistlands_ground|lavarock|^gravel|rock_?(d|n|m)?$|onrocks|obsidan|obsidian_?(d|n)|^road|^path\d|^marble|grausten|stonemoss|^stone(_|$)|_cliff)"),
    ("vegetation", r"(tree|leaf|leafs|bark|^branch|bush|shrub|_log$|stump|plant|mushroom|boletus|flower|vine|seed|berry|kelp|shoot|pine|birch|beech|^oak|yggdrasil|ormbunke|vass|grasscross|clutter|barley|flax|carrot|turnip|onion|thistle|dandelion|magecap|jotunpuff|cloudberry|raspberry|blueberry|swampplant|fern|reed|moss_?tree|_nature|shrooms|sapling|root(s)?_|ivy|lichen|acacia|vegetation|cultivated|needles|_leaves)"),
    ("kreaturen", r"(greydwarf|greydrawrf|troll|(^|_)boar|deer|(^|_)neck|wolf|lox|goblin|fuling|skeleton|draugr|blob|leech|surtling|wraith|serpent|seeker|(^|_)tick|gjall|dvergr|(^|_)hare(_|$)|asksvin|charred|morgen|volture|(^|_)bat_|abomination|bonemass|moder|yagluth|eikthyr|(^|_)elder|queen|fader|deathsquito|drake|fenring|ulv|growth|oozer|ghost|wolfcub|piggy|gull|seagal|swampfish|(^|_)hen(_|$)|chicken|mistile|tentaroot|dverger|haldor|hildir|bjorn|niedhogg|twitcher|spawner|barnacle|^crow|golem|halstein|hatchling|munin|leviathan|feaster|kvastur|valkyrie|odin|corpse|carcass|^fish\d|salmon|(^|_)pike(_|$)|trout|^bee(_|$)|bogwitch|berzerkr|berserkr|shaman|skoll|hati|hugin|skull|jelly|eldner|eldnr|dragon|giant|wisp|demister)"),
    ("ausruestung", r"(armor|helmet|cape|shield|sword|axe|bow(_|$)|arrow|bolt|knife|spear|hammer|pickaxe|atgeir|mace|club|torch|tool|grieves|padded|mistwalker|blackmetal|silver_|iron(arm|_)|bronze|flinthead|antler|staff|wand|tankard|fishingrod|crossbow|arbalest|dagger|weapon|^adze|cultivator|hoe$|berserker|ashfang|betahorn|chitin|jotunbane|^krom|silentdeath|scorchingmedley|frostner|demolisher|dyrnwyn|himminafl|porcupine|radiance|fangspear|spinesnap|draugrfang|hipcloth|belt|ring_|helm(_|$)|greaves|legs_?(d|n|m)?$|chest_?(d|n|m)?$|quiver|sheath|scabbard|horn(_|$)|^hat|^hats\d|sledge|obliterator|ripper|sweatband|wapons|batteringram|trinket|^gear_|gauntlet|bracer)"),
    ("bauteile", r"(wood_|_wood|stone_|roof|straw|wall|door|floor|beam|pole|fence|bed|table|chest|bench|forge|smelter|kiln|furnace|portal|ship|boat|karve|longship|raft|cart|banner|rug|carpet|chair|throne|stack|ward|sign|ladder|gate|hearth|oven|cauldron|barrel|crate|tent|divan|piece|darkwood|goblinvillage|runestone|cavepainting|obelisk|altar|statue|totem|anvil|beehive|_hut|brazier|box\d*|ceramicpot|destil|fermenter|fi_village|gemcutter|hottub|grill|pillar|plank|garland|furniture|catacombs|container|props|jute|cloth\d*|lantern|candle|torchholder|window|stair|arch|column|shelf|rack|loom|spinning|windmill|mill|dock|bridge|well|firepit|smoker|workbench|preptable|artisan|stonecutter|barberstation|ceramic|metalcutter|potsnpans|sapcollector|slab|turret|vagon|wagon|vise|tower|sail|rope|julklapp|attractor|atractor|^pots?\d)"),
    ("gegenstaende", r"(food|meat|fish|bread|dough|stew|soup|mead|potion|ore|ingot|scrap|coin|trophy|resource|pelt|hide|leather|feather|wrap|pouch|nail|chain|thread|linen|guck|tar|resin|amber|ruby|egg|honey|jam|pie|sausage|wishbone|hammer_?icon|feast|sallad|salad|spices|ectoplasm|^bait|^lure|^key|^gem|^crystal|^bone(_|$)|^flint(_|$)|^wood$|^coal|^charcoal|bilebag|bonefragment|^copper|marinated|smoothie|greens|^ash_|^silver$|^iron$|^tin_|^bronze$|^black_?marble)"),
    ("charakter", r"(player|skin|hair|beard|face|eye|clothes|body|hand_|foot|_male|_female)"),
]

IMG_EXT = (".png", ".jpg", ".jpeg", ".tga", ".ktx2", ".webp")


def size_of(path: str):
    """Auflösung aus dem Header lesen, ohne die Pixel zu dekodieren."""
    try:
        from PIL import Image

        Image.MAX_IMAGE_PIXELS = None
        with Image.open(path) as im:
            return im.size
    except Exception:
        return None


def classify(basename: str) -> str:
    low = basename.lower()
    for cat, pattern in CATEGORY_RULES:
        if re.search(pattern, low):
            return cat
    return "sonstiges"


def map_type(stem: str) -> str:
    low = stem.lower()
    for pattern, kind in MAP_SUFFIX:
        if re.search(pattern, low):
            return kind
    return "-"


def strip_map_suffix(stem: str) -> str:
    low = stem
    for pattern, _ in MAP_SUFFIX:
        low = re.sub(pattern, "", low, flags=re.I)
    return low


def normalize(stem: str) -> str:
    """Vergleichsname: Map-Suffix, Saison, Mod-Zusätze und Zählnummern weg."""
    s = re.sub(r"@\w+$", "", stem)
    s = strip_map_suffix(s)
    s = re.sub(r"(_mat|_texture|_tex)$", "", s, flags=re.I)
    # Nur Rip-Duplikate ("rock 1", "…_Clone2") abschneiden. Ein `_2` mit
    # Unterstrich gehört dagegen zum Namen — shrub und shrub_2 sind zwei
    # verschiedene Texturen und dürfen nicht zusammenfallen.
    s = re.sub(r"(\s+\d+|_clone\d*)$", "", s, flags=re.I)
    return s.strip().lower().replace(" ", "_")


def scan():
    entries = []
    for source, base in DIRS.items():
        if not os.path.isdir(base):
            print(f"[warn] fehlt: {base}", file=sys.stderr)
            continue
        for root, _, files in os.walk(base):
            for f in sorted(files):
                if not f.lower().endswith(IMG_EXT):
                    continue
                path = os.path.join(root, f)
                rel = os.path.relpath(path, ROOT)
                stem = f.rsplit(".", 1)[0]
                season_m = re.search(r"@(\w+)$", stem)
                season = season_m.group(1) if season_m else "-"
                subdir = os.path.relpath(root, base)

                if source == "hd":
                    # Kategorie steht schon im Pfad: grass/meadows/…
                    parts = subdir.split(os.sep)
                    cat = {
                        "grass": "vegetation",
                        "vegetation": "vegetation",
                        "trees": "vegetation",
                        "pickables": "vegetation",
                        "creatures": "kreaturen",
                        "armors": "ausruestung",
                        "pieces": "bauteile",
                    }.get(parts[0], classify(stem))
                    group = "/".join(parts)
                    # Das HD-Pack liefert ausschließlich Farbtexturen: eine
                    # Stichprobe über alle Ordner ergab natürliche Mittelwerte
                    # statt der ~128/128/255 einer Normalmap.
                    if map_type(re.sub(r"@\w+$", "", stem)) == "-":
                        forced_map = "albedo"
                    else:
                        forced_map = None
                else:
                    forced_map = None
                    cat = classify(stem)
                    group = "-"

                dims = size_of(path)
                entries.append(
                    {
                        "name": f,
                        "path": rel,
                        "source": source,
                        "category": cat,
                        "group": group,
                        "map": forced_map or map_type(re.sub(r"@\w+$", "", stem)),
                        "season": season,
                        "key": normalize(stem),
                        "width": dims[0] if dims else 0,
                        "height": dims[1] if dims else 0,
                        "bytes": os.path.getsize(path),
                    }
                )
    return entries


def cmd_build(args):
    entries = scan()

    # HD-Textur mit ihrem Gegenstück im Original-Rip verknüpfen
    orig_by_key = {}
    for e in entries:
        if e["source"] == "orig":
            orig_by_key.setdefault(e["key"], []).append(e)
    matched = 0
    for e in entries:
        if e["source"] != "hd":
            continue
        hits = orig_by_key.get(e["key"], [])
        # Das HD-Pack ersetzt Farbtexturen, also zählt das Albedo-Gegenstück;
        # ohne Map-Suffix (z. B. `beech_bark.png`) ist es ebenfalls das Albedo.
        hits = sorted(hits, key=lambda o: (o["map"] not in ("albedo", "-"), o["map"] != "albedo", o["name"]))
        e["orig"] = hits[0]["name"] if hits else "-"
        e["orig_all"] = [o["name"] for o in hits]
        matched += bool(hits)

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(JSON_PATH, "w") as fh:
        json.dump({"count": len(entries), "textures": entries}, fh, indent=1)

    with open(TSV_PATH, "w") as fh:
        fh.write("kategorie\tquelle\tmap\tsaison\tmaße\tKB\tpfad\tgruppe\n")
        for e in sorted(entries, key=lambda x: (x["category"], x["key"], x["name"])):
            fh.write(
                f"{e['category']}\t{e['source']}\t{e['map']}\t{e['season']}\t"
                f"{e['width']}x{e['height']}\t{e['bytes']//1024}\t{e['path']}\t{e['group']}\n"
            )

    hd_count = sum(1 for e in entries if e["source"] == "hd")
    print(f"{len(entries)} Texturen indiziert → {os.path.relpath(JSON_PATH, ROOT)}, {os.path.relpath(TSV_PATH, ROOT)}")
    print(f"HD-Texturen mit Original-Gegenstück: {matched}/{hd_count}")
    unsorted_n = sum(1 for e in entries if e["category"] == "sonstiges")
    print(f"nicht kategorisiert: {unsorted_n} ({unsorted_n * 100 // max(1, len(entries))} %)")


def load():
    if not os.path.exists(JSON_PATH):
        print("Kein Index vorhanden — erst `texture-catalog.py build` laufen lassen.", file=sys.stderr)
        sys.exit(1)
    with open(JSON_PATH) as fh:
        return json.load(fh)["textures"]


def cmd_find(args):
    entries = load()
    pattern = re.compile(args.query, re.I) if args.query else None
    rows = []
    for e in entries:
        if pattern and not pattern.search(e["name"]) and not pattern.search(e["path"]):
            continue
        if args.cat and e["category"] != args.cat:
            continue
        if args.map and e["map"] != args.map:
            continue
        if args.season and e["season"] != args.season:
            continue
        if args.hd and e["source"] != "hd":
            continue
        if args.orig and e["source"] != "orig":
            continue
        rows.append(e)
    rows.sort(key=lambda x: (x["category"], x["name"]))
    for e in rows[: args.limit]:
        print(
            f"{e['category']:<14} {e['source']:<4} {e['map']:<9} {e['season']:<7} "
            f"{e['width']}x{e['height']:<6} {e['path']}"
        )
    print(f"── {len(rows)} Treffer" + (f" (davon {args.limit} gezeigt)" if len(rows) > args.limit else ""))


def cmd_stats(args):
    entries = load()
    import collections

    per_cat = collections.Counter()
    per_cat_bytes = collections.Counter()
    for e in entries:
        k = (e["category"], e["source"])
        per_cat[k] += 1
        per_cat_bytes[k] += e["bytes"]
    print(f"{'Kategorie':<16}{'orig':>8}{'hd':>8}{'MB':>10}")
    for cat in sorted({k[0] for k in per_cat}):
        mb = (per_cat_bytes[(cat, "orig")] + per_cat_bytes[(cat, "hd")]) / 1e6
        print(f"{cat:<16}{per_cat[(cat,'orig')]:>8}{per_cat[(cat,'hd')]:>8}{mb:>10.0f}")
    print(f"{'GESAMT':<16}{sum(v for k,v in per_cat.items() if k[1]=='orig'):>8}"
          f"{sum(v for k,v in per_cat.items() if k[1]=='hd'):>8}"
          f"{sum(per_cat_bytes.values())/1e6:>10.0f}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("build", help="Index neu aufbauen").set_defaults(func=cmd_build)

    f = sub.add_parser("find", help="Texturen suchen")
    f.add_argument("query", nargs="?", help="Regex auf Name/Pfad")
    f.add_argument("--cat", help="Kategorie (siehe stats)")
    f.add_argument("--map", help="albedo|normal|mask|emission|ao|specular|icon")
    f.add_argument("--season", help="spring|summer|fall|winter")
    f.add_argument("--hd", action="store_true", help="nur HD-Pack")
    f.add_argument("--orig", action="store_true", help="nur Original-Rip")
    f.add_argument("--limit", type=int, default=60)
    f.set_defaults(func=cmd_find)

    sub.add_parser("stats", help="Kategorie-Übersicht").set_defaults(func=cmd_stats)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
