/**
 * PRÜFT tools/assets-paket.mjs: jeder Asset-Ordner, aus dem der Client zur
 * Laufzeit lädt, steht auch in `PAKET_TEILE` — der Liste der Ordner, die
 * ins Release-Archiv wandern.
 *
 * ── Der Anlass (12.09.2026) ──────────────────────────────────────────
 * `PAKET_TEILE` führte `store`, `models` und `textures`. Damit hatte eine
 * frische Installation (wov-dev, nach `docs/server-setup.md` aufgesetzt)
 * Gelände, Bäume und Figuren — aber keine Gegenstandssymbole, keine
 * Treffereffekte und keine Musik. Im Spiel sah man davon nur mittelbar:
 * In der Schnellleiste standen statt der Symbole die ersten zwei
 * Buchstaben des Namens (der Ersatzweg in `Hotbar.itemVisual`), und ein
 * Hieb kam ohne sichtbaren Bogen — `KampfEffekte` lädt seine acht Tafeln
 * aus `/assets/vfx/` und bekam acht 404er. Beides meldete Mike als
 * „Icons fehlen" und „Schlag-Animationen sind nicht da"; die Animation
 * lief in Wahrheit, nur unsichtbar.
 *
 * Genau das ist die Klasse Fehler, für die sich ein Test lohnt: Der
 * Ausfall hat kein Symptom an der Stelle, an der er entsteht. Wer
 * `PAKET_TEILE` kürzt oder einen neuen Ordner unter `assets/` einführt,
 * merkt es erst Tage später an einem fremden Server.
 *
 * ── Warum Textnachweis und keine echte Paketprobe ────────────────────
 * Ein Paket zu bauen hiesse 550 MB zu packen; der CI-Checkout hat
 * `assets/` ohnehin nicht (`.gitignore: assets/*`). Geprüft wird also
 * nur die Liste selbst gegen eine zweite, hier ausgeschriebene Liste der
 * Laufzeit-Wurzeln — und die ist die eigentliche Aussage des Tests.
 *
 * Text-only guard: every asset root the client fetches at runtime is also
 * a member of PAKET_TEILE in tools/assets-paket.mjs.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WURZEL = resolve(import.meta.dirname, '../..');
const PAKET = resolve(WURZEL, 'tools/assets-paket.mjs');

/**
 * Die Wurzeln unter `/assets/`, die der Client zur Laufzeit anfordert,
 * und WER sie anfordert. Von Hand gepflegt und nicht aus dem Quelltext
 * gelesen: Die Pfade entstehen teils aus Zeichenkettenvorlagen
 * (`/assets/sprites/${icon}.png`), eine Regex über den Quelltext fände
 * genau die nicht — also die Hälfte der Fälle, um die es hier geht.
 */
const LAUFZEIT_WURZELN: ReadonlyArray<{ ordner: string; wer: string }> = [
  { ordner: 'models', wer: 'AssetManager, AvatarRig (Figuren, Vegetation, Dungeon-Kits)' },
  { ordner: 'textures', wer: 'TerrainSplat, Himmel, Laub' },
  { ordner: 'store', wer: 'Fremdbestand — Vegetation, Boden, Umgebung' },
  { ordner: 'sprites', wer: 'Hotbar.itemVisual, InventoryPanel, PieceSelection (Gegenstandssymbole)' },
  { ordner: 'vfx', wer: 'KampfEffekte (Hiebbogen, Treffer, Funken, Blut)' },
  { ordner: 'audio', wer: 'Hintergrundmusik und Geräusche' },
  { ordner: 'dungeon2', wer: 'DungeonMaterialArrays (Albedo-, Normalen- und ORH-Arrays der Dungeons)' },
];

/**
 * Ordner unter `assets/`, die BEWUSST nicht ins Paket gehören, samt
 * Grund. Ohne diese Liste liest sich der Test so, als sei die Auswahl
 * zufällig.
 */
const ABSICHTLICH_DRAUSSEN: ReadonlyArray<{ ordner: string; grund: string }> = [
  { ordner: 'generiert', grund: 'entsteht beim Start aus store/ (scripts/dev.mjs)' },
  { ordner: 'store-lab', grund: 'abgeleitete Fassungen, in Sekunden neu gebaut (store:aufbereiten)' },
];

function paketTeile(text: string): string[] {
  const treffer = /const PAKET_TEILE = \[([^\]]*)\]/.exec(text);
  if (!treffer) return [];
  return [...treffer[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

function main(): void {
  let text: string;
  try {
    text = readFileSync(PAKET, 'utf-8');
  } catch (e) {
    console.log(`FEHLGESCHLAGEN — ${PAKET} nicht lesbar: ${(e as Error).message}`);
    process.exit(1);
  }

  const teile = paketTeile(text);
  if (teile.length === 0) {
    console.log('FEHLGESCHLAGEN — PAKET_TEILE nicht gefunden oder leer.');
    process.exit(1);
  }
  console.log(`PAKET_TEILE: ${teile.join(', ')}`);

  let fehler = 0;
  for (const { ordner, wer } of LAUFZEIT_WURZELN) {
    const drin = teile.includes(ordner);
    console.log(`${drin ? 'OK  ' : 'FEHL'}  assets/${ordner} — ${wer}`);
    if (!drin) fehler++;
  }
  for (const { ordner, grund } of ABSICHTLICH_DRAUSSEN) {
    if (teile.includes(ordner)) {
      console.log(`FEHL  assets/${ordner} steht im Paket, gehoert aber nicht hinein — ${grund}`);
      fehler++;
    } else {
      console.log(`OK    assets/${ordner} bleibt draussen — ${grund}`);
    }
  }

  console.log(
    fehler === 0
      ? `\nasset-paket-teile: alle ${LAUFZEIT_WURZELN.length} Laufzeit-Wurzeln sind im Paket.\n`
      : `\nasset-paket-teile: ${fehler} Abweichung(en).\n`,
  );
  process.exit(fehler > 0 ? 1 : 0);
}

main();
