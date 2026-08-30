/**
 * Invarianten des Dungeon-Generators 2.0, die ERST mit dem ausgerollten
 * Zellgitter entscheidbar sind (AP2). Die dokumentbasierten Invarianten
 * (Ganzzahligkeit, Kantenbits, `materialTag`, Pruefsumme, ...) stehen in
 * `layout.ts` (`validateLayout`, AP1) — dieses Modul RUFT sie auf und
 * ERGAENZT ihre Befunde, ersetzt sie nie.
 * Invariants of dungeon generator 2.0 that are decidable only with the rolled
 * out cell grid (AP2). Document-level invariants (integer fields, edge bits,
 * `materialTag`, checksum, ...) live in `layout.ts` (`validateLayout`, AP1) —
 * this module CALLS them and APPENDS its own findings, never replacing them.
 *
 * Quelle: `design/ARCHITECTURE.md` §3.7 (Tabellenzeilen ohne "AP2"-Klammer
 * sind bereits in `layout.ts` geprueft), vertieft in `design/data-model.md`
 * §1.10. Die acht hier geprueften Regelnamen sind bereits in `layout.ts`
 * (`LayoutRegel`) reserviert — ein Regelname lebt an genau einem Ort.
 * Source: `design/ARCHITECTURE.md` §3.7 (table rows without an "AP2" note are
 * already checked in `layout.ts`), detailed in `design/data-model.md` §1.10.
 * The eight rule names checked here are already reserved in `layout.ts`
 * (`LayoutRegel`) — a rule name lives in exactly one place.
 *
 * Dieses Modul ist rein: kein Babylon, kein DOM, kein `node:`, kein
 * `Math.random`, keine Uhr, keine Trigonometrie.
 * This module is pure: no Babylon, no DOM, no `node:`, no `Math.random`,
 * no clock, no trigonometry.
 */

import {
  ANKER_ORT,
  KANTE,
  MIN_LICHTE_STUFEN,
  ZELLEN_ART,
  gegenKante,
  nachbarZelle,
  validateLayout,
  type Befund,
  type DungeonLayout2,
  type LayoutRegel,
  type Schwere,
  type Zelle,
} from './layout.js';
import {
  EBENE_IN_HOEHEN_SCHRITTEN,
  erreichbareZellen,
  istGueltigeKante,
  nachbarBegehbar,
  offen,
  schluesselZelle,
  zelleImGitter,
  zelleOderLeer,
  zellenAufbauen,
  zellenSortiert,
  wandZwischen,
  type AufbauOptionen,
  type ZellenGitter,
} from './cells.js';

/**
 * Prueft die acht gitterabhaengigen Invarianten aus `layout.ts`s `LayoutRegel`
 * ("erst mit dem Zellgitter pruefbar"): `erreichbar`, `lichte-hoehe`,
 * `doppelbelegung`, `ebenen-abstand`, `treppe-anschluss`, `tuer-im-fels`,
 * `anker-in-luft`, `rueckgrat`.
 * Checks the eight grid-dependent invariants from `layout.ts`'s `LayoutRegel`
 * ("needs the cell grid"): `erreichbar`, `lichte-hoehe`, `doppelbelegung`,
 * `ebenen-abstand`, `treppe-anschluss`, `tuer-im-fels`, `anker-in-luft`,
 * `rueckgrat`.
 */
