/**
 * Schreib-Werkzeuge in Einzeländerungen: ops_apply und undo_last.
 *
 * Geschrieben wird nur über PATCH /api/worldlayout/ops des Betriebsdienstes,
 * und NUR über `schreibeVorgang` unten: Der Dienst prüft die weltKennung
 * beim PATCH nicht, die Sperre gegen fremde Welten liegt allein im
 * MCP-Prozess. Deshalb geht jedem PATCH ein frisches `lade()` (holt die
 * Kennung) und `pruefeEigeneWelt()` voraus, auch bei der Trockenfahrt.
 *
 * Die Aufrufe laufen nacheinander (eine Warteschlange), damit sich zwei
 * gleichzeitige Aufrufe nicht um Stapel und Dokument streiten. Der Stapel
 * (`vorgangsStapel`) liegt nur im Speicher; world_diff kann ihn lesen.
 *
 * Single-change write tools: ops_apply (dry run or real) and undo_last, over
 * PATCH /api/worldlayout/ops only, each preceded by lade() + pruefeEigeneWelt().
 */
import { z } from 'zod';
import { PREFABS_BY_NAME } from '@wov/shared/src/prefabs.js';
import { OP_COLLECTIONS, invertiere, wende, type Vorgang } from '@wov/shared/src/worldlayout/ops.js';
import type { WorldLayout } from '@wov/shared/src/worldlayout/types.js';
import { diffLayouts } from '@wov/shared/src/weltbau/diff.js';
import { baueVorgang, VorgangFehler, OPS_MAX_JE_AUFRUF } from '@wov/shared/src/weltbau/vorgangBauen.js';
import { VorgangsStapel, STAPEL_MAX } from '@wov/shared/src/weltbau/stapel.js';
import { adminAnfrage, lade, mcp, meldungVon, pruefeEigeneWelt } from '../kern.js';
import { leseUploads } from './uploads.js';

type Antwort = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const ok = (kopf: string, daten: unknown): Antwort => ({
  content: [{ type: 'text', text: `${kopf}\n\n${JSON.stringify(daten)}` }],
});
const fehler = (text: string, daten?: unknown): Antwort => ({
  content: [{ type: 'text', text: daten === undefined ? text : `${text}\n\n${JSON.stringify(daten)}` }],
  isError: true,
});

/** Die eigenen Vorgänge dieses Prozesses; world_diff (`gegen: 'vorgang'`) liest ihn. */
export const vorgangsStapel = new VorgangsStapel(STAPEL_MAX);

let zaehler = 0;
let warteschlange: Promise<unknown> = Promise.resolve();
/** Ein Aufruf nach dem anderen; ein Fehler blockiert die Schlange nicht. */
function nacheinander<T>(arbeit: () => Promise<T>): Promise<T> {
  const lauf = warteschlange.then(arbeit, arbeit);
  warteschlange = lauf.then(
    () => undefined,
    () => undefined
  );
  return lauf;
}

interface PatchErfolg {
  art: 'ok';
  hash: string;
  sicherung: string | null;
  positionUngenau?: unknown;
}
interface PatchAbgelehnt {
  art: 'abgelehnt';
  status: number;
  meldung: string;
  daten: Record<string, unknown>;
}

/**
 * Der EINZIGE Weg, auf dem dieses Modul schreibt: Kennung prüfen (wirft bei
 * fremdem Betriebsdienst, bevor irgendetwas gesendet wird), dann PATCH.
 * Setzt voraus, dass unmittelbar davor `lade()` lief (die Kennung stammt aus
 * dessen Antwort).
 */
async function schreibeVorgang(vorgang: Vorgang): Promise<PatchErfolg | PatchAbgelehnt> {
  pruefeEigeneWelt();
  const { status, daten } = await adminAnfrage('PATCH', vorgang, '/api/worldlayout/ops');
  // 202 (K5.0): geschrieben, aber (noch) nicht angewendet (Spielserver aus, Geo, abgelehnt) — die Datei steht.
  if ((status === 200 || status === 202) && typeof daten.hash === 'string') {
    return {
      art: 'ok',
      hash: daten.hash,
      sicherung: typeof daten.sicherung === 'string' ? daten.sicherung : null,
      ...(daten.positionUngenau !== undefined ? { positionUngenau: daten.positionUngenau } : {}),
    };
  }
  return { art: 'abgelehnt', status, meldung: meldungVon(daten), daten };
}

