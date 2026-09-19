/**
 * Placing tool: set, select, drag, change and delete single objects
 * (`layout.placements`). Moved out of `editorMain.ts`, where a click only
 * appended an id-less entry with a random turn and nothing could be touched
 * afterwards.
 *
 *  - Click on free ground sets the chosen prefab. The entry gets its id from
 *    `neuePlatzierungsId` AT ONCE and keeps it: a derived id is not an
 *    address (a new id-less entry could take the id of an equal object at the
 *    same place, and the game server's object would move with it).
 *  - Click on an existing object selects it (nearest one within `TREFFER_PX`
 *    screen pixels, converted to metres with the map scale). Shift+click sets
 *    a new object even on top of an existing one (series, stacking).
 *  - Pressing on an object and moving the pointer drags it. The drag is shown
 *    as a ghost and committed on release as ONE change: one undo step, one
 *    operation (a PATCH later on), not thirty.
 *  - The sidebar shows id, prefab, x/z, turn and scale of the selection as
 *    fields; Delete removes it. Turning a selected object into another prefab
 *    asks first: the game server REPLACES the object, its state is lost.
 *
 * Every change is a world operation of `shared/src/worldlayout/ops.ts`
 * (`opSetzen` / `opAendern` / `opEntfernen`) applied with `wende`; its result
 * goes to the editor through `ctx.aendere(neu, vorgang)`. `wende` runs the
 * sanitizer and refuses what it would have to cut (2,000 placements, a prefab
 * name it drops): the tool then changes nothing and says why.
 *
 * The selection is only an id. It is looked up in the current document each
 * time, so an undo that takes the object away simply leaves nothing selected.
 */
import { FOLIAGE, LAYOUT_MAX_EXTENT, type PlacementDef, type WorldLayout } from '@wov/shared';
import { opAendern, opEntfernen, opSetzen, wende, type Op, type OpEntry, type Vorgang, type WendeErgebnis } from '@wov/shared/src/worldlayout/ops.js';
import { neuePlatzierungsId } from '@wov/shared/src/worldlayout/platzierungsId.js';
import { F, PFAD, el, feld, stil } from '../design';
import type { KartenWerkzeug, WerkzeugKontext } from './typ';

/** A click hits an object when it lands at most this many screen pixels from it (dots are 3 px wide). */
export const TREFFER_PX = 8;
/** A pressed pointer has to travel this many screen pixels before it drags (a shaky click must not move the object). */
export const ZUG_PX = 4;
/** Key of the prefab the 3D test flight (key B) places as well; both ways should mean the same object. */
export const PREFAB_SCHLUESSEL = 'wov-editor-spawn-prefab';
/** The prefab a fresh editor starts with. */
export const VORGABE_PREFAB = 'Beech1';
/** The document keeps prefab names up to this length (sanitizer). */
const PREFAB_MAX = 64;

const TIPP =
  'Klick setzt das gewählte Prefab, Klick auf ein Objekt wählt es, Ziehen verschiebt es, Entf löscht es. ' +
  'Shift setzt auch auf ein bestehendes Objekt. Die Höhe folgt dem Boden.';

/** A placement that is addressable: it has its id. */
type Adressiert = PlacementDef & { id: string };

const alsEintrag = (p: PlacementDef): OpEntry => ({ ...p }) as unknown as OpEntry;

/** The nearest placement with an id within `toleranzM` metres of the point; the earlier one wins a tie. */
export function trefferSuchen(
  platzierungen: readonly PlacementDef[],
  wx: number,
  wz: number,
  toleranzM: number
): Adressiert | undefined {
  let bester: Adressiert | undefined;
  let abstand = Infinity;
  for (const p of platzierungen) {
    if (typeof p.id !== 'string') continue;
    const d = Math.hypot(p.x - wx, p.z - wz);
    if (d <= toleranzM && d < abstand) {
      abstand = d;
      bester = p as Adressiert;
    }
  }
  return bester;
}

const ZAHL = String.raw`-?\d+(?:\.\d+)?`;

/**
 * The placement a finding of the check (`pruefeLayout`, `wo: 'placements'`)
 * is about, or `null`. A finding carries no structured address, only text: a
 * prefab with its position (`Beech1 @(10, 20)`), or, for id findings, the id
 * itself (`... : beech1_10_20`). Prefab and position must match exactly; an
 * id must be the whole word. Findings that count objects ("kein eigenes
 * Modell: X (12 Platzierungen)") name none and give `null`.
 */
