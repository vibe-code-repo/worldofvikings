<!-- Hilfsmittel: die verbindliche Modul-Konvention (Raster, Zelle, Achsen, Connectoren) — `shared/src/dungeonRasterModul.ts:1-3` zitiert sie namentlich. -->

# Modul-Format v0 (Connector-Modul-Kit)

Verbindliche Konvention, an die sich alle Dungeon-Module halten. Ziel: Module snappen
rasterrein aneinander, Öffnungen sind eigene Module (kein Carving).

## Raster & Zelle
- **GRID = 2,0 m.** Grundeinheit ist die **Zelle**: 2 × 2 m Grundfläche, **3,5 m** hoch.
- Zell-Weltkoordinaten: `(ci, cj)` → Mitte bei `(ci*2, 0, cj*2)`. `y=0` = Bodenoberkante.

## Modultypen & Pivot
| Typ | Sitzt an | Footprint | Pivot (lokaler Ursprung) |
|---|---|---|---|
| `Boden` | Zelle | 2×2, oben bei y=0 | Bodenmitte der Zelle |
| `Decke` | Zelle | 2×2 | Deckenmitte (y=3,5), Oberseite nach unten |
| `Wand` | Zell-**Kante** | 2 (breit) × 3,5 (hoch) × 0,3 | Kantenmitte am Boden, Front +Z |
| `Torbogen` | Zell-**Kante** (Durchgang) | 2 × 3,5 × 0,3, mittig offen | wie Wand |
| *(später)* Ecke, Treppe, Fries | Kante/Zelle | — | — |

- **Front-Konvention:** Wand/Bogen zeigen mit lokaler **+Z-Fläche** in die Zelle. Beim Setzen
  an eine Kante wird um Y gedreht (West-Kante → +90°, Ost → −90°, Süd → 0°, Nord → 180°).
- **Einmateriell:** ein Modul = ein Materialslot (Wand/Decke/Boden aus `steinKit`). Einzige
  Ausnahme: das Kollisionsnetz unten.

## Kollisionsnetz `_col` (seit 03.09.2026)
Ein Mesh in der GLB, dessen Name auf **`_col`** endet (z. B. `StoneVaultStairs_col`), ist
**nur Kollision und nie Bild**. Der Client (`client/src/engine/AssetManager.ts`) erkennt es am
Namen und behandelt es getrennt:

- es wird **nicht gezeichnet**, wirft **keinen Schatten**, ist nicht pickbar,
- es bekommt **kein Steinmaterial** (eigenes Material, Konvention: `Kollision`),
- und es **ersetzt die Kollision des ganzen Prefabs** — die sichtbaren Meshes kollidieren
  dann gar nicht mehr.

Wann man eins braucht: Die Spielerkapsel hat 0,4 m Radius. An einer 0,25-m-Setzstufe steht die
Kontaktnormale bei acos((0,4−0,25)/0,4) ≈ 68° — über der Steigungsgrenze von 40°. Aus dem
gerenderten Mesh gebacken ist eine Treppe deshalb **unbegehbar**, egal wie flach ihre Rampe im
Mittel steigt. Das `_col`-Netz legt die glatte Rampe unter die Stufen.

Bauregel: wenige **einfache Quader**, Oberfläche exakt durch die Trittkanten, dazu je ein Quader
für alles Weitere, woran die Figur anstoßen soll (Seitenwände, Decke). Beispiel:
`make-stonevault.py`, `treppe_kollision()`. Geprüft von `check-p1.py` (zwei Meshes, zwei
Materialslots, Laufprofil des `_col`-Netzes) und `client/test/kollisionsnetz.ts`.

## Connectors (= Zell-Kanten)
Eine Kante zwischen zwei Zellen ist ein **Connector** in Richtung **N/S/O/W**. Zustand je Kante:
- **Wand** — geschlossen (`Wand`-Modul).
- **Durchgang** — offen begehbar (kein Modul) ODER gerahmt (`Torbogen`-Modul).
- Zwei Module „snappen", wenn ihre Kanten (Ort + Gegenrichtung) zusammenfallen — rein rechnerisch,
  byte-deterministisch (keine Fließkomma-Toleranz nötig, alles auf dem 2-m-Raster).

## Namensschema
`<Kit><Typ>[Variante]` — z. B. `SteingrabWandRelief`, `SteingrabTorbogen`, `SteingrabBoden`.
Dateiname = Prefabname unter `assets/models/<name>.glb` (wie 1.0).

## TS-Ziel (P2)
```ts
interface ModulDef {
  name: string; typ: 'boden'|'decke'|'wand'|'torbogen'|…;
  groesse: {x:number;y:number;z:number};
  connectors: { richtung:'N'|'S'|'O'|'W'; art:'wand'|'durchgang' }[];
  materialSlot: 'wand'|'decke'|'boden';
}
```
