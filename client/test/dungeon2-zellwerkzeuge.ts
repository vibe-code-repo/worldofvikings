/**
 * AP15.3/15.4/15.5 — Wächter für die REINE Logik der Zellwerkzeuge des neuen
 * Dungeon-Editors: Picking-Mathematik (`cellCanvasMath`) und Mutationen
 * (`cellEdits`). KEIN DOM: Diese Datei baut nie eine Canvas — sie prüft die
 * Zahl und die Datenmutation, die unter der Zeichnung liegen.
 * AP15.3/15.4/15.5 — guard for the PURE logic of the new dungeon editor's cell
 * tools: picking maths (`cellCanvasMath`) and mutations (`cellEdits`). NO DOM.
 *
 *   npx tsx test/dungeon2-zellwerkzeuge.ts
 *
 * Für jede Invariante ein Positiv- UND ein Negativfall — ein Test, der nie rot
 * war, ist kein Test (dasselbe Prinzip wie in `shared/test/dungeon2-layout.ts`).
 * A positive AND a negative case per invariant.
 */

import { dungeon2 } from '@wov/shared';
import {
  bildZuWelt,
  einpassen,
  kanteBei,
  sichtbaresFenster,
  weltZuBild,
  zelleBei,
  zoomUmZeiger,
  type Sicht,
} from '../src/editor/dungeon2/cellCanvasMath';
import {
  BODEN_MAX_STUFEN,
  bodenSetzen,
  imPinsel,
  materialPinsel,
  rasteStufe,
  sicherstellenGebaut,
  stempelEntfernen,
  stempelSetzen,
  wandUmschalten,
  type StempelVorlage,
} from '../src/editor/dungeon2/cellEdits';

const ZELLE_M = dungeon2.ZELLE_M;
const KANTE = dungeon2.KANTE;

// ─────────────────────────────────────────────────────────────────────────────
// Prüfgerüst / test harness
// ─────────────────────────────────────────────────────────────────────────────

let gutZahl = 0;
const fehlerListe: string[] = [];

function pruefe(name: string, bedingung: boolean, zusatz = ''): void {
  if (bedingung) {
    gutZahl++;
    return;
  }
  fehlerListe.push(`${name}${zusatz ? ` — ${zusatz}` : ''}`);
}

function pruefeGleich(name: string, ist: unknown, soll: unknown): void {
  pruefe(name, Object.is(ist, soll), `ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)}`);
}