export function platzierungZuBefund(layout: WorldLayout, befund: { wo: string; text: string }): string | null {
  if (befund.wo !== 'placements') return null;
  const liste = (layout.placements ?? []).filter((p): p is Adressiert => typeof p.id === 'string');
  for (const m of befund.text.matchAll(new RegExp(String.raw`(\S+) @\((${ZAHL}), (${ZAHL})\)`, 'g'))) {
    // `\S+` also swallows an opening bracket in front of the prefab: "(Beech1 @(300, 400))".
    const treffer = liste.find((p) => (p.prefab === m[1] || `(${p.prefab}` === m[1]) && p.x === Number(m[2]) && p.z === Number(m[3]));
    if (treffer) return treffer.id;
  }
  const nachDoppelpunkt = befund.text.slice(befund.text.lastIndexOf(': ') + 2);
  const ids = new Set(liste.map((p) => p.id));
  for (const wort of nachDoppelpunkt.split(/\s+/)) if (ids.has(wort)) return wort;
  return null;
}

const ausserhalb = (...werte: (number | undefined)[]): boolean => werte.some((n) => n !== undefined && !(Math.abs(n) <= LAYOUT_MAX_EXTENT));
const AUSSERHALB = `Außerhalb der Welt (höchstens ±${LAYOUT_MAX_EXTENT} m)`;

/** The change as text for the status bar when `wende` refuses it. */
function grund(r: Extract<WendeErgebnis, { ok: false }>): string {
  return r.art === 'konflikt' ? `Konflikt: ${r.ids.join(', ')} hat sich geändert — nichts geändert` : r.message;
}

const grad = (rad: number): number => Math.round(((rad * 180) / Math.PI) * 100) / 100;
const zeigeZahl = (n: number): string => String(Math.round(n * 1000) / 1000);
/** What a value change amounts to for the world: `undefined` yaw is 0, `undefined` scale is 1. */
const wirkung = (p: PlacementDef): string => JSON.stringify([p.prefab, p.x, p.z, p.yaw ?? 0, p.scale ?? 1]);