export function validateZellgitter(layout: DungeonLayout2, gitter: ZellenGitter): Befund[] {
  const befunde: Befund[] = [];
  const melde = (wo: string, schwere: Schwere, regel: LayoutRegel, text: string): void => {
    befunde.push({ wo, schwere, regel, text });
  };

  // ── erreichbar ─────────────────────────────────────────────────────────
  const eingangZelle = zelleImGitter(gitter, layout.eingang.x, layout.eingang.z, layout.eingang.ebene);
  let erreichbar: ReadonlySet<string> = new Set();
  if (eingangZelle === undefined || !offen(eingangZelle.art)) {
    melde(
      'Eingang',
      'fehler',
      'erreichbar',
      `Eingangszelle (${layout.eingang.x},${layout.eingang.z},E${layout.eingang.ebene}) existiert nicht oder ist nicht begehbar`
    );
  } else {
    erreichbar = erreichbareZellen(gitter, layout.eingang);
    for (const zelle of zellenSortiert(gitter)) {
      if (!offen(zelle.art)) continue;
      const schluessel = schluesselZelle(zelle.x, zelle.z, zelle.ebene);
      if (!erreichbar.has(schluessel)) {
        melde(
          `Zelle (${zelle.x},${zelle.z},E${zelle.ebene})`,
          'fehler',
          'erreichbar',
          'vom Eingang aus nicht erreichbar (Flutfuellung erreicht sie nicht)'
        );
      }
    }
  }

  // ── lichte-hoehe ───────────────────────────────────────────────────────
  for (const zelle of zellenSortiert(gitter)) {
    if (!offen(zelle.art)) continue;
    if (zelle.decke < MIN_LICHTE_STUFEN) {
      melde(
        `Zelle (${zelle.x},${zelle.z},E${zelle.ebene})`,
        'fehler',
        'lichte-hoehe',
        `decke ${zelle.decke} liegt unter MIN_LICHTE_STUFEN (${MIN_LICHTE_STUFEN})`
      );
    }
  }

  // ── doppelbelegung ─────────────────────────────────────────────────────
  // Strukturell durch den Map-Schluessel (x,z,ebene) ausgeschlossen — diese
  // Schleife ist eine defensive Zweitpruefung, kein aktiver Fangmechanismus.
  // Structurally excluded by the map key (x,z,ebene) — this loop is a
  // defensive second check, not an active catch mechanism.
  const gesehen = new Set<string>();
  for (const zelle of zellenSortiert(gitter)) {
    const schluessel = schluesselZelle(zelle.x, zelle.z, zelle.ebene);
    if (gesehen.has(schluessel)) {
      melde(
        `Zelle (${zelle.x},${zelle.z},E${zelle.ebene})`,
        'fehler',
        'doppelbelegung',
        'Position kommt im Gitter mehrfach vor'
      );
    }
    gesehen.add(schluessel);
  }

  // ── ebenen-abstand ─────────────────────────────────────────────────────
  for (const zelle of zellenSortiert(gitter)) {
    const oben = zelleImGitter(gitter, zelle.x, zelle.z, zelle.ebene + 1);
    if (oben === undefined) continue;
    const deckenOberkanteUnten = zelle.ebene * EBENE_IN_HOEHEN_SCHRITTEN + zelle.boden + zelle.decke;
    const bodenUnterkanteOben = oben.ebene * EBENE_IN_HOEHEN_SCHRITTEN + oben.boden;
    if (!(deckenOberkanteUnten < bodenUnterkanteOben)) {
      melde(
        `Zelle (${zelle.x},${zelle.z},E${zelle.ebene}/E${oben.ebene})`,
        'fehler',
        'ebenen-abstand',
        `Deckenoberkante (${deckenOberkanteUnten}) liegt nicht unter der Bodenunterkante der Ebene darueber (${bodenUnterkanteOben})`
      );
    }
  }

  // ── treppe-anschluss ───────────────────────────────────────────────────
  for (const zelle of zellenSortiert(gitter)) {
    if (zelle.art !== ZELLEN_ART.Treppe) continue;
    const wo = `Treppe (${zelle.x},${zelle.z},E${zelle.ebene})`;
    if (zelle.neigung === undefined || !istGueltigeKante(zelle.neigung)) {
      melde(wo, 'fehler', 'treppe-anschluss', 'neigung fehlt oder ist kein einzelnes Kantenbit');
      continue;
    }
    const obenBegehbar = nachbarBegehbar(gitter, zelle, zelle.neigung);
    const untenBegehbar = nachbarBegehbar(gitter, zelle, gegenKante(zelle.neigung));
    if (!obenBegehbar || !untenBegehbar) {
      melde(wo, 'fehler', 'treppe-anschluss', 'Treppe hat nicht an beiden Enden eine begehbare Nachbarzelle');
    }
  }

  // ── tuer-im-fels ───────────────────────────────────────────────────────
  layout.tueren.forEach((tuer, i) => {
    const wo = `Tuer [${i}] (${tuer.x},${tuer.z},E${tuer.ebene})`;
    const a = zelleImGitter(gitter, tuer.x, tuer.z, tuer.ebene);
    if (!istGueltigeKante(tuer.kante)) return; // bereits von layout.ts (`kante-bit`) gemeldet
    const nb = nachbarZelle(tuer.x, tuer.z, tuer.kante);
    const b = zelleImGitter(gitter, nb.x, nb.z, tuer.ebene);
    const aOffen = a !== undefined && offen(a.art);
    const bOffen = b !== undefined && offen(b.art);
    if (!aOffen || !bOffen) {
      melde(wo, 'fehler', 'tuer-im-fels', 'mindestens eine der beiden Kanten-Zellen ist nicht begehbar');
    }
  });

  // ── anker-in-luft ──────────────────────────────────────────────────────
  layout.anker.forEach((anker, i) => {
    const wo = `Anker #${anker.id} [${i}] (${anker.x},${anker.z},E${anker.ebene})`;
    const zelle = zelleImGitter(gitter, anker.x, anker.z, anker.ebene);
    if (zelle === undefined || !offen(zelle.art)) {
      melde(wo, 'fehler', 'anker-in-luft', 'Anker steht in keiner begehbaren Zelle');
      return;
    }
    if (anker.ort === ANKER_ORT.Wand && anker.kante !== undefined && istGueltigeKante(anker.kante)) {
      const p = nachbarZelle(zelle.x, zelle.z, anker.kante);
      const nachbar = zelleOderLeer(gitter, p.x, p.z, zelle.ebene);
      if (!wandZwischen(zelle, nachbar)) {
        melde(wo, 'fehler', 'anker-in-luft', 'Wandanker sitzt an einer Kante ohne Wand');
      }
    }
  });

  // ── rueckgrat ──────────────────────────────────────────────────────────
  // WoCs Mittelgang-Invariante (`rift_gen.ts:56`, ARCHITECTURE §3.7 letzte
  // Zeile): ein garantiertes Rueckgrat vom Eingang zum tiefsten Pflichtraum.
  // WoC's spine invariant (`rift_gen.ts:56`, ARCHITECTURE §3.7 last row): a
  // guaranteed backbone from the entrance to the deepest mandatory room.
  //
  // ENTSCHEIDUNG (siehe `design/decisions-log.md` AP2-3): Das eingefrorene
  // Format kennzeichnet keinen "Pflichtraum" — es gibt nur `tiefeImBaum`.
  // AP2 prueft deshalb die notwendige Bedingung, die OHNE Generator entscheidbar
  // ist: der Stempel mit der groessten `tiefeImBaum` (Tiebreak: kleinste `id`)
  // hat mindestens eine Zelle, die vom Eingang aus erreichbar ist. Die
  // staerkere Zusage ("kein Stempel darf dieses Rueckgrat ueberschreiben")
  // ist eine Erzeugungsregel und gehoert in `generator.ts` (AP4).
  // DECISION (see `design/decisions-log.md` AP2-3): the frozen format marks no
  // "mandatory room" — only `tiefeImBaum` exists. AP2 therefore checks the
  // necessary condition decidable WITHOUT a generator: the stamp with the
  // largest `tiefeImBaum` (tiebreak: smallest `id`) has at least one cell
  // reachable from the entrance. The stronger guarantee ("no stamp may
  // overwrite this backbone") is a generation-time rule and belongs in
  // `generator.ts` (AP4).
  if (layout.stempel.length > 0 && eingangZelle !== undefined && offen(eingangZelle.art)) {
    const tiefster = [...layout.stempel].sort(
      (a, b) => b.tiefeImBaum - a.tiefeImBaum || a.id - b.id
    )[0]!;
    const zellenDesStempels = zellenSortiert(gitter).filter((z) => z.stempelId === tiefster.id);
    const wo = `Rueckgrat (Stempel #${tiefster.id})`;
    if (zellenDesStempels.length === 0) {
      melde(
        wo,
        'fehler',
        'rueckgrat',
        `tiefster Stempel #${tiefster.id} hat keine Zelle mehr im Gitter (vollstaendig ueberschrieben)`
      );
    } else if (!zellenDesStempels.some((z: Zelle) => erreichbar.has(schluesselZelle(z.x, z.z, z.ebene)))) {
      melde(
        wo,
        'fehler',
        'rueckgrat',
        `tiefster Stempel #${tiefster.id} ist vom Eingang aus nicht erreichbar`
      );
    }
  }

  return befunde;
}

/**
 * Vollstaendige Pruefung: Dokument-Invarianten (`layout.ts`) plus
 * Zellgitter-Invarianten (dieses Modul). Baut das Gitter selbst auf — Editor,
 * Generator und Server rufen im Regelfall diese Funktion, nicht die beiden
 * Teile einzeln.
 * Full check: document invariants (`layout.ts`) plus cell-grid invariants
 * (this module). Builds the grid itself — editor, generator and server
 * normally call this function, not the two parts separately.
 */
export function validateLayoutVoll(
  layout: DungeonLayout2,
  optionen?: AufbauOptionen
): Befund[] {
  const dokumentBefunde = validateLayout(layout);
  const gitter = zellenAufbauen(layout, optionen);
  return [...dokumentBefunde, ...validateZellgitter(layout, gitter)];
}
