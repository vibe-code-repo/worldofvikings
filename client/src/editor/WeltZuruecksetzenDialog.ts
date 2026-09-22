/**
 * The dialog of "Welt zurücksetzen" (Editor K4.0).
 *
 * Its own file and its own frame instead of `frage()` from AbgleichDialog.ts:
 * `frage()` resolves on the first click of any answer button, and this dialog
 * needs a button that stays OFF until the instance name has been typed. The
 * frame (curtain, panel, colours) follows AbgleichDialog.ts; what decides
 * anything (the gate, the sentences) is in weltZuruecksetzen.ts and tested there.
 *
 * Like the other question dialogs it has no close cross and no Esc: the way out
 * is "Abbrechen", and it is the highlighted answer. Closing it any other way
 * would be an answer nobody gave.
 */
import { F, M, SCHRIFT, beiUeberfahren, beschriftungStil, el, grundregelnEinhaengen, knopf, kreuzfeld, stil, zierTitel } from './design';
import { NICHTS_GELOESCHT, ResetDialogZustand, bleibtSaetze, verschwindetSaetze, type ResetEingabe, type ResetZahlen, type SeedWahl } from './weltZuruecksetzen';

const Z = 9000;

export interface ResetDialogOptionen {
  instanz: string;
  zahlen: ResetZahlen;
  /** The browser draft as the editor counts it. */
  entwurf: { platzierungen: number; regionen: number };
  /** Export the draft as JSON (the same helper the other dialogs offer). */
  entwurfExportieren: () => void;
}

