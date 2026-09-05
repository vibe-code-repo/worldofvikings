/**
 * Hilfsmittel: die zwei Zuordnungen, die ein Abgleich zwischen
 * Prefab-Tabelle und Plattenbestand braucht — Prefab → GLB-DATEI
 * (`MODELL_ALIAS`) und abgeleitetes Modul → STAMMMODUL (`rockVariant`).
 *
 * ── Warum ein eigenes Modul ──────────────────────────────────────────
 * Beide Zuordnungen werden an zwei Stellen gebraucht: vom Werkzeug
 * (`tools/asset-manifest.mjs --abgleich`) und von dem Test, der das
 * Werkzeug bewacht (`tools/test/manifest-zuordnung.ts`). Stuenden sie im
 * Werkzeug, muesste der Test sie nachbauen — und ein Test, der die
 * Zuordnung nachbaut, prueft nur noch sich selbst.
 *
 * ── Warum die eine gelesen und die andere importiert wird ────────────
 * `MODELL_ALIAS` steht in `client/src/engine/AssetManager.ts` und gehoert
 * dorthin: nur der Client oeffnet GLBs. Ein Import zoege Babylon in ein
 * Kommandozeilenwerkzeug. Also wird die Tabelle GELESEN — dieselbe
 * Entscheidung und derselbe Grund wie in `tools/modell-abgleich.ts`, das
 * seit F2 so verfaehrt.
 *
 * Die Kit-Ableitung dagegen ist reine Datenlogik in `shared/` und laesst
 * sich importieren. Sie WIRD importiert und nicht gelesen, weil eine
 * Regex ueber private Konstanten genau die Fragilitaet waere, die man
 * bei der Alias-Tabelle notgedrungen in Kauf nimmt.
 *
 * Erzeugt nichts, prueft nichts — reine Nachschlagefunktionen.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DUNGEONS_BY_NAME, KIT_DERIVATIONS } from '@wov/shared';

/** Wo die Alias-Tabelle steht — relativ zur Repo-Wurzel. */
export const ALIAS_QUELLE = 'client/src/engine/AssetManager.ts';

/**
 * `MODELL_ALIAS` aus dem Client mitlesen: Prefabname → Dateistamm der GLB,
 * die er wirklich laedt (`GrabhuegelGras` → `Grabhuegel`).
 *
 * Der Block wird bis zu einer schliessenden Klammer AM ZEILENANFANG
 * gelesen und nicht bis zur ersten ueberhaupt. Die Tabelle traegt zu
 * jedem Eintrag einen mehrzeiligen Kommentar; eine geschweifte Klammer
 * darin — heute in keinem, morgen vielleicht — schnitte die Tabelle
 * sonst still in der Mitte durch, und die fehlenden Eintraege faenden
 * sich als „Prefab ohne Datei" wieder.
 *
 * Wirft bei null Treffern. Ein Leser, der bei einer verschobenen Tabelle
 * eine leere Zuordnung zurueckgibt, macht aus einem Umbau lautlos einen
 * Bericht ohne Alias — und das ist genau der Zustand, den er beheben soll.
 */
