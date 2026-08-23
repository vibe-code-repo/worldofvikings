/**
 * KuratierungsAuswahl (Roadmap B3) — durchsuchbare Mehrfachauswahl für
 * eine Kuratierungsliste (`RegionDef.vegetation` / `.locations` /
 * `.spawns`), als Ersatz für das Freitextfeld, in das bisher niemand
 * 102 Artennamen auswendig eintippt (siehe Kopfkommentar von
 * `kuratierungsKatalog.ts` — genau 0 von 17 Regionen der DEV-Welt nutzen
 * die Kuratierung sinnvoll über Locations/Spawns; eine Region trägt dort
 * sogar zwei Biomnamen statt echter Location-Namen, weil das Freitextfeld
 * niemandem zeigte, was gültig gewesen wäre).
 *
 * ── Warum eine eigene Datei ────────────────────────────────────────────
 * Der natürliche Ort für diesen Ersatz wäre `KartenHud.ts` selbst — dort
 * lebt die private Methode `kuratierung()`, die bisher das Freitextfeld
 * zeichnet, aufgerufen aus `reiterBiome()`. Diese Datei bleibt dort
 * ABSICHTLICH unangetastet (Datei eines anderen, laufenden Arbeitsstands,
 * siehe Laufnotiz). Was hier steht, ist deshalb ein vollständiger,
 * eigenständiger Ersatz mit DEMSELBEN Aufruf-Vertrag wie die bisherige
 * `kuratierung()` — dieselben drei Parameter (Titel, aktueller Wert,
 * Setter), derselbe Rückgabetyp (ein `HTMLDivElement`) — damit das
 * Einhängen später eine Ein-Zeilen-Änderung ist:
 *
 *   this.kuratierung('Vegetation', r.vegetation, setz)
 *   →
 *   baueKuratierungsAuswahl('vegetation', 'Vegetation', r.vegetation, setz)
 *
 * für jede der drei Kuratierungslisten in `reiterBiome()`.
 *
 * ── Warum eine lokale Kopie von `wert` ─────────────────────────────────
 * `KartenHud.setzeEntwurf()` (der bisherige Aufrufer von `setz`) puffert
 * nur einen Entwurf und löst KEIN sofortiges Neuzeichnen der ganzen
 * Eigenschaftskarte aus (anders als `layout`-Änderungen, die über
 * `editorMain.ts` ein volles `alles()` durchlaufen). Verliesse sich
 * dieses Widget beim zweiten Klick auf den beim ERSTEN Aufbau übergebenen
 * `wert`, würde ein zweites Hinzufügen/Entfernen in derselben
 * Bildschirmsitzung auf einem veralteten Stand aufsetzen. Deshalb hält
 * `baueKuratierungsAuswahl` eine eigene veränderliche Kopie und zeichnet
 * Kopf-Marken, gewählte Liste und Katalogliste nach JEDER Änderung lokal
 * neu — unabhängig davon, ob und wann der Aufrufer seinerseits neu baut.
 * Der Suchtext lebt ebenfalls nur lokal: Tippen ruft `setz` nie auf.
 */
import {
  katalog,
  geordneteAuswahl,
  filtereKatalog,
  eintragHinzufuegen,
  eintragEntfernenAnIndex,
  type KuratierungsArt,
} from './kuratierungsKatalog';
import { el, stil, F, M, SCHRIFT, luecke, marke, beiUeberfahren, beschriftungStil, sinnbild, lupenBild, PFAD } from './design';

/** Klartext je Art — für die leere-Katalog-Meldung, den Suchplatzhalter
 *  und den "bewusst leer"-Hinweis. */
const BEZEICHNUNG: Record<KuratierungsArt, { mehrzahl: string; leerSatz: string }> = {
  vegetation: { mehrzahl: 'Arten', leerSatz: 'hier wächst nichts' },
  locations: { mehrzahl: 'Locations', leerSatz: 'hier entsteht nichts' },
  spawns: { mehrzahl: 'Kreaturen', leerSatz: 'hier erscheint nichts' },
};

function tagZeile(einordnung: readonly string[], farbe: string): HTMLSpanElement | null {
  if (einordnung.length === 0) return null;
  return el(
    'span',
    stil({ 'font-size': '10px', color: farbe, 'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis' }),
    einordnung.join(' · ')
  );
}

/**
 * Baut die Kuratierungsauswahl. `art` bestimmt den Katalog
 * (FOLIAGE/FEATURES/SPAWN_TABLE), `titel`/`wert`/`setz` entsprechen
 * exakt der bisherigen `kuratierung()`-Signatur in `KartenHud.ts`.
 */
