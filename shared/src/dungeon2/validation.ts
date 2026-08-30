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
  TREPPE_KOPFRAUM_STUFEN,
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
  BODEN_DICKE_STUFEN,
  DECKE_DICKE_STUFEN,
  bodenStufen,
  erreichbareZellen,
  obenStufen,
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
  //
  // NICHT `zelle.decke`, sondern die WIRKLICHE lichte Saeule. Zwei Gruende,
  // beide am 2026-08-30 gemessen:
  //
  // (a) Steht ein `Schacht` ueber der Zelle, laesst `hatDeckenPlatte()` die
  //     Decke weg und die Saeule laeuft durch bis zur Decke des Schachts. Das
  //     rohe Feld `decke` ist dort nicht die Hoehe des Raums, sondern nur die
  //     Zahl, mit der der Stempel gesetzt wurde. Ein Treppenlauf, der oben in
  //     eine Muendung austritt, MUSS `decke` an der Ebenensohle enden lassen
  //     (sonst steht die Muendungswand in seiner Saeule) — mit dem rohen Feld
  //     waere er damit gleichzeitig „zu niedrig".
  // (b) Bei einer TREPPE ist `boden` die Hoehe an der TIEFEN Kante. Die Regel
  //     mass damit den Kopfraum am Fuss des Laufs, nie ueber seiner obersten
  //     Stufe — und genau dort ist er knapp. Gemessen: ein Raum, der ueber
  //     einem Lauf wuchs, liess ihm 1,5 m; die Regel blieb stumm, die
  //     Spielerkapsel (1,8 m) kam nicht durch.
  // NOT `zelle.decke` but the REAL clear column. (a) With a `Schacht` above, the
  // ceiling slab is omitted and the column runs on up to the shaft's ceiling.
  // (b) On a stair `boden` is the height at the LOW edge, so the rule measured
  // the headroom at the run's foot, never over its topmost step — which is
  // exactly where it is tight. Measured: a room grown above a run left it 1.5 m
  // and the rule stayed silent; the player capsule (1.8 m) did not fit.
  for (const zelle of zellenSortiert(gitter)) {
    if (!offen(zelle.art)) continue;
    const deckeAbsolut = saeuleDurchSchaechte(gitter, zelle);
    const lichte = deckeAbsolut - bodenStufen(zelle);
    if (lichte < MIN_LICHTE_STUFEN) {
      melde(
        `Zelle (${zelle.x},${zelle.z},E${zelle.ebene})`,
        'fehler',
        'lichte-hoehe',
        `lichte Saeule ${lichte} liegt unter MIN_LICHTE_STUFEN (${MIN_LICHTE_STUFEN})`
      );
    }
    if (zelle.art !== ZELLEN_ART.Treppe) continue;
    const kopf = deckeAbsolut - treppenOberkante(gitter, zelle);
    if (kopf < TREPPE_KOPFRAUM_STUFEN) {
      melde(
        `Treppe (${zelle.x},${zelle.z},E${zelle.ebene})`,
        'fehler',
        'lichte-hoehe',
        `Kopfraum ueber der obersten Stufe ${kopf} liegt unter TREPPE_KOPFRAUM_STUFEN (${TREPPE_KOPFRAUM_STUFEN})`
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
    // Zwei Platten koennen sich nur durchdringen, wenn es beide gibt. Ist eine
    // der beiden Zellen Fels, baut der Bauer dort nichts (`baueZelle` steigt bei
    // `!offen(art)` sofort aus) — dann gibt es nichts zu trennen.
    // Two slabs can only intersect if both exist. If either cell is rock the
    // builder builds nothing there (`baueZelle` returns on `!offen(art)`).
    if (!offen(zelle.art) || !offen(oben.art)) continue;
    // Ein `Schacht` unmittelbar ueber einer offenen Zelle IST die senkrechte
    // Oeffnung: `hatBodenPlatte()`/`hatDeckenPlatte()` (cells.ts) lassen dort
    // beide Platten weg und `obenStufen()` zieht die eine lichte Saeule bis zur
    // Schachtsohle durch. Es gibt also gar keine zwei Platten, die sich
    // durchdringen koennten — die Regel prueft hier ein Bauteil, das der Bauer
    // nie baut, und verbietet damit genau den Aufgang, fuer den es den Schacht
    // gibt.
    // A `Schacht` directly above an open cell IS the vertical opening:
    // `hatBodenPlatte()`/`hatDeckenPlatte()` (cells.ts) omit both slabs there
    // and `obenStufen()` runs the single clear column up to the shaft's sole.
    // There are no two slabs that could intersect — the rule would be checking
    // a part the builder never builds, and would forbid exactly the ascent the
    // shaft exists for.
    if (oben.art === ZELLEN_ART.Schacht) continue;
    // KANTEN DER PLATTEN, nicht Kanten des Luftraums.
    //
    // Bis zum 2026-08-30 stand hier `boden + decke` gegen `boden` der Zelle
    // darueber — also die Decken-UNTERkante gegen die Boden-OBERkante. Beide
    // Male die falsche Flaeche, und beide Fehler zeigen in dieselbe Richtung:
    // Die Regel liess `DECKE_DICKE_STUFEN + BODEN_DICKE_STUFEN` = 4 Stufen
    // (2 m) Ueberdeckung durchgehen, die der Regeltext (`ARCHITECTURE.md` §3.7:
    // "Deckenoberkante unten < Bodenunterkante oben") ausdruecklich verbietet.
    // Gemessen ueber 60 Seeds waren 86 von 783 gestapelten Zellpaaren betroffen;
    // sichtbar wurde es nicht als Loch, sondern an der Deckenplatte:
    // `deckenOberkante()` im Bauer stutzt sie stillschweigend auf die Sohle
    // darueber, und so entstanden 52 Deckenplatten der Dicke NULL und 34 der
    // halben Dicke — Nullkoerper, die als Sichtgeometrie UND als Havok-Box in
    // den Bau gingen. Bei `hoehe = 15` unter einer belegten Zelle waere die
    // gestutzte Platte sogar negativ dick geworden.
    // EDGES OF THE SLABS, not edges of the air space. Until 2026-08-30 this
    // compared the ceiling UNDERSIDE against the floor TOPSIDE — the wrong
    // surface twice, and both errors point the same way: the rule let
    // `DECKE_DICKE_STUFEN + BODEN_DICKE_STUFEN` = 4 steps (2 m) of overlap pass
    // that the rule's own text forbids. Measured over 60 seeds, 86 of 783
    // stacked cell pairs were affected; the symptom was not a hole but the
    // ceiling slab: the builder's `deckenOberkante()` silently trims it to the
    // sole above, producing 52 ceiling slabs of thickness ZERO and 34 of half
    // thickness — degenerate bodies that went into the build as visual geometry
    // AND as a Havok box.
    const deckenOberkanteUnten = obenStufen(gitter, zelle) + DECKE_DICKE_STUFEN;
    const bodenUnterkanteOben = bodenStufen(oben) - BODEN_DICKE_STUFEN;
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
    // Das obere Ende ist zweierlei: die Nachbarzelle in Neigungsrichtung auf
    // DERSELBEN Ebene (Hoehensprung im Stockwerk) ODER die Schachtmuendung
    // direkt darueber (letzter Lauf eines Aufgangs — der Lauf tritt nach oben
    // aus, nicht zur Seite). Ohne den zweiten Fall waere ein Aufgang zwischen
    // zwei Ebenen im eingefrorenen Format nicht ausdrueckbar; siehe
    // `design/decisions-log.md`, Eintrag "Treppen waren tote Zweige".
    // The upper end is two things: the neighbour in the ascent direction on the
    // SAME storey (height jump within a storey) OR the shaft mouth directly
    // above (last run of a staircase — the run emerges upwards, not sideways).
    // Without the second case a storey-linking staircase would be inexpressible
    // in the frozen format.
    const muendung = zelleImGitter(gitter, zelle.x, zelle.z, zelle.ebene + 1);
    const obenBegehbar =
      nachbarBegehbar(gitter, zelle, zelle.neigung) ||
      (muendung !== undefined && muendung.art === ZELLEN_ART.Schacht);
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

/**
 * Oberkante der lichten Saeule einer Zelle, durch gestapelte `Schacht`-Zellen
 * hindurch. Ein Schacht ueber einer offenen Zelle IST die senkrechte Oeffnung —
 * beide Platten fehlen dort, die Saeule ist EINE, und wer sie an der Zellgrenze
 * abschneidet, misst einen Raum, den es nicht gibt.
 * Top of a cell's clear column, through stacked `Schacht` cells. A shaft above
 * an open cell IS the vertical opening — both slabs are missing there, the
 * column is ONE, and cutting it at the cell border measures a room that does not
 * exist.
 */
function saeuleDurchSchaechte(gitter: ZellenGitter, zelle: Zelle): number {
  let aktuell = zelle;
  let oben = obenStufen(gitter, aktuell);
  // Die Schleife ist beschraenkt: jeder Schritt geht eine Ebene hoeher, und das
  // Gitter hat endlich viele. / Bounded: each step goes one storey up.
  for (;;) {
    const drueber = zelleImGitter(gitter, aktuell.x, aktuell.z, aktuell.ebene + 1);
    if (drueber === undefined || drueber.art !== ZELLEN_ART.Schacht) return oben;
    aktuell = drueber;
    oben = obenStufen(gitter, aktuell);
  }
}

/**
 * Hoehe der OBERSTEN Stufe eines Treppenlaufs. Sie steht nicht im Format: das
 * Ziel liegt in der Nachbarzelle in Neigungsrichtung (Hoehensprung im
 * Stockwerk) oder in der Schachtmuendung darueber (letzter Lauf eines
 * Aufgangs) — dieselbe Fallunterscheidung wie `anstiegStufen()` im Bauer.
 * Height of the TOPMOST step of a stair run. It is not in the format: the target
 * sits in the neighbour cell along the ascent, or in the shaft mouth above.
 */
function treppenOberkante(gitter: ZellenGitter, zelle: Zelle): number {
  const unten = bodenStufen(zelle);
  if (zelle.neigung === undefined || !istGueltigeKante(zelle.neigung)) return unten;
  const p = nachbarZelle(zelle.x, zelle.z, zelle.neigung);
  const seitlich = zelleImGitter(gitter, p.x, p.z, zelle.ebene);
  if (seitlich !== undefined && offen(seitlich.art) && bodenStufen(seitlich) > unten) {
    return bodenStufen(seitlich);
  }
  const muendung = zelleImGitter(gitter, zelle.x, zelle.z, zelle.ebene + 1);
  if (muendung !== undefined && muendung.art === ZELLEN_ART.Schacht) return bodenStufen(muendung);
  return unten;
}