export function readModelAlias(wurzel: string): Record<string, string> {
  const quelle = readFileSync(join(wurzel, ALIAS_QUELLE), 'utf8');
  // `\b` ist nicht Zierde: ohne die Wortgrenze traefe `MODELL_ALIAS` auch
  // ein `MODELL_ALIASE` — der Leser laese dann klaglos die falsche Tabelle.
  const block = /const MODELL_ALIAS\b[^{]*\{([\s\S]*?)\n\};/.exec(quelle)?.[1];
  if (block === undefined) {
    throw new Error(`MODELL_ALIAS nicht gefunden in ${ALIAS_QUELLE} — Tabelle verschoben oder umbenannt?`);
  }
  const tabelle: Record<string, string> = {};
  for (const m of block.matchAll(/^\s*(\w+)\s*:\s*'([^']+)'/gm)) tabelle[m[1]!] = m[2]!;
  if (Object.keys(tabelle).length === 0) {
    throw new Error(`MODELL_ALIAS in ${ALIAS_QUELLE} gefunden, aber ohne einen einzigen Eintrag gelesen.`);
  }
  return tabelle;
}

/** Ein abgeleitetes Modul und das Modul, aus dem es entstanden ist. */
export interface ModuleStem {
  readonly derived: string;
  readonly stem: string;
  readonly kit: string;
  readonly stemKit: string;
}

/**
 * Modul → Stammmodul, fuer jedes Kit aus `KIT_DERIVATIONS`
 * (`RockVaultWall` → `StoneVaultWall`, `RockVaultArch` → `StoneVaultArch`).
 *
 * ── Warum ueber die REIHENFOLGE und nicht ueber den Namensstamm ──────
 * `rockVariant()` bildet beide Listen mit `map` ab — Position i der
 * Ableitung entsteht aus Position i des Stamms. Das ist die Zuordnung
 * selbst, nicht ein Merkmal davon. Ein zweiter Namensstamm hier
 * (`'RockVault'` ersetzt durch `'StoneVault'`) waere eine Kopie der
 * privaten Konstanten in `eigeneDungeons.ts` und laege beim naechsten
 * Kit falsch, ohne dass irgendetwas bricht.
 *
 * Ungleiche Laengen sind deshalb ein Abbruch und keine Warnung: Bei
 * verschobenen Positionen zeigte jede folgende Zeile auf das falsche
 * Stammmodul — ein Bericht, der ueberzeugend aussieht und nicht stimmt.
 */
export function moduleStems(): Map<string, ModuleStem> {
  const aus = new Map<string, ModuleStem>();
  for (const { stem: stemKit, derived: kit } of KIT_DERIVATIONS) {
    const a = DUNGEONS_BY_NAME.get(stemKit);
    const b = DUNGEONS_BY_NAME.get(kit);
    if (!a || !b) throw new Error(`Kit '${a ? kit : stemKit}' fehlt in DUNGEONS_BY_NAME — Ableitung nicht nachvollziehbar.`);
    /*
      Die Ableitung darf MEHR Raeume haben als ihr Stamm, aber nie weniger:
      Seit dem 05.09.2026 haengt `rockVariant()` an die 1:1-Abbildung noch
      die Wandvarianten `RockVaultWallB`/`...C` an (Begruendung dort bei
      `FELS_WAND_VARIANTEN`). Sie stehen HINTER den abgebildeten Raeumen,
      die Positionszuordnung der ersten `a.rooms.length` bleibt also
      unberuehrt — und genau das prueft die Bedingung.

      Weniger Raeume sind weiter ein Abbruch und keine Warnung: Bei
      verschobenen Positionen zeigte jede folgende Zeile auf das falsche
      Stammmodul — ein Bericht, der ueberzeugend aussieht und nicht stimmt.
    */
    if (a.rooms.length > b.rooms.length) {
      throw new Error(`'${kit}' hat ${b.rooms.length} Raeume, '${stemKit}' ${a.rooms.length} — die Ableitung bildet mindestens 1:1 ab.`);
    }
    if (a.doorTypes.length !== b.doorTypes.length) {
      throw new Error(`'${kit}' hat ${b.doorTypes.length} Tuertypen, '${stemKit}' ${a.doorTypes.length} — die Ableitung bildet 1:1 ab.`);
    }
    for (let i = 0; i < a.rooms.length; i++) {
      aus.set(b.rooms[i]!.name, { derived: b.rooms[i]!.name, stem: a.rooms[i]!.name, kit, stemKit });
    }
    /*
      Die Zusatzraeume der Ableitung. Ihr Stammmodul ist der Abschluss des
      Stammkits — sie ENTSTEHEN aus dem abgeleiteten Abschluss, und der
      wiederum aus jenem. Ohne diese Zeilen faenden `asset-manifest --abgleich`
      und der Groessenbericht sie als Module ohne Stamm und listeten jede
      Abweichung des Wandpaneels dreimal statt einmal — genau die Doppelung,
      gegen die diese Tabelle gebaut ist.
    */
    const stammAbschluss = a.rooms.find((r) => r.endCap);
    for (let i = a.rooms.length; i < b.rooms.length; i++) {
      const d = b.rooms[i]!.name;
      if (!stammAbschluss) throw new Error(`'${kit}' hat Zusatzraeume, '${stemKit}' aber keinen Abschluss — Stamm von '${d}' unbekannt.`);
      aus.set(d, { derived: d, stem: stammAbschluss.name, kit, stemKit });
    }
    for (let i = 0; i < a.doorTypes.length; i++) {
      const d = b.doorTypes[i]!.prefabName;
      aus.set(d, { derived: d, stem: a.doorTypes[i]!.prefabName, kit, stemKit });
    }
  }
  return aus;
}