/** Übersetzt eine Ablehnung des Dienstes in eine Meldung an die KI. */
function ablehnung(werkzeug: string, r: PatchAbgelehnt): Antwort {
  if (r.status === 409) {
    const ids = Array.isArray(r.daten.ids) ? (r.daten.ids as string[]).join(', ') : '?';
    return fehler(
      `${werkzeug}: Konflikt an ${ids} — nichts geschrieben. Jemand hat diese Objekte seit dem Lesen geändert; ` +
        'mit layout_get/area_describe neu ansehen und die Änderung erneut planen.',
      { fehler: 'konflikt', ids: r.daten.ids, eintraege: r.daten.eintraege }
    );
  }
  if (r.status === 422) return fehler(`${werkzeug}: abgelehnt (422): ${r.meldung} — nichts geschrieben.`, { fehler: r.daten.fehler });
  if (r.status === 503) return fehler(`${werkzeug}: Betriebsdienst gerade gesperrt (503): ${r.meldung} — später erneut versuchen (etwa 3 s), nichts geschrieben.`);
  if (r.status === 404) return fehler(`${werkzeug}: ${r.meldung}`);
  return fehler(`${werkzeug}: Betriebsdienst antwortet ${r.status}: ${r.meldung} — nichts geschrieben.`);
}

function zaehlerVon(vor: WorldLayout, nach: WorldLayout, positionUngenau: number) {
  const d = diffLayouts(vor, nach);
  const z = d.zaehler;
  return { neu: z.neu, geaendert: z.geaendert, entfernt: z.entfernt, verschoben: z.verschoben, geo: d.geo, positionUngenau, text: d.text };
}

const opSchema = z.object({
  art: z.enum(['setze', 'aendere', 'entferne']),
  sammlung: z.enum(OP_COLLECTIONS),
  id: z.string().optional().describe('bei setze einer Platzierung optional (dann wird eine frische id vergeben)'),
  nachher: z.record(z.string(), z.unknown()).optional().describe('setze/aendere: der GANZE Eintrag'),
  vorher: z.record(z.string(), z.unknown()).optional().describe('optional: was du gesehen hast; fehlt es, gilt der frisch gelesene Stand'),
});

mcp.registerTool(
  'ops_apply',
  {
    description:
      'Ändert das Weltdokument in Einzeländerungen (setze/aendere/entferne je Objekt) über den Betriebsdienst. ' +
      '`trocken` ist Pflicht: true rechnet nur voraus, was geschähe, und schreibt nichts; false schreibt. ' +
      'Alle Operationen eines Aufrufs stehen oder fallen zusammen (ein Undo-Schritt). ' +
      `Höchstens ${OPS_MAX_JE_AUFRUF} Operationen; ein Objekt höchstens einmal je Aufruf. ` +
      'Platzierungen brauchen ein Prefab aus catalog_search bzw. uploads_list (sonst Fehler, nichts gesendet). ' +
      '`vorher` weglassen heißt: der Stand, den dieser Aufruf gerade liest; wer strenger sein will, gibt `vorher` mit ' +
      '(dann meldet eine fremde Änderung am selben Objekt einen Konflikt). Geländeänderungen (Regionen, Flüsse, Seen, ' +
      'Kontinente, einebnen) wirken erst nach Neustart des Spielservers. Rückgängig: undo_last (nur Vorgänge von ops_apply, ' +
      'nicht von den alten *_set/*_delete).',
    inputSchema: {
      trocken: z.boolean().describe('true = nur vorausrechnen, nichts schreiben'),
      vorgangId: z.string().optional().describe('Vorgabe mcp-<pid>-<zähler>; nicht mit ~ beginnen'),
      ops: z.array(opSchema).min(1).max(OPS_MAX_JE_AUFRUF),
    },
  },
  ({ trocken, vorgangId, ops }): Promise<Antwort> =>
    nacheinander(async () => {
      try {
        // 1. Frisch lesen (Dokument, Basis-Hash, weltKennung), dann die Welt prüfen — auch bei trocken.
        const { layout, hash } = await lade();
        pruefeEigeneWelt();
        if (vorgangId?.startsWith('~')) return fehler('ops_apply: vorgangId darf nicht mit ~ beginnen (das kennzeichnet ein Undo).');
        leseUploads();
        // 2. Vorgang bauen (Prefab-Prüfung, ids, vorher) und lokal vorausrechnen.
        const id = vorgangId ?? `mcp-${process.pid}-${++zaehler}`;
        const vorgang = baueVorgang(layout, ops, { vorgangId: id, pruefePrefab: (n) => PREFABS_BY_NAME.has(n) });
        const w = wende(layout, vorgang);
        if (!w.ok) {
          if (w.art === 'konflikt') return fehler(`ops_apply: Konflikt an ${w.ids.join(', ')} — nichts geschrieben (der Stand passt nicht zu \`vorher\`/existiert schon).`, { fehler: 'konflikt', ids: w.ids, stellen: w.stellen });
          return fehler(`ops_apply: ${w.message}`, { fehler: w.art });
        }
        const z = zaehlerVon(layout, w.layout, w.positionUngenau.length);
        const zusammen = `${z.text}${z.geo ? ' (Gelände betroffen: wirkt nach Neustart)' : ''}`;
        // 2b. Leerer Diff: nichts schreiben, keinen Vorgang anlegen (auch nicht als Trockenfahrt-Ergebnis „geschehen“).
        if (z.neu + z.geaendert + z.entfernt + z.verschoben === 0 && !z.geo) {
          return ok(`ops_apply: Keine Änderungen — nichts geschrieben, kein Vorgang angelegt${trocken ? ' (trocken)' : ''}`, {
            trocken,
            leer: true,
            geschrieben: false,
            basisHash: hash,
            zaehler: z,
            stapel: vorgangsStapel.laenge,
          });
        }
        // 3. Trockenfahrt: hier endet es, ohne Netzverkehr über das GET hinaus.
        if (trocken) {
          return ok(`ops_apply (trocken, nichts geschrieben): ${zusammen}`, {
            trocken: true,
            vorgangId: id,
            basisHash: hash,
            zaehler: z,
            ...(w.positionUngenau.length > 0 ? { positionUngenau: w.positionUngenau } : {}),
          });
        }
        // 4. Schreiben.
        const r = await schreibeVorgang(vorgang);
        if (r.art === 'abgelehnt') return ablehnung('ops_apply', r);
        vorgangsStapel.push({ vorgang, stand: layout, hashVor: hash, hashNach: r.hash, zeit: Date.now() });
        return ok(`ops_apply: Vorgang ${id} gespeichert: ${zusammen}`, {
          trocken: false,
          vorgangId: id,
          hash: r.hash,
          basisHash: hash,
          sicherung: r.sicherung,
          zaehler: z,
          stapel: vorgangsStapel.laenge,
          ...(r.positionUngenau !== undefined ? { positionUngenau: r.positionUngenau, hinweis: 'Die Reihenfolge einiger Einträge konnte nicht exakt hergestellt werden; bitte prüfen.' } : {}),
        });
      } catch (f) {
        if (f instanceof VorgangFehler) return fehler(`ops_apply: ${f.message}`, f.unbekannteNamen.length > 0 ? { unbekanntePrefabs: f.unbekannteNamen } : undefined);
        return fehler(`ops_apply: ${(f as Error).message}`);
      }
    })
);