/** Parse a number typed into a field (comma or point); `null` when it is none. */
function lies(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** What the placing tool offers beyond `KartenWerkzeug`: the editor's catalog sets the prefab, the check jumps to an object. */
export interface PlatzierenWerkzeug extends KartenWerkzeug<'platzieren'> {
  /** The prefab new objects get. */
  prefab(): string;
  /** Choose the prefab for new objects (empty = the default) and remember it for the test flight. */
  setzePrefab(name: string): void;
  /** The id of the selected object (`null` = none; the object may since have been removed from the document). */
  auswahlId(): string | null;
  /** Select an object by id (`null` = deselect). */
  waehle(id: string | null): void;
}

export interface PlatzierenOptionen {
  /** A number in [0, 1) for the random turn; injectable so a test is deterministic. */
  zufall?: () => number;
  /** Remembers the prefab outside the editor state; the default writes `localStorage` when there is one. */
  merkePrefab?: (name: string) => void;
}

const merkeImBrowser = (name: string): void => {
  try {
    localStorage.setItem(PREFAB_SCHLUESSEL, name);
  } catch {
    // no storage (private window, plain Node): the choice simply is not remembered
  }
};

let vorgangZaehler = 0;

/** A fresh placing tool with its own state (prefab, turn, selection, drag). */
export function erzeugePlatzieren(opt: PlatzierenOptionen = {}): PlatzierenWerkzeug {
  const zufallszahl = opt.zufall ?? Math.random;
  const merke = opt.merkePrefab ?? merkeImBrowser;

  let prefab = VORGABE_PREFAB;
  let zufaelligeDrehung = true;
  let drehungGrad = 0;
  let gewaehlt: string | null = null;
  /** A pressed pointer on an object: `bewegt` once it has travelled `ZUG_PX`. */
  let zug: { id: string; vonX: number; vonZ: number; griffX: number; griffZ: number; nachX: number; nachZ: number; bewegt: boolean } | null =
    null;

  const auswahlVon = (layout: WorldLayout): Adressiert | undefined =>
    gewaehlt === null ? undefined : (layout.placements ?? []).find((p): p is Adressiert => p.id === gewaehlt);

  /** Build, apply and hand over ONE operation; `null` (and a message) when `wende` refuses it. */
  function fuehreAus(ctx: WerkzeugKontext, art: string, op: Op): WorldLayout | null {
    const vorgang: Vorgang = { vorgangId: `platzieren-${art}-${Date.now().toString(36)}-${++vorgangZaehler}`, ops: [op] };
    const r = wende(ctx.layout(), vorgang);
    if (!r.ok) {
      ctx.meldung(grund(r), true);
      return null;
    }
    ctx.aendere(r.layout, vorgang);
    return r.layout;
  }

  /** Replace fields of the selected object as one operation; a change with no effect on the world is no change. */
  function aendereAuswahl(ctx: WerkzeugKontext, aenderung: Partial<PlacementDef>, text: (p: Adressiert) => string): void {
    const p = auswahlVon(ctx.layout());
    if (!p) return;
    if (ausserhalb(aenderung.x, aenderung.z)) {
      ctx.meldung(`${AUSSERHALB} — nichts geändert`, true);
      ctx.seiteNeuBauen();
      return;
    }
    const neu: PlacementDef = { ...p, ...aenderung };
    if (wirkung(neu) === wirkung(p)) {
      ctx.seiteNeuBauen(); // show the value as the document holds it
      return;
    }
    if (!fuehreAus(ctx, 'aendern', opAendern(ctx.layout(), 'placements', alsEintrag(neu)))) {
      ctx.seiteNeuBauen();
      return;
    }
    ctx.uebernommen();
    ctx.meldung(text(p));
  }

  function loesche(ctx: WerkzeugKontext): void {
    zug = null;
    const p = auswahlVon(ctx.layout());
    if (!p) return;
    if (!fuehreAus(ctx, 'entfernen', opEntfernen(ctx.layout(), 'placements', p.id))) return;
    gewaehlt = null;
    ctx.uebernommen();
    ctx.meldung(`${p.id} entfernt — Strg+Z holt es zurück`);
  }

  function setzePrefab(name: string): void {
    prefab = name.trim() || VORGABE_PREFAB;
    merke(prefab);
  }

  return {
    id: 'platzieren',
    titel: 'Objekt platzieren',
    bild: PFAD.platzieren,
    kachelName: 'Objekt platzieren',
    kachelBreit: true,
    kachelTipp: TIPP,
    tasten: [
      ['Klick', 'setzen / wählen'],
      ['Ziehen', 'verschieben'],
      ['Entf', 'löschen'],
      ['Shift', 'auf Objekt setzen'],
    ],
    kachelZusatz: () => prefab,
    hudZusatz: () => prefab,

    prefab: () => prefab,
    setzePrefab,
    auswahlId: () => gewaehlt,
    waehle(id) {
      gewaehlt = id;
      zug = null;
    },

    beiZeigerRunter(ctx, e) {
      const layout = ctx.layout();
      if (!e.shiftKey) {
        const treffer = trefferSuchen(layout.placements ?? [], e.weltX, e.weltZ, TREFFER_PX * ctx.massstab());
        if (treffer) {
          gewaehlt = treffer.id;
          zug = { id: treffer.id, vonX: treffer.x, vonZ: treffer.z, griffX: e.weltX, griffZ: e.weltZ, nachX: treffer.x, nachZ: treffer.z, bewegt: false };
          ctx.seiteNeuBauen();
          ctx.neuZeichnen();
          return true;
        }
      }
      const x = Math.round(e.weltX);
      const z = Math.round(e.weltZ);
      if (ausserhalb(x, z)) {
        ctx.meldung(`${AUSSERHALB} — nichts gesetzt`, true);
        return true;
      }
      const id = neuePlatzierungsId(layout, { prefab, x, z });
      // The turn goes into the document rounded to 0.001 rad (0.06 degrees): 17 digits of a random number are noise.
      const yaw = zufaelligeDrehung ? Math.round(zufallszahl() * Math.PI * 2 * 1000) / 1000 : (drehungGrad * Math.PI) / 180;
      zug = null;
      if (!fuehreAus(ctx, 'setzen', opSetzen('placements', alsEintrag({ id, prefab, x, z, yaw })))) return true;
      gewaehlt = id;
      ctx.uebernommen();
      ctx.meldung(`${id} gesetzt — Strg+Z macht es rückgängig`);
      return true;
    },

    beiZeigerBewegt(ctx, e) {
      if (!zug) return;
      if (!zug.bewegt && Math.hypot(e.weltX - zug.griffX, e.weltZ - zug.griffZ) < ZUG_PX * ctx.massstab()) return;
      zug.bewegt = true;
      zug.nachX = Math.round(zug.vonX + e.weltX - zug.griffX);
      zug.nachZ = Math.round(zug.vonZ + e.weltZ - zug.griffZ);
      ctx.neuZeichnen();
    },

    beiZeigerHoch(ctx, e) {
      const z = zug;
      zug = null;
      if (!z) return;
      if (!z.bewegt) {
        ctx.neuZeichnen(); // a plain click: selected, nothing moved
        return;
      }
      const x = Math.round(z.vonX + e.weltX - z.griffX);
      const zz = Math.round(z.vonZ + e.weltZ - z.griffZ);
      if (gewaehlt !== z.id || !auswahlVon(ctx.layout())) {
        ctx.neuZeichnen(); // undone or replaced in the meantime: nothing to move any more
        return;
      }
      aendereAuswahl(ctx, { x, z: zz }, (p) => `${p.id} verschoben (${x}, ${zz})`);
      ctx.neuZeichnen();
    },

    beiTaste(ctx, e) {
      if (e.code === 'Escape') {
        if (zug) {
          zug = null; // cancels a drag first, keeps the selection
        } else if (gewaehlt !== null) {
          gewaehlt = null;
          ctx.seiteNeuBauen();
        }
        ctx.neuZeichnen();
        return false; // Escape does not end this tool (it never did)
      }
      if (e.code === 'Delete') loesche(ctx);
      return false;
    },

    zeichneOverlay(ctx, zeichner) {
      if (ctx.werkzeugId() !== 'platzieren') return;
      const p = auswahlVon(ctx.layout());
      if (!p) return;
      zeichner.save();
      zeichner.setLineDash([]);
      zeichner.strokeStyle = F.akzentLicht;
      zeichner.lineWidth = 2;
      const [px, py] = ctx.zuBild(p.x, p.z);
      zeichner.beginPath();
      zeichner.arc(px, py, 8, 0, Math.PI * 2);
      zeichner.stroke();
      if (zug?.bewegt) {
        const [gx, gy] = ctx.zuBild(zug.nachX, zug.nachZ);
        zeichner.setLineDash([4, 4]);
        zeichner.beginPath();
        zeichner.moveTo(px, py);
        zeichner.lineTo(gx, gy);
        zeichner.stroke();
        zeichner.setLineDash([]);
        zeichner.beginPath();
        zeichner.arc(gx, gy, 5, 0, Math.PI * 2);
        zeichner.fillStyle = F.akzentLicht;
        zeichner.fill();
      }
      zeichner.restore();
    },

    abbrechen() {
      zug = null;
      gewaehlt = null;
    },

    seitenleiste(ctx, host) {
      const block = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '8px' }));

      // ── New objects: prefab and turn ──
      const prefabFeld = feld(
        prefab,
        (v) => {
          if (v.trim().length > PREFAB_MAX) {
            ctx.meldung(`Prefab-Name zu lang (höchstens ${PREFAB_MAX} Zeichen)`, true);
          } else {
            setzePrefab(v);
          }
          ctx.seiteNeuBauen();
        },
        { titel: 'Prefab-Name neuer Objekte — Vorschläge aus der Vegetationstabelle' }
      );
      const eingabe = prefabFeld.querySelector('input');
      if (eingabe) eingabe.setAttribute('list', 'prefab-liste');
      if (!document.getElementById('prefab-liste')) {
        const dl = document.createElement('datalist');
        dl.id = 'prefab-liste';
        for (const n of [...new Set(FOLIAGE.map((f) => f.prefabName))]) {
          const o = document.createElement('option');
          o.value = n;
          dl.appendChild(o);
        }
        document.body.appendChild(dl);
      }
      block.append(
        host.beschriftet('Prefab (neue Objekte)', prefabFeld),
        host.beschriftet(
          'Drehung neuer Objekte',
          feld(
            zeigeZahl(drehungGrad),
            (v) => {
              const n = lies(v);
              if (n === null) ctx.meldung('Drehung muss eine Zahl sein (Grad)', true);
              else drehungGrad = n % 360;
              ctx.seiteNeuBauen();
            },
            { mono: true, einheit: '°', titel: 'Drehung neuer Objekte in Grad (gilt bei ausgeschalteter Zufallsdrehung)' }
          )
        ),
        host.breiterKnopf(
          zufaelligeDrehung ? 'Zufällige Drehung: an' : 'Zufällige Drehung: aus',
          () => {
            zufaelligeDrehung = !zufaelligeDrehung;
            ctx.seiteNeuBauen();
          },
          zufaelligeDrehung ? PFAD.haken : undefined
        )
      );

      // ── The selected object ──
      const p = auswahlVon(ctx.layout());
      if (p) {
        const zeile = (...felder: HTMLElement[]): HTMLElement => {
          const z = el('div', stil({ display: 'flex', gap: '8px' }));
          z.append(...felder);
          return z;
        };
        const zahlFeld = (wert: string, titel: string, einheit: string, bei: (n: number) => void): HTMLElement =>
          feld(
            wert,
            (v) => {
              const n = lies(v);
              if (n === null) {
                ctx.meldung(`${titel}: keine Zahl`, true);
                ctx.seiteNeuBauen();
              } else {
                bei(n);
              }
            },
            { mono: true, einheit, titel }
          );
        block.append(
          host.beschriftet('Ausgewähltes Objekt', el('div', stil({ 'font-family': 'monospace', 'font-size': '12px', color: F.text }), p.id)),
          host.beschriftet(
            'Prefab',
            feld(
              p.prefab,
              (v) => {
                const neu = v.trim();
                const alt = ctx.layout().placements?.find((q) => q.id === p.id)?.prefab;
                if (neu === '' || neu === alt) {
                  ctx.seiteNeuBauen();
                  return;
                }
                if (
                  !ctx.bestaetige(
                    `${p.id}: Prefab von "${alt}" auf "${neu}" wechseln?\n\n` +
                      'Das ersetzt das Objekt im Spiel — sein Zustand geht verloren.'
                  )
                ) {
                  ctx.meldung('Prefab nicht geändert');
                  ctx.seiteNeuBauen();
                  return;
                }
                aendereAuswahl(ctx, { prefab: neu }, (q) => `${q.id}: Prefab ${q.prefab} → ${neu}`);
              },
              { titel: 'Prefab des ausgewählten Objekts (ein Wechsel ersetzt das Objekt im Spiel)' }
            )
          ),
          zeile(
            zahlFeld(zeigeZahl(p.x), 'x des ausgewählten Objekts in Metern', 'm', (n) =>
              aendereAuswahl(ctx, { x: Math.round(n * 1000) / 1000 }, (q) => `${q.id}: x ${zeigeZahl(n)}`)
            ),
            zahlFeld(zeigeZahl(p.z), 'z des ausgewählten Objekts in Metern', 'm', (n) =>
              aendereAuswahl(ctx, { z: Math.round(n * 1000) / 1000 }, (q) => `${q.id}: z ${zeigeZahl(n)}`)
            )
          ),
          zeile(
            zahlFeld(zeigeZahl(grad(p.yaw ?? 0)), 'Drehung des ausgewählten Objekts in Grad', '°', (n) =>
              aendereAuswahl(ctx, { yaw: ((n % 360) * Math.PI) / 180 }, (q) => `${q.id}: Drehung ${zeigeZahl(n % 360)}°`)
            ),
            zahlFeld(zeigeZahl(p.scale ?? 1), 'Skalierung des ausgewählten Objekts (0,2 bis 5)', '×', (n) => {
              const s = Math.min(5, Math.max(0.2, n));
              aendereAuswahl(ctx, { scale: Math.round(s * 1000) / 1000 }, (q) => `${q.id}: Skalierung ${zeigeZahl(s)}${s !== n ? ' (auf 0,2 bis 5 begrenzt)' : ''}`);
            })
          ),
          host.breiterKnopf('Objekt löschen (Entf)', () => loesche(ctx), PFAD.kreuz)
        );
      }
      block.appendChild(host.hinweis(TIPP));
      return block;
    },
  };
}