/** Resolves with the choice, or `null` when the user cancels. */
export function weltZuruecksetzenDialog(opt: ResetDialogOptionen): Promise<ResetEingabe | null> {
  return new Promise((aufloesen) => {
    grundregelnEinhaengen();
    const zustand = new ResetDialogZustand(opt.instanz);

    const huelle = el(
      'div',
      stil({
        position: 'fixed',
        inset: '0',
        'z-index': String(Z),
        display: 'grid',
        'place-items': 'center',
        background: F.vorhang,
        'backdrop-filter': 'blur(3px)',
        'font-family': SCHRIFT.text,
        color: F.text,
        'font-size': '13px',
      })
    );
    const tafel = el(
      'div',
      stil({
        'max-width': '640px',
        width: 'calc(100% - 48px)',
        'max-height': 'calc(100vh - 48px)',
        display: 'flex',
        'flex-direction': 'column',
        background: F.flaeche,
        border: `1px solid ${F.warnRand}`,
        'border-radius': '12px',
        'box-shadow': '0 30px 80px rgba(0,0,0,.6)',
        overflow: 'hidden',
      })
    );
    huelle.appendChild(tafel);

    const kopf = el('div', stil({ padding: '16px 18px', 'border-bottom': `1px solid ${F.randLeise}`, flex: 'none' }));
    kopf.appendChild(zierTitel(`Welt „${opt.instanz}“ zurücksetzen`, 15));
    tafel.appendChild(kopf);

    const inhalt = el(
      'div',
      stil({ padding: '18px', display: 'flex', 'flex-direction': 'column', gap: '14px', flex: '1 1 auto', 'min-height': '0', 'overflow-y': 'auto' })
    );
    tafel.appendChild(inhalt);

    const absatz = (text: string, farbe: string = F.textRuhig): HTMLElement =>
      el('div', stil({ 'font-size': '13px', 'line-height': '1.55', color: farbe }), text);
    const liste = (titel: string, punkte: string[], farbe: string): HTMLElement => {
      const block = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '5px' }));
      block.appendChild(el('div', beschriftungStil(), titel));
      for (const p of punkte) block.appendChild(el('div', stil({ 'font-size': '12.5px', 'line-height': '1.5', color: farbe, 'padding-left': '12px', 'text-indent': '-12px' }), `– ${p}`));
      return block;
    };

    const verschwindet = el('div', '');
    const bleibt = el('div', '');
    const neuZeichnen = (): void => {
      verschwindet.replaceChildren(liste('Was verschwindet', verschwindetSaetze(opt.zahlen, { konten: zustand.konten, entwurf: opt.entwurf }), F.warnText));
      bleibt.replaceChildren(liste('Was bleibt', bleibtSaetze(opt.zahlen, { konten: zustand.konten, seed: zustand.seed }), F.textRuhig));
    };

    inhalt.appendChild(absatz('Das setzt die Welt auf null: leeres Weltdokument, leerer Spielstand, der Server startet neu. Das ist kein Rückgängig-Schritt.'));
    inhalt.appendChild(verschwindet);
    inhalt.appendChild(bleibt);
    inhalt.appendChild(absatz(NICHTS_GELOESCHT, F.gedimmt));

    // ── Switches ────────────────────────────────────────────────────
    const schalterBlock = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '10px', padding: '12px', background: F.feld, border: `1px solid ${F.randFeld}`, 'border-radius': `${M.radius}px` }));
    const seedZeile = el('div', stil({ display: 'flex', 'align-items': 'center', gap: '8px', 'flex-wrap': 'wrap' }));
    seedZeile.appendChild(el('span', stil({ 'font-size': '12.5px', color: F.textRuhig, flex: '1 1 160px' }), 'Gelände-Seed'));
    const seedKnoepfe: [SeedWahl, HTMLButtonElement][] = (['behalten', 'neu'] as const).map((wahl) => [
      wahl,
      knopf(wahl === 'behalten' ? 'Seed behalten' : 'Seed neu würfeln', () => {
        zustand.seed = wahl;
        seedFaerben();
        neuZeichnen();
      }, { hoehe: M.knopfHoeheKlein }),
    ]);
    const seedFaerben = (): void => {
      for (const [wahl, k] of seedKnoepfe) {
        const an = zustand.seed === wahl;
        k.style.background = an ? F.wahlFlaeche : F.erhoben;
        k.style.borderColor = an ? F.wahlRand : F.randKnopf;
      }
    };
    for (const [, k] of seedKnoepfe) seedZeile.appendChild(k);
    seedFaerben();
    schalterBlock.appendChild(seedZeile);

    const kontenZeile = el('div', stil({ display: 'flex', 'align-items': 'center', gap: '9px' }));
    const kontenKreuz = (): void => {
      const neu = kreuzfeld(zustand.konten, (an) => {
        zustand.konten = an;
        kontenKreuz();
        neuZeichnen();
      });
      kontenZeile.replaceChildren(
        neu,
        el(
          'span',
          stil({ 'font-size': '12.5px', color: zustand.konten ? F.warnText : F.textRuhig }),
          opt.zahlen.konten
            ? `Auch Konten und Charaktere beiseitelegen (${opt.zahlen.konten.konten} Konten, ${opt.zahlen.konten.charaktere} Charaktere)`
            : 'Auch Konten und Charaktere beiseitelegen (keine Kontendatenbank gefunden)'
        )
      );
    };
    kontenKreuz();
    schalterBlock.appendChild(kontenZeile);
    inhalt.appendChild(schalterBlock);

    // ── Typed confirmation ────────────────────────────────────────────
    const eingabeBlock = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '6px' }));
    eingabeBlock.appendChild(
      el('div', stil({ 'font-size': '12.5px', color: F.textRuhig }), `Zum Bestätigen den Namen der Instanz eintippen: ${opt.instanz}`)
    );
    const eingabe = el(
      'input',
      stil({
        height: '34px',
        padding: '0 10px',
        background: F.feld,
        border: `1px solid ${F.randFeld}`,
        'border-radius': `${M.radiusKlein}px`,
        color: F.text,
        'font-family': SCHRIFT.mono,
        'font-size': '13px',
        outline: 'none',
      })
    );
    eingabe.type = 'text';
    eingabe.autocomplete = 'off';
    eingabe.spellcheck = false;
    eingabe.placeholder = opt.instanz;
    eingabeBlock.appendChild(eingabe);
    inhalt.appendChild(eingabeBlock);

    // ── Answers ───────────────────────────────────────────────────────
    const leiste = el(
      'div',
      stil({ display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'stretch', gap: '8px', padding: '14px 18px', 'border-top': `1px solid ${F.randLeise}`, background: F.spalte, flex: 'none' })
    );
    const abbrechen = el(
      'button',
      stil({ flex: '1 1 200px', 'text-align': 'left', padding: '10px 13px', cursor: 'pointer', 'font-family': 'inherit', background: F.akzent, border: `1px solid ${F.akzentHell}`, 'border-radius': `${M.radius}px`, color: F.aufAkzent })
    );
    abbrechen.append(
      el('div', stil({ 'font-size': '13px', 'font-weight': '600' }), 'Abbrechen'),
      el('div', stil({ 'font-size': '11px', 'line-height': '1.45', 'margin-top': '3px' }), 'Es wird nichts geändert.')
    );
    beiUeberfahren(abbrechen, { background: F.akzentHell });

    const ausfuehren = el(
      'button',
      stil({ flex: '1 1 200px', 'text-align': 'left', padding: '10px 13px', 'font-family': 'inherit', background: 'transparent', border: `1px solid ${F.warnRand}`, 'border-radius': `${M.radius}px`, color: F.warnText })
    );
    ausfuehren.append(
      el('div', stil({ 'font-size': '13px', 'font-weight': '500' }), 'Welt zurücksetzen'),
      el('div', stil({ 'font-size': '11px', 'line-height': '1.45', 'margin-top': '3px', color: F.gedimmt }), 'Sichern, Server stoppen, beiseitelegen, neu starten.')
    );
    const freischalten = (): void => {
      const frei = zustand.freigegeben();
      ausfuehren.disabled = !frei;
      ausfuehren.style.opacity = frei ? '1' : '.4';
      ausfuehren.style.cursor = frei ? 'pointer' : 'not-allowed';
      ausfuehren.style.borderColor = frei ? F.fehler : F.warnRand;
    };
    freischalten();
    eingabe.oninput = () => {
      zustand.eingabe = eingabe.value;
      freischalten();
    };
    abbrechen.onclick = () => {
      huelle.remove();
      aufloesen(null);
    };
    ausfuehren.onclick = () => {
      // The state decides, not the button's look: a click that gets here with the gate shut resolves nothing.
      const wahl = zustand.ergebnis();
      if (!wahl) return;
      huelle.remove();
      aufloesen(wahl);
    };
    leiste.append(abbrechen, ausfuehren);
    const neben = knopf('⬇ Entwurf vorher als JSON sichern', () => opt.entwurfExportieren(), { art: 'leise' });
    neben.style.flex = '0 0 auto';
    leiste.appendChild(neben);
    tafel.appendChild(leiste);

    neuZeichnen();
    document.body.appendChild(huelle);
    // Focus on the way out, not on the typing field: Enter must not be one keystroke away from a reset.
    abbrechen.focus();
  });
}