mcp.registerTool(
  'undo_last',
  {
    description:
      'Nimmt den letzten eigenen ops_apply-Vorgang dieses Prozesses zurück (Gegenvorgang über den Betriebsdienst). ' +
      `Der Stapel (höchstens ${STAPEL_MAX}) liegt nur im Speicher: nach einem Neustart des MCP-Prozesses ist er leer. ` +
      'Vorgänge der alten *_set/*_delete-Werkzeuge kennt er nicht. Hat jemand die Objekte inzwischen geändert, ' +
      'gibt es einen Konflikt, nichts wird geschrieben und der Vorgang bleibt auf dem Stapel.',
    inputSchema: { trocken: z.boolean().optional().describe('true = nur vorausrechnen (Vorgabe false)') },
  },
  ({ trocken }): Promise<Antwort> =>
    nacheinander(async () => {
      try {
        const oben = vorgangsStapel.oberster();
        if (!oben) return fehler('undo_last: nichts zurückzunehmen — der Stapel dieses Prozesses ist leer (nach einem Neustart geht er verloren; alte *_set/*_delete-Änderungen kennt er nicht).');
        const { layout, hash } = await lade();
        pruefeEigeneWelt();
        const gegen = invertiere(oben.vorgang);
        const w = wende(layout, gegen);
        if (!w.ok) {
          if (w.art === 'konflikt') {
            return fehler(
              `undo_last: Konflikt an ${w.ids.join(', ')} — jemand hat diese Objekte seit ${oben.vorgang.vorgangId} geändert. Nichts geschrieben, der Vorgang bleibt auf dem Stapel.`,
              { fehler: 'konflikt', ids: w.ids, stellen: w.stellen }
            );
          }
          return fehler(`undo_last: ${w.message}`, { fehler: w.art });
        }
        const z = zaehlerVon(layout, w.layout, w.positionUngenau.length);
        const zusammen = `${z.text}${z.geo ? ' (Gelände betroffen: wirkt nach Neustart)' : ''}`;
        if (trocken === true) {
          return ok(`undo_last (trocken, nichts geschrieben): ${oben.vorgang.vorgangId} → ${zusammen}`, {
            trocken: true,
            vorgangId: gegen.vorgangId,
            zurueck: oben.vorgang.vorgangId,
            basisHash: hash,
            zaehler: z,
            stapel: vorgangsStapel.laenge,
          });
        }
        const r = await schreibeVorgang(gegen);
        if (r.art === 'abgelehnt') return ablehnung('undo_last', r);
        vorgangsStapel.pop();
        return ok(`undo_last: ${oben.vorgang.vorgangId} zurückgenommen: ${zusammen}`, {
          trocken: false,
          vorgangId: gegen.vorgangId,
          zurueck: oben.vorgang.vorgangId,
          hash: r.hash,
          sicherung: r.sicherung,
          zaehler: z,
          stapel: vorgangsStapel.laenge,
          ...(r.positionUngenau !== undefined ? { positionUngenau: r.positionUngenau, hinweis: 'Die Reihenfolge einiger Einträge konnte nicht exakt hergestellt werden; bitte prüfen.' } : {}),
        });
      } catch (f) {
        return fehler(`undo_last: ${(f as Error).message}`);
      }
    })
);
