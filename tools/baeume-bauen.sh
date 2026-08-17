#!/usr/bin/env bash
#
# Erzeugt sämtliche prozeduralen Bäume neu.
#
#     tools/baeume-bauen.sh            # alle
#     tools/baeume-bauen.sh birke      # nur eine Gruppe (fichte|tanne|birke)
#
# ── Warum es diese Datei gibt ────────────────────────────────────────
# `assets/` ist gitignored (.gitignore:17) — die GLBs liegen NICHT im
# Repo. Nach einem frischen Checkout fehlen alle Bäume, und ohne diese
# Liste wüsste niemand mehr, mit welchem Seed und welcher Höhe sie
# entstanden sind. Dieselbe Rolle wie `tools/extract-audio.mjs` bei den
# Klängen: Das Ergebnis ist flüchtig, das Rezept gehört ins Repo.
#
# Die Werte sind KEINE Vorschläge, sondern genau die, mit denen die
# registrierten Modelle erzeugt wurden. Wer sie ändert, ändert die Bäume,
# die in shared/src/prefabs.ts stehen — dort sind Breite und Höhe fest
# eingetragen (renderScale) und müssten nachgezogen werden.
#
# Sapling ist bei gleichem Seed deterministisch: derselbe Aufruf liefert
# denselben Baum, Lauf für Lauf.
set -euo pipefail

cd "$(dirname "$0")/.."

command -v blender >/dev/null || {
  echo "Blender fehlt — apt-get install blender" >&2
  exit 1
}

GRUPPE="${1:-alle}"

# ── Warum es eine Spalte "karte" gibt ────────────────────────────────
# Sapling behandelt `leafScale` als ABSOLUTE Länge in Metern. Ein 22-m-Baum
# bekäme deshalb dieselben 62-cm-Nadelkarten wie eine 12-m-Fichte und
# stünde licht und durchsichtig da. Die Spalte skaliert sie mit:
# Zielhöhe / Referenzhöhe der Art (Fichte/Tanne 12, Eiche 11, Birke 12).
#
# Die BESTEHENDEN Zeilen führen bewusst 1.0 — sie sind mit den festen
# Werten gebaut und mit gemessenem renderScale in prefabs.ts eingetragen.
#
# name            art          seed  höhe  dichte  karte
BAEUME=$(cat <<'EOF'
Fichte1           fichte       3     12    1.0     1.0
Fichte2           fichte       7     14    1.0     1.0
Fichte3           fichte       12    10    1.0     1.0
Tanne1            tanne        5     12    1.0     1.0
Tanne2            tanne        11    9     0.85    1.0
Tanne3            tanne        19    6     0.6     1.0
Tanne4            tanne        23    3.2   0.4     1.0
BirkeHoch1        birke        31    4.5   0.55    1.0
BirkeHoch2        birke        37    8     0.8     1.0
BirkeHoch3        birke        43    12    1.0     1.0
BirkeDicht1       birke_dicht  52    4.5   0.45    1.0
BirkeDicht2       birke_dicht  58    8     0.65    1.0
BirkeDicht3       birke_dicht  64    11    0.8     1.0
Eiche1            eiche        11    11    1.0     1.0
Eiche2            eiche        23    8     0.8     1.0
Eiche3            eiche        37    14    1.0     1.0
# ── Grosse Baeume (08/2026) ──────────────────────────────────────────
# Der Wald soll die WEITSICHT NEHMEN — das ist der Griff, mit dem eine
# Welt tief wirkt statt flach. Dafuer braucht es Baeume ueber 15 m, und
# zwar mit mitwachsenden Nadelkarten (Spalte "karte"), sonst wird der
# hohe Baum licht und man sieht erst recht hindurch.
Fichte4           fichte       61    18    1.0     1.50
Fichte5           fichte       67    22    1.0     1.85
Tanne5            tanne        73    16    1.0     1.35
Tanne6            tanne        79    20    1.0     1.70
# Kiefer: langer astfreier Stamm, Schirmkrone. Ein Fichtenwald schliesst
# unten, ein Kiefernwald oben — zusammen ergeben sie erst einen Wald,
# durch den man weder sieht noch hindurchschaut.
Kiefer1           kiefer       83    16    0.85    1.60
Kiefer2           kiefer       89    20    1.0     2.00
Kiefer3           kiefer       97    24    1.0     2.40
# Laubbaeume: dieselbe Ueberlegung, andere Referenzhoehe.
Eiche4            eiche       103    19    1.0     1.70
BirkeHoch4        birke       109    16    1.0     1.35
BirkeDicht4       birke_dicht 113    15    0.75    1.30
EOF
)