function fastGleich(name: string, ist: number, soll: number, toleranz = 1e-9): void {
  pruefe(name, Math.abs(ist - soll) <= toleranz, `ist ${ist}, soll ${soll}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. cellCanvasMath — Bild<->Welt, Zell-Picking, Kanten-Picking
// ─────────────────────────────────────────────────────────────────────────────

const SICHT: Sicht = { zoom: 8, mitteX: 0, mitteZ: 0, breite: 800, hoehe: 600 };

// Bildmitte ist die Weltmitte. / Image centre is the world centre.
{
  const w = bildZuWelt(SICHT, 400, 300);
  fastGleich('bildZuWelt Mitte wx', w.wx, 0);
  fastGleich('bildZuWelt Mitte wz', w.wz, 0);
}

// Hin und zurück ist Identität (mit Pan und anderem Zoom). / Roundtrip identity.
{
  const s: Sicht = { zoom: 12.5, mitteX: 33, mitteZ: -17, breite: 1024, hoehe: 768 };
  const b = weltZuBild(s, 40, -10);
  const w = bildZuWelt(s, b.x, b.y);
  fastGleich('Welt->Bild->Welt wx', w.wx, 40, 1e-6);
  fastGleich('Welt->Bild->Welt wz', w.wz, -10, 1e-6);
}

// Zell-Picking: Bildmitte -> Zelle (0,0); ein Zellbreite nach Osten -> (1,0).
{
  pruefeGleich('zelleBei Mitte x', zelleBei(SICHT, 400, 300, 0).x, 0);
  pruefeGleich('zelleBei Mitte z', zelleBei(SICHT, 400, 300, 0).z, 0);
  // +ZELLE_M Meter nach Osten = +ZELLE_M*zoom Pixel. / one cell east.
  const px = 400 + ZELLE_M * SICHT.zoom;
  pruefeGleich('zelleBei eine Zelle Ost', zelleBei(SICHT, px, 300, 0).x, 1);
  // Negativfall: knapp WESTLICH der Bildmitte liegt Zelle -1 (floor, nicht round).
  pruefeGleich('zelleBei knapp West = -1', zelleBei(SICHT, 399, 300, 0).x, -1);
}

// Zell-Picking mit Pan: mitteX=10 -> Weltmitte x=10 -> floor(10/4)=2.
{
  const s: Sicht = { ...SICHT, mitteX: 10 };
  pruefeGleich('zelleBei mit Pan', zelleBei(s, 400, 300, 0).x, 2);
}

// Kanten-Picking: Punkt nahe der Westgrenze von Zelle (0,0) -> West.
{
  const s: Sicht = { zoom: 10, mitteX: 0, mitteZ: 0, breite: 800, hoehe: 600 };
  // Weltpunkt (0.3, 2.0) liegt in Zelle (0,0), lx=0.3 am nächsten an West.
  const b = weltZuBild(s, 0.3, 2.0);
  const k = kanteBei(s, b.x, b.y, 0);
  pruefeGleich('kanteBei West Zelle x', k.x, 0);
  pruefeGleich('kanteBei West Kante', k.kante, KANTE.West);
  fastGleich('kanteBei West Abstand', k.abstandM, 0.3, 1e-6);
}

// Kanten-Picking: Punkt nahe der Nordgrenze (+z) -> Nord (Negativabgrenzung).
{
  const s: Sicht = { zoom: 10, mitteX: 0, mitteZ: 0, breite: 800, hoehe: 600 };
  const b = weltZuBild(s, 2.0, 3.8); // lz=3.8, dNord=0.2 am kleinsten
  const k = kanteBei(s, b.x, b.y, 0);
  pruefeGleich('kanteBei Nord Kante', k.kante, KANTE.Nord);
  pruefe('kanteBei Nord != West', k.kante !== KANTE.West);
}

// zoomUmZeiger: die Weltstelle unter dem Zeiger bleibt stehen.
{
  const s: Sicht = { zoom: 8, mitteX: 5, mitteZ: 5, breite: 800, hoehe: 600 };
  const vor = bildZuWelt(s, 600, 200);
  const z = zoomUmZeiger(s, 600, 200, 1.14, 1.5, 40);
  const nach = bildZuWelt({ ...s, ...z }, 600, 200);
  fastGleich('zoomUmZeiger hält wx', nach.wx, vor.wx, 1e-9);
  fastGleich('zoomUmZeiger hält wz', nach.wz, vor.wz, 1e-9);
  pruefe('zoomUmZeiger ändert Zoom', z.zoom > s.zoom);
}

// einpassen: Bereich zentriert, Zoom in den Grenzen.
{
  const fit = einpassen({ minX: 0, maxX: 9, minZ: 0, maxZ: 9 }, 800, 600, 40, 1.5, 40, {
    zoom: 8,
    mitteX: 0,
    mitteZ: 0,
  });
  // 10 Zellen = 40 m, Mitte bei 20 m.
  fastGleich('einpassen mitteX', fit.mitteX, 20);
  fastGleich('einpassen mitteZ', fit.mitteZ, 20);
  pruefe('einpassen Zoom in Grenzen', fit.zoom >= 1.5 && fit.zoom <= 40);
  // Negativfall: leerer Bereich -> Vorgabe unverändert.
  const leer = einpassen(null, 800, 600, 40, 1.5, 40, { zoom: 8, mitteX: 1, mitteZ: 2 });
  pruefeGleich('einpassen leer behält Zoom', leer.zoom, 8);
  pruefeGleich('einpassen leer behält mitteX', leer.mitteX, 1);
}

// sichtbaresFenster: Bildmitte-Sicht deckt Zelle (0,0) ab.
{
  const f = sichtbaresFenster(SICHT);
  pruefe('sichtbaresFenster deckt 0', f.minX <= 0 && f.maxX >= 0 && f.minZ <= 0 && f.maxZ >= 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. cellEdits — reine Mutationen
// ─────────────────────────────────────────────────────────────────────────────

// rasteStufe: Rasterung + Klemmen.
pruefeGleich('rasteStufe +1', rasteStufe(0, 1, 0, BODEN_MAX_STUFEN), 1);
pruefeGleich('rasteStufe klemmt unten', rasteStufe(0, -1, 0, BODEN_MAX_STUFEN), 0);
pruefeGleich('rasteStufe klemmt oben', rasteStufe(BODEN_MAX_STUFEN, 1, 0, BODEN_MAX_STUFEN), BODEN_MAX_STUFEN);
pruefeGleich('rasteStufe bleibt ganz', rasteStufe(2, 3, 0, 100), 5);

// imPinsel: Kreis, nicht Quadrat.
pruefe('imPinsel Mitte', imPinsel(0, 0, 1));
pruefe('imPinsel Nachbar', imPinsel(1, 0, 1));
pruefe('imPinsel Ecke draussen', !imPinsel(1, 1, 1)); // sqrt(2) > 1

// ── Ein 'erzeugt'-Dokument als Ausgangsstand ────────────────────────────────
const SEEDS = { architektur: 7, material: 7, deko: 7 };
const DOC0 = dungeon2.erzeugeDokument2('probe', 'Probe', 'steingrab', SEEDS);
if (DOC0 === null) {
  console.log('dungeon2-zellwerkzeuge: KONNTE KEIN PROBEDOKUMENT ERZEUGEN (Thema steingrab?)');
  process.exit(1);
}

// Vorbedingung: 'erzeugt' trägt KEIN Layout — eine Handkorrektur ginge hier
// verloren. Genau das ist der Grund fürs Gebaut-Kippen.
pruefeGleich('DOC0 ist erzeugt', DOC0.modus, 'erzeugt');
pruefe('DOC0 ohne Layout', DOC0.layout === undefined);

// Eine begehbare Zelle aus dem erzeugten Layout heraussuchen.
const LAYOUT0 = dungeon2.layoutVonDokument2(DOC0)!;
const GITTER0 = dungeon2.zellenAufbauen(LAYOUT0);
const OFFENE = dungeon2.zellenSortiert(GITTER0).filter((z) => dungeon2.offen(z.art));
pruefe('erzeugtes Layout hat begehbare Zellen', OFFENE.length > 0);
const ZIEL = OFFENE[0]!;

// ── Gebaut-Kippen beim ersten Handeingriff ──────────────────────────────────
{
  const r = bodenSetzen(DOC0, ZIEL.x, ZIEL.z, ZIEL.ebene, +1);
  pruefe('bodenSetzen ändert', r.geaendert);
  pruefe('bodenSetzen kippt auf gebaut', r.gekippt);
  pruefeGleich('nach Eingriff modus gebaut', r.dokument.modus, 'gebaut');
  pruefe('nach Eingriff Layout vorhanden', r.dokument.layout !== undefined);
  pruefe('Korrektur abgelegt', (r.dokument.layout?.korrekturen.length ?? 0) >= 1);

  // Die Höhe steht im neu aufgebauten Gitter wirklich um eine Stufe höher.
  const g2 = dungeon2.zellenAufbauen(r.dokument.layout!);
  const z2 = dungeon2.zelleImGitter(g2, ZIEL.x, ZIEL.z, ZIEL.ebene)!;
  pruefeGleich('Boden um eine Stufe gehoben', z2.boden, ZIEL.boden + 1);

  // Zweiter Eingriff materialisiert NICHT erneut (schon gebaut).
  const stand2 = sicherstellenGebaut(r.dokument)!;
  pruefe('zweiter Eingriff kippt nicht mehr', !stand2.gekippt);
}

// ── Boden auf Fels: kein Effekt, kein Kippen ────────────────────────────────
{
  // Eine sicher leere Position weit ausserhalb.
  const r = bodenSetzen(DOC0, 9999, 9999, 0, +1);
  pruefe('bodenSetzen auf Fels ändert nicht', !r.geaendert);
  pruefe('bodenSetzen auf Fels kippt nicht', !r.gekippt);
  pruefeGleich('Dokument bleibt erzeugt', r.dokument.modus, 'erzeugt');
}

// ── Boden-Klemmen: senken am Anschlag 0 bleibt wirkungslos ───────────────────
{
  // Zuerst auf 0 bringen (falls schon 0, ist der erste Schritt wirkungslos).
  let doc = DOC0 as dungeon2.DungeonDokument2;
  for (let i = 0; i < 40; i++) doc = bodenSetzen(doc, ZIEL.x, ZIEL.z, ZIEL.ebene, -1).dokument;
  const g = dungeon2.zellenAufbauen(dungeon2.layoutVonDokument2(doc)!);
  const z = dungeon2.zelleImGitter(g, ZIEL.x, ZIEL.z, ZIEL.ebene)!;
  pruefeGleich('Boden am unteren Anschlag', z.boden, 0);
  const nochmal = bodenSetzen(doc, ZIEL.x, ZIEL.z, ZIEL.ebene, -1);
  pruefe('senken am Anschlag ändert nicht', !nochmal.geaendert);
}

// ── Wandflag-Toggle: Symmetrie, Umkehrbarkeit, Kanonik ──────────────────────
{
  // Zwei begehbare Kantennachbarn suchen (gleiche Ebene, x-benachbart).
  let a: dungeon2.Zelle | undefined;
  let b: dungeon2.Zelle | undefined;
  for (const z of OFFENE) {
    const n = dungeon2.zelleImGitter(GITTER0, z.x + 1, z.z, z.ebene);
    if (n !== undefined && dungeon2.offen(n.art)) {
      a = z;
      b = n;
      break;
    }
  }
  pruefe('Nachbarpaar gefunden', a !== undefined && b !== undefined);

  if (a && b) {
    // Vorher: keine erzwungene Wand zwischen A und B (beide Boden, gleiche Höhe
    // im Stempel). / no forced wall to begin with.
    // Toggle von A aus über die Ostkante.
    const r1 = wandUmschalten(DOC0, a.x, a.z, a.ebene, KANTE.Ost);
    pruefe('wandUmschalten ändert', r1.geaendert);
    const g1 = dungeon2.zellenAufbauen(r1.dokument.layout!);
    const a1 = dungeon2.zelleImGitter(g1, a.x, a.z, a.ebene)!;
    const b1 = dungeon2.zelleImGitter(g1, b.x, b.z, b.ebene)!;
    pruefe('Wand steht (von A gesehen)', dungeon2.wandZwischen(a1, b1));
    pruefe('Wand steht (von B gesehen)', dungeon2.wandZwischen(b1, a1));

    // Kanonik: Umschalten von B aus über die WESTkante trifft dieselbe
    // Speicherstelle und HEBT die Wand wieder auf.
    const r2 = wandUmschalten(r1.dokument, b.x, b.z, b.ebene, KANTE.West);
    const g2 = dungeon2.zellenAufbauen(r2.dokument.layout!);
    const a2 = dungeon2.zelleImGitter(g2, a.x, a.z, a.ebene)!;
    const b2 = dungeon2.zelleImGitter(g2, b.x, b.z, b.ebene)!;
    pruefe('Gegenkante hebt dieselbe Wand auf', !dungeon2.wandZwischen(a2, b2));

    // Umkehrbarkeit: zweimal dieselbe Kante = Ausgangszustand.
    const hin = wandUmschalten(DOC0, a.x, a.z, a.ebene, KANTE.Ost);
    const zurueck = wandUmschalten(hin.dokument, a.x, a.z, a.ebene, KANTE.Ost);
    const gz = dungeon2.zellenAufbauen(zurueck.dokument.layout!);
    const az = dungeon2.zelleImGitter(gz, a.x, a.z, a.ebene)!;
    const bz = dungeon2.zelleImGitter(gz, b.x, b.z, b.ebene)!;
    pruefe('zweimal toggeln = keine Wand', !dungeon2.wandZwischen(az, bz));
  }
}

// ── Materialtag-Pinsel: Radius trifft Kreis, klemmt Tag, lässt Fels ─────────
{
  const r = materialPinsel(DOC0, ZIEL.x, ZIEL.z, ZIEL.ebene, 3, 1);
  pruefe('materialPinsel ändert', r.geaendert);
  const g = dungeon2.zellenAufbauen(r.dokument.layout!);
  const mitte = dungeon2.zelleImGitter(g, ZIEL.x, ZIEL.z, ZIEL.ebene)!;
  pruefeGleich('Pinsel-Mitte hat Tag 3', mitte.materialTag, 3);

  // Klemmen: Tag über MAX -> MAX.
  const r2 = materialPinsel(DOC0, ZIEL.x, ZIEL.z, ZIEL.ebene, 99, 0);
  const g2 = dungeon2.zellenAufbauen(r2.dokument.layout!);
  const m2 = dungeon2.zelleImGitter(g2, ZIEL.x, ZIEL.z, ZIEL.ebene)!;
  pruefeGleich('Tag geklemmt auf MAX', m2.materialTag, dungeon2.MAX_MATERIAL_TAG);

  // Negativfall: Pinsel nur auf Fels ändert nichts.
  const r3 = materialPinsel(DOC0, 9999, 9999, 0, 2, 1);
  pruefe('Pinsel nur auf Fels ändert nicht', !r3.geaendert);
}

// ── Raum-Stempel setzen/entfernen: Rundlauf ─────────────────────────────────
{
  const vorlage: StempelVorlage = { typ: 'kammer', breite: 4, tiefe: 4, hoehe: 12, bodenVersatz: 0 };
  // Weit weg vom erzeugten Grab setzen, damit kein Vorgänger überlappt.
  const setz = stempelSetzen(DOC0, vorlage, 100, 100, 0, 0);
  pruefe('stempelSetzen ändert', setz.ergebnis.geaendert);
  pruefe('stempelSetzen liefert Id', setz.id > 0);

  const nachSetzen = dungeon2.zellenAufbauen(setz.ergebnis.dokument.layout!);
  const proben = [
    dungeon2.zelleImGitter(nachSetzen, 100, 100, 0),
    dungeon2.zelleImGitter(nachSetzen, 103, 103, 0),
  ];
  pruefe('Stempel füllt 4×4 Fußabdruck', proben.every((z) => z !== undefined && dungeon2.offen(z.art)));

  // Entfernen -> Zellen wieder Fels, Stempelzahl wie vorher.
  const stempelVorher = dungeon2.layoutVonDokument2(DOC0)!.stempel.length;
  const weg = stempelEntfernen(setz.ergebnis.dokument, setz.id);
  pruefe('stempelEntfernen ändert', weg.geaendert);
  pruefeGleich('Stempelzahl wieder wie vorher', weg.dokument.layout!.stempel.length, stempelVorher);
  const nachWeg = dungeon2.zellenAufbauen(weg.dokument.layout!);
  pruefe('Fußabdruck wieder Fels', dungeon2.zelleImGitter(nachWeg, 100, 100, 0) === undefined);

  // Negativfall: unbekannte Id entfernt nichts.
  const nichts = stempelEntfernen(setz.ergebnis.dokument, 999999);
  pruefe('unbekannte Stempel-Id ändert nicht', !nichts.geaendert);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ergebnis / result
// ─────────────────────────────────────────────────────────────────────────────

console.log(`dungeon2-zellwerkzeuge: ${gutZahl} Pruefungen gruen, ${fehlerListe.length} rot`);
for (const f of fehlerListe) console.log(`  ROT  ${f}`);
process.exit(fehlerListe.length === 0 ? 0 : 1);