export function baueKuratierungsAuswahl(
  art: KuratierungsArt,
  titel: string,
  wert: readonly string[] | undefined,
  setz: (v: readonly string[] | undefined) => void
): HTMLDivElement {
  const bez = BEZEICHNUNG[art];
  const eintraege = katalog(art);

  // Lokale, veränderliche Kopie — Begründung siehe Dateikopf.
  let aktuell = wert;

  const wurzel = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '5px' }));

  // ── Kopf: Titel + die zwei Zustandsmarken ─────────────────────────
  // Wortgleich mit der bisherigen Bedeutung: "Standard" entfernt das
  // Feld (Biom-Standardtabelle gilt), "keine" setzt ein LEERES Array
  // (ausdrücklich nichts) — ein Zustand, den ein leeres Textfeld nie von
  // "Standard" unterscheiden konnte.
  const kopf = el('div', stil({ display: 'flex', 'align-items': 'center', gap: '5px' }));
  kopf.appendChild(el('span', beschriftungStil(), titel));
  kopf.appendChild(luecke());
  wurzel.appendChild(kopf);

  const gewaehlteListe = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '3px' }));
  wurzel.appendChild(gewaehlteListe);

  // Katalogliste + Suchfeld werden weiter unten befüllt (nur wenn der
  // Katalog überhaupt Einträge hat); vorab deklariert, weil `uebernehmen`
  // und `zeichneKatalog` sich gegenseitig brauchen.
  let sucheEingabe: HTMLInputElement | null = null;
  let katalogListe: HTMLDivElement | null = null;

  /** Nach jeder Änderung: Aufrufer benachrichtigen, dann alles lokal neu zeichnen. */
  const uebernehmen = (neu: readonly string[] | undefined): void => {
    aktuell = neu;
    setz(neu);
    zeichneKopf();
    zeichneGewaehlte();
    zeichneKatalog();
  };

  const zeichneKopf = (): void => {
    kopf.querySelectorAll('[data-marke]').forEach((n) => n.remove());
    const mStandard = marke('Standard', aktuell === undefined, () => uebernehmen(undefined));
    const mKeine = marke('keine', aktuell !== undefined && aktuell.length === 0, () => uebernehmen([]));
    mStandard.dataset.marke = '';
    mKeine.dataset.marke = '';
    kopf.append(mStandard, mKeine);
  };

  // ── Gewählte Einträge, IN DER GESPEICHERTEN REIHENFOLGE ───────────
  const zeichneGewaehlte = (): void => {
    gewaehlteListe.replaceChildren();
    const geordnet = geordneteAuswahl(aktuell, eintraege);
    if (geordnet.length === 0) {
      const hinweis = aktuell === undefined ? 'Biom-Standard — keine eigene Auswahl.' : `Bewusst leer — ${bez.leerSatz}.`;
      gewaehlteListe.appendChild(el('div', stil({ 'font-size': '11px', color: F.gedimmt2, padding: '2px 1px' }), hinweis));
      return;
    }
    geordnet.forEach((e, index) => {
      const zeile = el(
        'div',
        stil({
          display: 'flex',
          'align-items': 'center',
          gap: '7px',
          padding: '4px 8px',
          background: F.feld,
          border: `1px solid ${e.bekannt ? F.randFeld : F.fehler}`,
          'border-radius': `${M.radiusFeld}px`,
        })
      );
      const beschriftungSpalte = el(
        'div',
        stil({ display: 'flex', 'flex-direction': 'column', flex: '1', 'min-width': '0' })
      );
      beschriftungSpalte.appendChild(
        el(
          'span',
          stil({
            'font-size': '11.5px',
            color: e.bekannt ? F.textRuhig : F.fehler,
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
            'white-space': 'nowrap',
          }),
          e.name
        )
      );
      const tag = tagZeile(
        e.bekannt ? e.einordnung : ['unbekannt — kein Eintrag mit diesem Namen im Katalog'],
        e.bekannt ? F.gedimmt2 : F.fehler
      );
      if (tag) beschriftungSpalte.appendChild(tag);
      zeile.appendChild(beschriftungSpalte);

      const entfernen = el(
        'button',
        stil({
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          width: '20px',
          height: '20px',
          flex: 'none',
          background: 'transparent',
          border: 'none',
          color: F.gedimmt2,
          cursor: 'pointer',
        })
      );
      entfernen.title = `${e.name} entfernen`;
      entfernen.appendChild(sinnbild(PFAD.kreuz, 11, 2));
      beiUeberfahren(entfernen, { color: F.fehler });
      entfernen.onclick = () => uebernehmen(eintragEntfernenAnIndex(aktuell, index));
      zeile.appendChild(entfernen);

      gewaehlteListe.appendChild(zeile);
    });
  };

  // ── Katalogliste (was noch nicht gewählt ist, nach Suchtext gefiltert) ──
  const zeichneKatalog = (): void => {
    if (!katalogListe) return;
    katalogListe.replaceChildren();
    const gewaehlteNamen = new Set(aktuell ?? []);
    const suchtext = sucheEingabe?.value ?? '';
    const gefiltert = filtereKatalog(eintraege, suchtext).filter((e) => !gewaehlteNamen.has(e.name));
    if (gefiltert.length === 0) {
      katalogListe.appendChild(
        el(
          'div',
          stil({ 'font-size': '10.5px', color: F.gedimmt3, padding: '4px 1px' }),
          suchtext.trim() ? `Nichts gefunden zu „${suchtext.trim()}".` : 'Alles bereits gewählt.'
        )
      );
      return;
    }
    for (const e of gefiltert) {
      const zeile = el(
        'button',
        stil({
          display: 'flex',
          'align-items': 'center',
          gap: '7px',
          padding: '4px 8px',
          background: 'transparent',
          border: '1px solid transparent',
          'border-radius': `${M.radiusFeld}px`,
          'text-align': 'left',
          cursor: 'pointer',
        })
      );
      const spalte = el('div', stil({ display: 'flex', 'flex-direction': 'column', flex: '1', 'min-width': '0' }));
      spalte.appendChild(
        el(
          'span',
          stil({
            'font-size': '11.5px',
            color: F.textRuhig,
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
            'white-space': 'nowrap',
          }),
          e.name
        )
      );
      const tag = tagZeile(e.einordnung, F.gedimmt2);
      if (tag) spalte.appendChild(tag);
      zeile.appendChild(spalte);
      const plus = sinnbild(PFAD.plus, 12, 2);
      plus.style.color = F.gedimmt2;
      zeile.appendChild(plus);
      beiUeberfahren(zeile, { background: F.erhoben, 'border-color': F.randFeld });
      zeile.onclick = () => uebernehmen(eintragHinzufuegen(aktuell, e.name));
      katalogListe.appendChild(zeile);
    }
  };

  zeichneKopf();
  zeichneGewaehlte();

  // ── Katalog leer? Dann keine Suche zeichnen — es gäbe nichts zu finden ──
  // Heute der Fall für Locations und Spawns (siehe Kopfkommentar): kein
  // eigenes Bauwerk, kein eigenes Kreaturmodell ist lauffähig. Wer trotzdem
  // schon Namen eingetragen hat (Alteintrag), sieht sie oben weiterhin —
  // nur eben ausnahmslos als unbekannt markiert, dank `zeichneGewaehlte()`
  // oben, die unabhängig vom Katalogzustand läuft.
  if (eintraege.length === 0) {
    wurzel.appendChild(
      el(
        'div',
        stil({ 'font-size': '10.5px', color: F.gedimmt3, 'font-style': 'italic', padding: '1px' }),
        `Noch keine eigenen ${bez.mehrzahl} verfügbar.`
      )
    );
    return wurzel;
  }

  // ── Suchfeld ───────────────────────────────────────────────────────
  // Bewusst kein `feld()` aus design.ts: das reagiert auf `onchange`
  // (Verlassen des Felds), eine Katalogsuche muss aber bei JEDEM
  // Tastendruck filtern. Optik trotzdem gleich gehalten.
  const sucheHuelle = el(
    'div',
    stil({
      display: 'flex',
      'align-items': 'center',
      gap: '6px',
      height: '30px',
      padding: '0 9px',
      background: F.feld,
      border: `1px solid ${F.randFeld}`,
      'border-radius': `${M.radiusKlein}px`,
    })
  );
  const lupe = lupenBild(12);
  lupe.style.color = F.gedimmt3;
  sucheEingabe = el(
    'input',
    stil({
      flex: '1',
      'min-width': '0',
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: F.text,
      'font-family': SCHRIFT.text,
      'font-size': '11.5px',
    })
  ) as HTMLInputElement;
  sucheEingabe.placeholder = `${bez.mehrzahl} durchsuchen … (${eintraege.length})`;
  sucheHuelle.append(lupe, sucheEingabe);
  wurzel.appendChild(sucheHuelle);

  katalogListe = el(
    'div',
    stil({ display: 'flex', 'flex-direction': 'column', gap: '2px', 'max-height': '160px', 'overflow-y': 'auto' })
  );
  wurzel.appendChild(katalogListe);

  sucheEingabe.oninput = zeichneKatalog;
  zeichneKatalog();

  return wurzel;
}