# ── Urwaldriesen (Spalte 7: Stammfaktor) ─────────────────────────────
# Nach den Vorbildern aus Valheim: Was den Wald tief wirken laesst, ist
# nicht die Kronenhoehe, sondern der STAMM. Bei ratio 0.014 misst eine
# 22-m-Fichte 62 cm im Durchmesser und liest sich als Stange mit Gruen
# obendrauf; erst mit gut einem Meter wird der Stamm zum dominanten
# Element und der Blick bleibt an ihm haengen.
#
# name            art          seed  höhe  dichte  karte  stamm
RIESEN=$(cat <<'EOF'
Fichte6           fichte      127    24    1.0     2.00   2.1
Kiefer4           kiefer      131    26    1.0     2.50   1.8
Tanne7            tanne       137    23    1.0     1.90   1.9
EOF
)

# ── Dicke Varianten (08/2026, Spalte 7: Stammfaktor) ─────────────────
# Von jedem Baum aus BAEUME eine zweite Ausfertigung mit staerkerem Stamm,
# Namenszusatz "Dick". Seed, Hoehe, Dichte und Kartenfaktor sind Zeichen
# fuer Zeichen die der Vorlage — geaendert ist GENAU eine Groesse. Damit
# ist die dicke Variante derselbe Baum, nicht ein anderer, und ein Wald
# aus beiden liest sich als ein Bestand mit unterschiedlich alten Staemmen
# statt als zwei zusammengewuerfelte Saetze.
#
# Faktor 1.8 ist nicht frei gewaehlt: Damit ist Kiefer4 oben gebaut, die
# Varianten fuegen sich also in den vorhandenen Bestand ein statt eine
# dritte Dicke einzufuehren. Gegengeprueft an beiden Enden der Groessen-
# skala — Fichte5 (22 m) und Tanne4 (3,2 m) tragen ihn beide.
#
# Die drei Riesen oben fehlen hier absichtlich: sie liegen bereits bei
# 1.8 bis 2.1.
#
# name            art          seed  höhe  dichte  karte  stamm
DICKE=$(cat <<'EOF'
Fichte1Dick       fichte        3    12    1.0     1.0    1.8
Fichte2Dick       fichte        7    14    1.0     1.0    1.8
Fichte3Dick       fichte       12    10    1.0     1.0    1.8
Tanne1Dick        tanne         5    12    1.0     1.0    1.8
Tanne2Dick        tanne        11    9     0.85    1.0    1.8
Tanne3Dick        tanne        19    6     0.6     1.0    1.8
Tanne4Dick        tanne        23    3.2   0.4     1.0    1.8
BirkeHoch1Dick    birke        31    4.5   0.55    1.0    1.8
BirkeHoch2Dick    birke        37    8     0.8     1.0    1.8
BirkeHoch3Dick    birke        43    12    1.0     1.0    1.8
BirkeDicht1Dick   birke_dicht  52    4.5   0.45    1.0    1.8
BirkeDicht2Dick   birke_dicht  58    8     0.65    1.0    1.8
BirkeDicht3Dick   birke_dicht  64    11    0.8     1.0    1.8
Eiche1Dick        eiche        11    11    1.0     1.0    1.8
Eiche2Dick        eiche        23    8     0.8     1.0    1.8
Eiche3Dick        eiche        37    14    1.0     1.0    1.8
Fichte4Dick       fichte       61    18    1.0     1.50   1.8
Fichte5Dick       fichte       67    22    1.0     1.85   1.8
Tanne5Dick        tanne        73    16    1.0     1.35   1.8
Tanne6Dick        tanne        79    20    1.0     1.70   1.8
Kiefer1Dick       kiefer       83    16    0.85    1.60   1.8
Kiefer2Dick       kiefer       89    20    1.0     2.00   1.8
Kiefer3Dick       kiefer       97    24    1.0     2.40   1.8
Eiche4Dick        eiche       103    19    1.0     1.70   1.8
BirkeHoch4Dick    birke       109    16    1.0     1.35   1.8
BirkeDicht4Dick   birke_dicht 113    15    0.75    1.30   1.8
EOF
)

# Die Eiche braucht ihre Texturen, und die liegen wie die Modelle NICHT im
# Repo (assets/ ist gitignored). Anders als die Valheim-Atlanten lassen sie
# sich aber wiederherstellen — sie werden gezeichnet, nicht gerippt.
if [ ! -f assets/textures/eiche_leaf.png ] || [ ! -f assets/textures/eiche_bark.png ]; then
  echo "Eichentexturen fehlen — werden erzeugt"
  python3 tools/eiche-texturen.py | sed 's/^/      /'
fi

anzahl=0
while read -r name art seed hoehe dichte karte; do
  [ "${name:0:1}" = "#" ] && continue
  [ -z "$name" ] && continue
  case "$GRUPPE" in
    alle) ;;
    *) [[ "$art" == "$GRUPPE"* ]] || continue ;;
  esac
  printf '  %-14s %-12s seed %-3s %5s m  dichte %s\n' "$name" "$art" "$seed" "$hoehe" "$dichte"
  blender --background --python tools/baum-generieren.py -- \
    --art "$art" --name "$name" --seed "$seed" --hoehe "$hoehe" --dichte "$dichte" \
    --kartenfaktor "${karte:-1.0}" \
    2>/dev/null | grep -E '^(FERTIG|HINWEIS)' | sed 's/^/      /'
  anzahl=$((anzahl + 1))
done <<< "$BAEUME"

while read -r name art seed hoehe dichte karte stamm; do
  [ -z "$name" ] && continue
  [ "${name:0:1}" = "#" ] && continue
  case "$GRUPPE" in
    alle) ;;
    *) [[ "$art" == "$GRUPPE"* ]] || continue ;;
  esac
  printf '  %-14s %-12s seed %-3s %5s m  stamm x%s\n' "$name" "$art" "$seed" "$hoehe" "$stamm"
  blender --background --python tools/baum-generieren.py -- \
    --art "$art" --name "$name" --seed "$seed" --hoehe "$hoehe" --dichte "$dichte" \
    --kartenfaktor "${karte:-1.0}" --stammfaktor "${stamm:-1.0}" \
    2>/dev/null | grep -E '^(FERTIG|HINWEIS)' | sed 's/^/      /'
  anzahl=$((anzahl + 1))
# Riesen und dicke Varianten tragen beide eine Stammspalte und laufen
# deshalb durch dieselbe Schleife.
done <<< "$RIESEN
$DICKE"

echo
echo "$anzahl Modelle in assets/models/ erzeugt."
echo "Registriert sind sie in shared/src/prefabs.ts (HINT_DEFS + EIGENE_MODELLE)."

# ── PFLICHTSCHRITT: Rinde und Laub zusammenlegen ─────────────────────
# Blender exportiert JEDES Modell mit zwei Materialien — `nadeln` fuer die
# Laubkarten und `rinde` fuer Stamm und Aeste. Zwei Materialien sind zwei
# Thin-Instance-Master, denn `verschmelzeNachMaterial()` im AssetManager
# legt nur zusammen, was sich Material UND Vertexattribute teilt.
#
# Ein frisch erzeugtes Modell faellt damit auf den alten Stand zurueck,
# und zwar STILL: Es sieht richtig aus, es kostet nur einen Master mehr.
# Genau deshalb steht der Schritt hier im Skript und nicht in einer
# Anleitung, die man beim naechsten Mal nicht liest.
#
# Das Werkzeug ist idempotent (bereits zusammengelegte Modelle meldet es
# als "schon zusammengelegt") und legt vor dem ersten Schreiben eine
# Sicherung nach assets/models-vor-zusammenlegung/. Warum es die GLBs
# anfasst statt hier im Generator zu wirken, steht in seinem Kopf.
echo
echo "Rinde und Laub zusammenlegen (halbiert die Zahl der Master) ..."
node tools/baum-material-zusammenlegen.mjs --schreiben --texturen assets/textures \
  | grep -E "^(zusammengelegt:|schon|übersprungen:)"
