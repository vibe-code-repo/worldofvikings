/**
 * Item mask (Editor card EG2): the "Gegenstände" view. A list on the left, the form on the right; it lies over the
 * viewport like the catalogue does and is opened by one toolbar button (`gegenstandsKnopf`).
 * Gegenstands-Maske (EG2): Liste links, Formular rechts, als Ansicht ueber dem Viewport.
 *
 * This is the only DOM file of the mask. What decides anything is DOM-free and tested on its own: the form
 * and its check in `modell.ts`, the route calls in `api.ts`, every text of a code in `texte.ts`. Every text the
 * author reads goes through `tA()` (keys `editor.gegenstand.*`); a scanner test keeps German or English literals out.
 *
 * Loading this module runs nothing: no registry read, no `await`, nothing written to an import. The upload list
 * is read when the view opens (`uploadedModelRegistry.uploadedModelEntries()`), the items when it loads.
 *
 * No hand preview at the Viking here (EG3), no "accept" by pull request (EG4).
 */
import { ITEM_DEFS, uploadedModelRegistry } from '@wov/shared';
import type { GegenstandsEintrag } from '@wov/shared/src/items/gegenstandsDaten.js';
import type { TranslationKey } from '../../i18n';
import { F, M, SCHRIFT, beschriftungStil, el, grundregelnEinhaengen, stil } from '../design';
import { aktuelleSprache } from '../i18n';
import { fuege, sichtbarKuerzen, tA, zier, type Anzeigetext } from './anzeige';
import { elT, frageBestaetigen, knopfT, setzeText, zierTitelT } from './dom';
import { ladeQuittung, type ApiOptionen, type Stand } from './api';
import {
  eigeneBehaltenAbgleich,
  entferneGegenstand,
  entscheideNachSpeichern,
  kanonisch,
  ladeGefangen,
  ladefehlerBanner,
  pruefeKonflikt,
  schnappschuss,
  speichereSchnappschuss,
  speicherSperre,
  type KonfliktErgebnis,
} from './ablauf';
import {
  ANIMATIONSSAETZE,
  GEGENSTANDS_TYPEN,
  MAX_GEGENSTAENDE,
  SELTENHEITEN,
  STAT_IDS,
  TEXT_MAX,
  andereOhne,
  eintragZuFormular,
  formularZuEintrag,
  idAenderbar,
  kopie,
  leeresFormular,
  mitEintrag,
  pruefeFormular,
  setzeId,
  type FeldFehler,
  type Formular,
  type Vektor3,
} from './modell';
import {
  abhaengigkeitsInhalt,
  bestaetigungsInhalt,
  feldFehlerText,
  konfliktInhalt,
  fehlerErgebnisText,
  grundText,
  quittungText,
  routeFehlerText,
  verworfenZeile,
  zugangText,
  zusammengefuehrtText,
  type BestaetigungInfo,
} from './texte';

const Z = 9000;

const TYP_SCHLUESSEL: Record<(typeof GEGENSTANDS_TYPEN)[number], TranslationKey> = {
  einhaendigWaffe: 'editor.gegenstand.typ.einhaendig_waffe',
  zweihaendigWaffe: 'editor.gegenstand.typ.zweihaendig_waffe',
  werkzeug: 'editor.gegenstand.typ.werkzeug',
  material: 'editor.gegenstand.typ.material',
};
const SATZ_SCHLUESSEL: Record<(typeof ANIMATIONSSAETZE)[number], TranslationKey> = {
  sword: 'editor.gegenstand.satz.sword',
  staff: 'editor.gegenstand.satz.staff',
  spear: 'editor.gegenstand.satz.spear',
};
const RARITY_SCHLUESSEL: Record<(typeof SELTENHEITEN)[number], TranslationKey> = {
  common: 'editor.gegenstand.rarity.common',
  uncommon: 'editor.gegenstand.rarity.uncommon',
  rare: 'editor.gegenstand.rarity.rare',
  epic: 'editor.gegenstand.rarity.epic',
  legendary: 'editor.gegenstand.rarity.legendary',
};
const WERT_SCHLUESSEL: Record<(typeof STAT_IDS)[number], TranslationKey> = {
  damage: 'editor.gegenstand.feld.wert_damage',
  armor: 'editor.gegenstand.feld.wert_armor',
  strength: 'editor.gegenstand.feld.wert_strength',
  vitality: 'editor.gegenstand.feld.wert_vitality',
  agility: 'editor.gegenstand.feld.wert_agility',
};

/** Display name of an entry in the current language; its id if it has no text. */
function anzeigeName(e: GegenstandsEintrag): string {
  const tx = Object.hasOwn(e.texte, e.nameSchluessel) ? e.texte[e.nameSchluessel] : undefined;
  const lang = aktuelleSprache();
  return (lang === 'en' ? tx?.en ?? tx?.de : tx?.de ?? tx?.en) ?? e.id;
}

/** True if the upload is gone from the registry ("Modell fehlt"). */
const modellFehlt = (upload: string | null): boolean =>
  upload !== null && upload !== '' && uploadedModelRegistry.uploadedModelEntry(upload.slice(uploadedModelRegistry.UPLOAD_MODEL_PREFIX.length)) === undefined;

/** Modal question dialog with two answers; resolves `true` on the confirm button, `false` on cancel. No Esc, no click outside. */
function fragenDialog(inhalt: { titel: Anzeigetext; satz: Anzeigetext; punkte: Anzeigetext[]; weitere: Anzeigetext | null; bestaetigen: Anzeigetext; abbrechen: Anzeigetext }): Promise<boolean> {
  return new Promise((aufloesen) => {
    grundregelnEinhaengen();
    const huelle = el(
      'div',
      stil({ position: 'fixed', inset: '0', 'z-index': String(Z), display: 'grid', 'place-items': 'center', background: F.vorhang, 'backdrop-filter': 'blur(3px)', 'font-family': SCHRIFT.text, color: F.text, 'font-size': '13px' })
    );
    huelle.setAttribute('data-gegenstand-dialog', '');
    const tafel = el(
      'div',
      stil({ 'max-width': '560px', width: 'calc(100% - 48px)', 'max-height': 'calc(100vh - 48px)', display: 'flex', 'flex-direction': 'column', background: F.flaeche, border: `1px solid ${F.warnRand}`, 'border-radius': '12px', 'box-shadow': '0 30px 80px rgba(0,0,0,.6)', overflow: 'hidden' })
    );
    const kopf = el('div', stil({ padding: '16px 18px', 'border-bottom': `1px solid ${F.randLeise}`, flex: 'none' }));
    kopf.appendChild(zierTitelT(inhalt.titel, 15));
    const mitte = el('div', stil({ padding: '18px', display: 'flex', 'flex-direction': 'column', gap: '10px', 'overflow-y': 'auto' }));
    mitte.appendChild(elT('div', stil({ 'line-height': '1.55', color: F.textRuhig }), inhalt.satz));
    if (inhalt.punkte.length > 0) {
      const ul = el('ul', stil({ margin: '0', 'padding-left': '20px', color: F.warnText, 'line-height': '1.6' }));
      for (const p of inhalt.punkte) ul.appendChild(elT('li', '', p));
      if (inhalt.weitere !== null) ul.appendChild(elT('li', stil({ 'list-style': 'none', color: F.gedimmt }), inhalt.weitere));
      mitte.appendChild(ul);
    }
    const fuss = el('div', stil({ padding: '12px 18px', display: 'flex', 'justify-content': 'flex-end', gap: '10px', 'border-top': `1px solid ${F.randLeise}` }));
    const antwort = (ja: boolean): void => {
      huelle.remove();
      aufloesen(ja);
    };
    // The highlighted answer is "cancel": the way out is never the destructive one.
    fuss.append(knopfT(inhalt.bestaetigen, () => antwort(true), { art: 'leise' }), knopfT(inhalt.abbrechen, () => antwort(false), { art: 'bronze' }));
    tafel.append(kopf, mitte, fuss);
    huelle.appendChild(tafel);
    document.body.appendChild(huelle);
  });
}

class GegenstandsSeite {
  private readonly wurzel: HTMLDivElement;
  private readonly listeEl: HTMLDivElement;
  private readonly formEl: HTMLDivElement;
  private readonly hinweisEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly quittungEl: HTMLDivElement;
  private speichernKnopf: HTMLButtonElement | null = null;
  private entfernenKnopf: HTMLButtonElement | null = null;
  private zaehlerEls: Array<{ el: HTMLElement; text: () => Anzeigetext }> = [];
  private fehlerEls = new Map<string, HTMLElement>();
  private allgemeinFehlerEl: HTMLElement | null = null;

  private stand: Stand | null = null;
  private form: Formular | null = null;
  /** Id of the SAVED entry the form edits, null for a new one. */
  private ausgewaehlt: string | null = null;
  /** The form as it was loaded, to notice unsaved edits. */
  private formAusgang = '';
  /** Loading and saving are separate: the save button says "loading" only for the first. */
  private laedt = false;
  private speichert = false;
  /** The saved version of the entry when the form was opened (null for a new one): the base of a conflict check. */
  private basis: GegenstandsEintrag | null = null;
  /** Set while the author has to choose between their version and the server's; saving is locked meanwhile. */
  private konflikt: Extract<KonfliktErgebnis, { art: 'konflikt' }> | null = null;
  private offen = false;
  private readonly taste = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && !document.querySelector('[data-gegenstand-dialog]')) {
      e.stopPropagation();
      this.schliessen();
    }
  };

  constructor(
    viewport: HTMLElement,
    private readonly api: ApiOptionen
  ) {
    grundregelnEinhaengen();
    this.wurzel = el(
      'div',
      stil({ position: 'absolute', inset: '0', 'z-index': '40', display: 'none', 'flex-direction': 'column', background: F.grund, color: F.text, 'font-family': SCHRIFT.text, 'font-size': '13px' })
    );
    const kopf = el('div', stil({ display: 'flex', 'align-items': 'center', gap: '12px', padding: '10px 16px', 'border-bottom': `1px solid ${F.rand}`, flex: 'none' }));
    kopf.appendChild(zierTitelT(tA('editor.gegenstand.seite.titel'), 15));
    this.quittungEl = el('div', stil({ 'font-size': '11.5px', color: F.gedimmt, flex: '1', 'min-width': '0' }));
    kopf.append(
      this.quittungEl,
      knopfT(tA('editor.gegenstand.seite.neu_laden'), () => this.sicher(this.laden()), { art: 'leise', hoehe: M.knopfHoeheKlein }),
      knopfT(tA('editor.gegenstand.seite.schliessen'), () => this.schliessen(), { hoehe: M.knopfHoeheKlein })
    );
    this.bannerEl = el('div', stil({ display: 'none', 'flex-direction': 'column', gap: '6px', padding: '10px 16px', background: F.warnFlaeche, 'border-bottom': `1px solid ${F.warnRand}`, color: F.warnText, 'font-size': '12.5px' }));
    const koerper = el('div', stil({ display: 'flex', flex: '1', 'min-height': '0' }));
    const links = el('div', stil({ width: '280px', flex: 'none', display: 'flex', 'flex-direction': 'column', 'border-right': `1px solid ${F.rand}`, background: F.flaeche }));
    const linksKopf = el('div', stil({ display: 'flex', gap: '8px', padding: '10px' }));
    linksKopf.append(
      knopfT(tA('editor.gegenstand.seite.neu'), () => this.neuerEintrag(), { art: 'bronze', hoehe: M.knopfHoeheKlein }),
      knopfT(tA('editor.gegenstand.seite.kopieren'), () => this.kopieren(), { hoehe: M.knopfHoeheKlein })
    );
    this.listeEl = el('div', stil({ flex: '1', 'overflow-y': 'auto', padding: '0 6px 10px' }));
    links.append(linksKopf, this.listeEl);
    this.formEl = el('div', stil({ flex: '1', 'min-width': '0', 'overflow-y': 'auto', padding: '16px 20px 80px' }));
    koerper.append(links, this.formEl);
    this.hinweisEl = el('div', stil({ padding: '8px 16px', 'font-size': '12px', color: F.gedimmt, 'border-top': `1px solid ${F.rand}`, flex: 'none', 'min-height': '18px' }));
    this.wurzel.append(kopf, this.bannerEl, koerper, this.hinweisEl);
    viewport.appendChild(this.wurzel);
  }

  get istOffen(): boolean {
    return this.offen;
  }

  umschalten(): void {
    if (this.offen) this.schliessen();
    else this.oeffnen();
  }

  private oeffnen(): void {
    this.offen = true;
    this.wurzel.style.display = 'flex';
    document.addEventListener('keydown', this.taste, true);
    this.sicher(this.laden());
  }

  private schliessen(): void {
    if (this.form && this.veraendert() && !frageBestaetigen(tA('editor.gegenstand.seite.verwerfen_frage'))) return;
    this.offen = false;
    this.wurzel.style.display = 'none';
    document.removeEventListener('keydown', this.taste, true);
  }

  // ── Loading ────────────────────────────────────────────────────────

  private meldung(text: Anzeigetext, fehler = false): void {
    setzeText(this.hinweisEl, text);
    this.hinweisEl.style.color = fehler ? F.fehler : F.gedimmt;
  }

  private banner(zeilen: Anzeigetext[], knoepfe: HTMLElement[] = []): void {
    this.bannerEl.replaceChildren(...zeilen.map((z) => elT('div', '', z)), ...knoepfe);
    this.bannerEl.style.display = zeilen.length > 0 || knoepfe.length > 0 ? 'flex' : 'none';
  }

  /** Every promise of a button goes through here: nothing stays unhandled, a throw becomes one message. */
  private sicher(p: Promise<unknown>): void {
    p.catch(() => {
      this.laedt = false;
      this.speichert = false;
      this.meldung(tA('editor.gegenstand.seite.unerwartet'), true);
      this.aktualisiere();
    });
  }

  /**
   * Loads the items and the receipt. A draft in the form is kept (`neu laden` never discards it), but it is
   * compared with the new state: if the server changed THIS entry, the author chooses (`zeigeKonflikt`).
   * `nach412`: this load follows a refused save (the file had changed).
   */
  private async laden(nach412 = false): Promise<void> {
    if (this.laedt || this.speichert) return;
    this.laedt = true;
    this.aktualisiere();
    this.meldung(tA('editor.gegenstand.seite.laedt'));
    try {
      const erg = await ladeGefangen(this.api);
      if (erg.art !== 'ok') {
        const fehlerText = erg.art === 'ausnahme' ? tA('editor.gegenstand.seite.unerwartet') : erg.art === 'netz' ? zugangText(erg.zeit === true ? 'zeit' : 'netz') : fehlerErgebnisText(erg);
        // An open conflict stays decidable: its lines and the two choices are drawn again under the error.
        const b = ladefehlerBanner({ fehlerText, konflikt: this.konflikt });
        this.banner(b.zeilen, b.wahlknoepfe ? [this.wahlKnoepfe()] : []);
        this.meldung(zier(''), true);
        return;
      }
      this.stand = erg.stand;
      const zeilen: Anzeigetext[] = [];
      if (nach412) zeilen.push(tA('editor.gegenstand.seite.veraltet'));
      if (erg.stand.dateiFehler !== null) {
        zeilen.push(tA('editor.gegenstand.seite.datei_kaputt', { grund: routeFehlerText(erg.stand.dateiFehler) }));
      }
      if (erg.stand.verworfen.length > 0) {
        zeilen.push(
          tA('editor.gegenstand.seite.verworfen_hinweis', {
            anzahl: erg.stand.verworfen.length,
            liste: fuege('; ', ...erg.stand.verworfen.map((v) => verworfenZeile(v))),
          })
        );
      }
      const k: KonfliktErgebnis = this.form
        ? pruefeKonflikt({ basis: this.basis, form: this.form, ausgewaehlt: this.ausgewaehlt, entwurfGeaendert: this.veraendert(), neuerStand: erg.stand.eintraege })
        : { art: 'keiner' };
      this.konflikt = k.art === 'konflikt' ? k : null;
      if (k.art === 'uebernehmen' && k.server === null) zeilen.push(tA('editor.gegenstand.seite.entfernt_woanders'));
      const zusammengefuehrt = k.art === 'zusammen' || k.art === 'konflikt' ? zusammengefuehrtText(k.uebernommen) : null;
      if (zusammengefuehrt !== null) zeilen.push(zusammengefuehrt);
      if (this.konflikt) this.zeigeKonflikt(zeilen);
      else this.banner(zeilen);
      this.meldung(zier(''));
      if (k.art === 'uebernehmen') this.setzeForm(k.server ? eintragZuFormular(k.server) : null, k.server ? k.server.id : null);
      else if (k.art === 'zusammen') this.uebernimmZusammen(k.form, k.server);
      else {
        this.zeichneListe();
        this.zeichneForm();
      }
      this.sicher(this.ladeQuittungAnzeige());
    } finally {
      this.laedt = false;
      this.aktualisiere();
    }
  }

  /** Both versions of the entry the server changed, and the two ways out. Nothing is decided for the author. */
  private zeigeKonflikt(vorher: Anzeigetext[]): void {
    const k = this.konflikt;
    if (!k) return;
    const inhalt = konfliktInhalt(k);
    this.banner([...vorher, inhalt.titel, ...inhalt.zeilen, ...(inhalt.weitere === null ? [] : [inhalt.weitere])], [this.wahlKnoepfe()]);
  }

  /** The two ways out of a conflict. */
  private wahlKnoepfe(): HTMLElement {
    const wahl = el('div', stil({ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }));
    wahl.append(
      knopfT(tA('editor.gegenstand.konflikt.eigene_behalten'), () => this.eigeneBehalten(), { hoehe: M.knopfHoeheKlein }),
      knopfT(tA('editor.gegenstand.konflikt.server_uebernehmen'), () => this.serverUebernehmen(), { hoehe: M.knopfHoeheKlein })
    );
    return wahl;
  }

  /**
   * The server changed other fields of the open entry and none the draft changed too: the draft now carries those
   * changes, the saved version it is compared with is the server's, and the form still counts as edited.
   */
  private uebernimmZusammen(f: Formular, server: GegenstandsEintrag): void {
    this.form = f;
    this.basis = server;
    this.formAusgang = JSON.stringify(eintragZuFormular(server));
    this.zeichneListe();
    this.zeichneForm();
  }

  /**
   * Keep the draft: the state loaded just now is its new base, saving overwrites the server's version of this entry.
   * The form stayed editable while the conflict was open, so the comparison is run again against the form AS IT IS NOW
   * (`eigeneBehaltenAbgleich`), not against the copy made when the conflict was found; if the author's edits since then
   * opened a dispute they have not seen, the conflict is shown again instead of deciding.
   */
  private eigeneBehalten(): void {
    const k = this.konflikt;
    if (!k || !this.form) return;
    const r = eigeneBehaltenAbgleich({ basis: this.basis, form: this.form, ausgewaehlt: this.ausgewaehlt, konflikt: k });
    if (r.art === 'neu') {
      this.konflikt = r.konflikt;
      const zusammen = zusammengefuehrtText(r.konflikt.uebernommen);
      this.zeigeKonflikt(zusammen === null ? [] : [zusammen]);
      this.aktualisiere();
      return;
    }
    this.konflikt = null;
    if (k.server === null) {
      this.ausgewaehlt = null;
      this.form.neu = true;
    } else {
      this.form = r.form; // the draft as it is now, with the server's changes to the fields the author did not touch
    }
    this.basis = this.ausgewaehlt === null ? null : k.server;
    this.banner([]);
    this.zeichneListe();
    this.zeichneForm();
  }

  /** Take the server's version: the draft is dropped (the author chose so). */
  private serverUebernehmen(): void {
    const k = this.konflikt;
    if (!k) return;
    this.konflikt = null;
    this.banner([]);
    this.setzeForm(k.server ? eintragZuFormular(k.server) : null, k.server ? k.server.id : null);
  }

  private async ladeQuittungAnzeige(): Promise<void> {
    const erg = await ladeQuittung(this.api);
    if (erg.art !== 'ok') {
      setzeText(this.quittungEl, zier(''));
      return;
    }
    const liste = this.stand?.eintraege ?? [];
    const name = (id: string): string => {
      const e = liste.find((x) => x.id === id);
      return e ? anzeigeName(e) : id;
    };
    setzeText(this.quittungEl, fuege(' ', tA('editor.gegenstand.quittung.titel'), quittungText(erg.quittung, name)));
  }

  // ── List ───────────────────────────────────────────────────────────

  private zeichneListe(): void {
    const liste = this.stand?.eintraege ?? [];
    this.listeEl.replaceChildren();
    if (liste.length === 0) {
      this.listeEl.appendChild(elT('div', stil({ padding: '12px 8px', color: F.gedimmt, 'font-size': '12px' }), tA('editor.gegenstand.seite.leer')));
      return;
    }
    for (const e of liste) {
      const aktiv = e.id === this.ausgewaehlt;
      const zeile = el(
        'div',
        stil({ padding: '8px 10px', 'border-radius': `${M.radiusKlein}px`, cursor: 'pointer', border: `1px solid ${aktiv ? F.wahlRand : 'transparent'}`, background: aktiv ? F.wahlFlaeche : 'transparent' })
      );
      zeile.appendChild(elT('div', stil({ 'font-weight': '500' }), sichtbarKuerzen(anzeigeName(e), 80)));
      const unten = el('div', stil({ display: 'flex', gap: '8px', 'font-size': '11px', color: F.gedimmt, 'font-family': SCHRIFT.mono }));
      unten.appendChild(elT('span', '', sichtbarKuerzen(e.id)));
      if (modellFehlt(e.modell.upload)) unten.appendChild(elT('span', stil({ color: F.warnText, 'font-family': SCHRIFT.text }), tA('editor.gegenstand.seite.modell_fehlt')));
      zeile.appendChild(unten);
      zeile.onclick = () => this.waehle(e.id);
      this.listeEl.appendChild(zeile);
    }
  }

  private veraendert(): boolean {
    return this.form !== null && JSON.stringify(this.form) !== this.formAusgang;
  }

  private darfWechseln(): boolean {
    return !this.veraendert() || frageBestaetigen(tA('editor.gegenstand.seite.verwerfen_frage'));
  }

  private setzeForm(f: Formular | null, ausgewaehlt: string | null): void {
    if (this.konflikt !== null) {
      this.konflikt = null;
      this.banner([]);
    }
    this.form = f;
    this.ausgewaehlt = ausgewaehlt;
    this.basis = ausgewaehlt === null ? null : (this.stand?.eintraege.find((e) => e.id === ausgewaehlt) ?? null);
    this.formAusgang = f ? JSON.stringify(f) : '';
    this.zeichneListe();
    this.zeichneForm();
  }

  private waehle(id: string): void {
    if (id === this.ausgewaehlt || !this.darfWechseln()) return;
    const e = this.stand?.eintraege.find((x) => x.id === id);
    if (e) this.setzeForm(eintragZuFormular(e), id);
  }

  private neuerEintrag(): void {
    if (!this.stand || !this.darfWechseln()) return;
    if (this.stand.eintraege.length >= MAX_GEGENSTAENDE) {
      this.meldung(grundText('zu-viele-eintraege'), true);
      return;
    }
    this.setzeForm(leeresFormular(), null);
  }

  private kopieren(): void {
    if (!this.stand || !this.form || !this.darfWechseln()) return;
    this.setzeForm(kopie(this.form, this.stand.eintraege), null);
    this.formAusgang = '';
  }

  // ── Form ───────────────────────────────────────────────────────────

  private fehlerListe(): FeldFehler[] {
    if (!this.form || !this.stand) return [];
    return pruefeFormular(this.form, andereOhne(this.stand.eintraege, this.ausgewaehlt));
  }

  /** Field errors under their fields, the counters, the rest in the general line, and the state of the save button. */
  private aktualisiere(): void {
    const fehler = this.fehlerListe();
    const je: Map<string, Anzeigetext[]> = new Map();
    const uebrig: Anzeigetext[] = [];
    for (const f of fehler) {
      const text = feldFehlerText(f);
      if (this.fehlerEls.has(f.feld)) je.set(f.feld, [...(je.get(f.feld) ?? []), text]);
      else uebrig.push(text);
    }
    for (const [feld, elem] of this.fehlerEls) setzeText(elem, fuege(' ', ...(je.get(feld) ?? [])));
    for (const z of this.zaehlerEls) setzeText(z.el, z.text());
    if (this.allgemeinFehlerEl) setzeText(this.allgemeinFehlerEl, fuege(' ', ...uebrig));
    // "Remove" is locked by the same function as "Save" (form errors do not matter to it: the saved entry goes, not the draft).
    const entfernenEl = this.entfernenKnopf;
    if (entfernenEl) {
      entfernenEl.disabled = speicherSperre({ laedt: this.laedt, speichert: this.speichert, konflikt: this.konflikt !== null, fehlerAnzahl: 0 }) !== null;
      entfernenEl.style.opacity = entfernenEl.disabled ? '0.45' : '1';
      entfernenEl.style.cursor = entfernenEl.disabled ? 'not-allowed' : 'pointer';
    }
    const knopfEl = this.speichernKnopf;
    if (!knopfEl) return;
    // Loading locks the button and says so; a click on it does nothing, so it must not look clickable.
    const sperre = speicherSperre({ laedt: this.laedt, speichert: this.speichert, konflikt: this.konflikt !== null, fehlerAnzahl: fehler.length });
    knopfEl.disabled = sperre !== null;
    const beschriftung = knopfEl.lastElementChild;
    if (beschriftung) setzeText(beschriftung, tA(sperre === 'laedt' ? 'editor.gegenstand.seite.speichern_laedt' : 'editor.gegenstand.seite.speichern'));
    knopfEl.style.opacity = knopfEl.disabled ? '0.45' : '1';
    knopfEl.style.cursor = knopfEl.disabled ? 'not-allowed' : 'pointer';
  }

  private zeile(feld: string | null, beschriftung: TranslationKey, inhalt: HTMLElement, hinweis?: Anzeigetext, zaehler?: () => Anzeigetext): HTMLElement {
    const z = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '4px', 'min-width': '0' }));
    z.appendChild(elT('span', beschriftungStil(), tA(beschriftung)));
    z.appendChild(inhalt);
    if (hinweis || zaehler) {
      const r = el('div', stil({ display: 'flex', 'justify-content': 'space-between', gap: '8px', 'font-size': '11px', color: F.gedimmt }));
      if (hinweis) r.appendChild(elT('span', '', hinweis));
      if (zaehler) {
        const zs = el('span', stil({ 'white-space': 'nowrap', 'font-family': SCHRIFT.mono }));
        this.zaehlerEls.push({ el: zs, text: zaehler });
        r.appendChild(zs);
      }
      z.appendChild(r);
    }
    if (feld !== null) {
      const f = el('div', stil({ 'font-size': '11.5px', color: F.fehler, 'min-height': '0' }));
      this.fehlerEls.set(feld, f);
      z.appendChild(f);
    }
    return z;
  }

  private eingabe(wert: string, bei: (v: string) => void, o: { gesperrt?: boolean; mono?: boolean; liste?: string; breite?: string } = {}): HTMLInputElement {
    const i = el(
      'input',
      stil({ width: o.breite ?? '100%', 'box-sizing': 'border-box', height: '32px', padding: '0 10px', background: F.feld, border: `1px solid ${F.randFeld}`, 'border-radius': `${M.radiusKlein}px`, color: o.gesperrt ? F.gedimmt : F.text, 'font-family': o.mono ? SCHRIFT.mono : SCHRIFT.text, 'font-size': '13px' })
    );
    i.type = 'text';
    i.value = wert;
    i.disabled = o.gesperrt === true;
    if (o.liste) i.setAttribute('list', o.liste);
    i.oninput = () => {
      bei(i.value);
      this.aktualisiere();
    };
    return i;
  }

  private auswahl<T extends string>(werte: ReadonlyArray<{ id: T; text: Anzeigetext }>, gewaehlt: T, bei: (id: T) => void): HTMLSelectElement {
    const s = el(
      'select',
      stil({ width: '100%', height: '32px', padding: '0 8px', background: F.feld, border: `1px solid ${F.randFeld}`, 'border-radius': `${M.radiusKlein}px`, color: F.text, 'font-family': SCHRIFT.text, 'font-size': '13px' })
    );
    for (const w of werte) {
      const o = elT('option', '', w.text);
      o.value = w.id;
      s.appendChild(o);
    }
    s.value = gewaehlt;
    s.onchange = () => {
      const treffer = werte.find((w) => w.id === s.value);
      if (treffer !== undefined) bei(treffer.id);
      this.aktualisiere();
    };
    return s;
  }

  private vektor(v: Vektor3): HTMLElement {
    const reihe = el('div', stil({ display: 'flex', gap: '6px' }));
    for (let i = 0; i < 3; i++) reihe.appendChild(this.eingabe(v[i], (w) => (v[i] = w), { mono: true }));
    return reihe;
  }

  private abschnitt(titel: TranslationKey, ...zeilen: HTMLElement[]): HTMLElement {
    const a = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '10px', padding: '14px 0', 'border-bottom': `1px solid ${F.randLeise}` }));
    a.appendChild(zierTitelT(tA(titel), 12));
    const raster = el('div', stil({ display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px 14px' }));
    raster.append(...zeilen);
    a.appendChild(raster);
    return a;
  }

  private zeichneForm(): void {
    this.fehlerEls = new Map();
    this.zaehlerEls = [];
    this.allgemeinFehlerEl = null;
    this.formEl.replaceChildren();
    const f = this.form;
    if (!f || !this.stand) {
      this.formEl.appendChild(elT('div', stil({ color: F.gedimmt, padding: '20px 0' }), tA('editor.gegenstand.seite.waehle')));
      this.speichernKnopf = null;
      return;
    }
    const stand = this.stand;
    this.allgemeinFehlerEl = el('div', stil({ color: F.fehler, 'font-size': '12px', 'min-height': '0' }));
    this.formEl.appendChild(this.allgemeinFehlerEl);

    // General
    const idFeld = this.eingabe(f.id, (v) => { f.id = setzeId(f, v).id; }, { gesperrt: !idAenderbar(f), mono: true });
    const allgemein = this.abschnitt(
      'editor.gegenstand.abschnitt.allgemein',
      this.zeile('id', 'editor.gegenstand.feld.id', idFeld, idAenderbar(f) ? tA('editor.gegenstand.feld.id_hinweis_neu') : tA('editor.gegenstand.feld.id_hinweis_fest')),
      this.zeile('typ', 'editor.gegenstand.feld.typ', this.auswahl(GEGENSTANDS_TYPEN.map((id) => ({ id, text: tA(TYP_SCHLUESSEL[id]) })), f.typ, (v) => (f.typ = v))),
      this.zeile('stapel', 'editor.gegenstand.feld.stapel', this.eingabe(f.stapel, (v) => (f.stapel = v), { mono: true })),
      this.zeile('gewicht', 'editor.gegenstand.feld.gewicht', this.eingabe(f.gewicht, (v) => (f.gewicht = v), { mono: true })),
      this.zeile('itemLevel', 'editor.gegenstand.feld.item_level', this.eingabe(f.itemLevel, (v) => (f.itemLevel = v), { mono: true })),
      this.zeile('rarity', 'editor.gegenstand.feld.rarity', this.auswahl(SELTENHEITEN.map((id) => ({ id, text: tA(RARITY_SCHLUESSEL[id]) })), f.rarity, (v) => (f.rarity = v))),
      this.zeile('symbol', 'editor.gegenstand.feld.symbol', this.eingabe(f.symbol, (v) => (f.symbol = v), { mono: true }))
    );

    // Texts (name in both languages is required). One line each: a line break is refused, and the field says so while typing.
    const textHinweis = tA('editor.gegenstand.feld.text_hinweis', { max: TEXT_MAX });
    const zaehlerVon = (wert: () => string) => (): Anzeigetext => tA('editor.gegenstand.feld.zaehler', { n: wert().length, max: TEXT_MAX });
    const texte = this.abschnitt(
      'editor.gegenstand.abschnitt.texte',
      this.zeile('nameDe', 'editor.gegenstand.feld.name_de', this.eingabe(f.nameDe, (v) => (f.nameDe = v)), textHinweis, zaehlerVon(() => f.nameDe)),
      this.zeile('nameEn', 'editor.gegenstand.feld.name_en', this.eingabe(f.nameEn, (v) => (f.nameEn = v)), textHinweis, zaehlerVon(() => f.nameEn)),
      this.zeile('beschreibungDe', 'editor.gegenstand.feld.beschreibung_de', this.eingabe(f.beschreibungDe, (v) => (f.beschreibungDe = v)), textHinweis, zaehlerVon(() => f.beschreibungDe)),
      this.zeile('beschreibungEn', 'editor.gegenstand.feld.beschreibung_en', this.eingabe(f.beschreibungEn, (v) => (f.beschreibungEn = v)), textHinweis, zaehlerVon(() => f.beschreibungEn))
    );

    // Model
    const uploads = uploadedModelRegistry.uploadedModelEntries();
    const optionen: Array<{ id: string; text: Anzeigetext }> = [{ id: '', text: tA('editor.gegenstand.modell.keins') }];
    for (const u of uploads) optionen.push({ id: uploadedModelRegistry.UPLOAD_MODEL_PREFIX + u.name, text: fuege(' ', sichtbarKuerzen(u.anzeigename, 80), fuege('', zier('('), sichtbarKuerzen(u.name), zier(')'))) });
    if (f.upload !== '' && !optionen.some((o) => o.id === f.upload)) optionen.push({ id: f.upload, text: tA('editor.gegenstand.modell.fehlt_option', { upload: sichtbarKuerzen(f.upload, 80) }) });
    const modell = this.abschnitt(
      'editor.gegenstand.abschnitt.modell',
      this.zeile('upload', 'editor.gegenstand.feld.upload', this.auswahl(optionen, f.upload, (v) => (f.upload = v)), modellFehlt(f.upload) ? tA('editor.gegenstand.seite.modell_fehlt') : undefined),
      this.zeile('skala', 'editor.gegenstand.feld.skala', this.eingabe(f.skala, (v) => (f.skala = v), { mono: true })),
      this.zeile('haltePosition', 'editor.gegenstand.feld.halte_position', this.vektor(f.haltePosition)),
      this.zeile('halteRotation', 'editor.gegenstand.feld.halte_rotation', this.vektor(f.halteRotation)),
      this.zeile('hiebVersatz', 'editor.gegenstand.feld.hieb_versatz', this.eingabe(f.hiebVersatz, (v) => (f.hiebVersatz = v), { mono: true })),
      this.zeile(
        'animationsSatz',
        'editor.gegenstand.feld.animations_satz',
        this.auswahl<string>(
          [{ id: '', text: tA('editor.gegenstand.satz.keiner') }, ...ANIMATIONSSAETZE.map((id) => ({ id: id as string, text: tA(SATZ_SCHLUESSEL[id]) }))],
          f.animationsSatz,
          (v) => (f.animationsSatz = v as Formular['animationsSatz'])
        )
      )
    );
    const werte = this.abschnitt(
      'editor.gegenstand.abschnitt.werte',
      ...STAT_IDS.map((s) => this.zeile(`wert.${s}`, WERT_SCHLUESSEL[s], this.eingabe(f.werte[s], (v) => (f.werte[s] = v), { mono: true })))
    );
    const ernte = this.abschnitt(
      'editor.gegenstand.abschnitt.ernte',
      this.zeile('ernteBaum', 'editor.gegenstand.feld.ernte_baum', this.eingabe(f.ernteBaum, (v) => (f.ernteBaum = v), { mono: true })),
      this.zeile('ernteFels', 'editor.gegenstand.feld.ernte_fels', this.eingabe(f.ernteFels, (v) => (f.ernteFels = v), { mono: true }))
    );
    const haltbarkeit = this.abschnitt(
      'editor.gegenstand.abschnitt.haltbarkeit',
      this.zeile('haltbarkeitMax', 'editor.gegenstand.feld.haltbarkeit_max', this.eingabe(f.haltbarkeitMax, (v) => (f.haltbarkeitMax = v), { mono: true })),
      this.zeile('haltbarkeitVerbrauch', 'editor.gegenstand.feld.haltbarkeit_verbrauch', this.eingabe(f.haltbarkeitVerbrauch, (v) => (f.haltbarkeitVerbrauch = v), { mono: true })),
      this.zeile('haltbarkeitAusdauer', 'editor.gegenstand.feld.haltbarkeit_ausdauer', this.eingabe(f.haltbarkeitAusdauer, (v) => (f.haltbarkeitAusdauer = v), { mono: true }))
    );
    this.formEl.append(allgemein, texte, modell, werte, ernte, haltbarkeit, this.rezeptAbschnitt(f, stand));

    // Buttons
    const leiste = el('div', stil({ display: 'flex', gap: '10px', padding: '16px 0', 'align-items': 'center' }));
    this.speichernKnopf = knopfT(tA('editor.gegenstand.seite.speichern'), () => this.sicher(this.speichern()), { art: 'bronze' });
    leiste.appendChild(this.speichernKnopf);
    this.entfernenKnopf = null;
    if (this.ausgewaehlt !== null) {
      this.entfernenKnopf = knopfT(tA('editor.gegenstand.seite.entfernen'), () => this.sicher(this.entfernen()), { art: 'leise' });
      leiste.appendChild(this.entfernenKnopf);
    }
    this.formEl.appendChild(leiste);
    this.aktualisiere();
  }

  private rezeptAbschnitt(f: Formular, stand: Stand): HTMLElement {
    // Ingredients: every code item plus the other data items of this document.
    const listeId = 'wov-gegenstand-zutaten';
    const daten = el('datalist', '');
    daten.id = listeId;
    const namen = new Set<string>(ITEM_DEFS.map((d) => d.name));
    for (const e of stand.eintraege) if (e.id !== f.id) namen.add(e.id);
    for (const n of [...namen].sort()) {
      const o = el('option', '');
      o.value = n;
      daten.appendChild(o);
    }
    const schalter = el('input', '');
    schalter.type = 'checkbox';
    schalter.checked = f.hatRezept;
    schalter.onchange = () => {
      f.hatRezept = schalter.checked;
      if (f.hatRezept && f.zutaten.length === 0) f.zutaten.push({ item: '', menge: '1' });
      this.zeichneForm();
    };
    const zeilen: HTMLElement[] = [this.zeile(null, 'editor.gegenstand.feld.hat_rezept', schalter)];
    if (f.hatRezept) {
      zeilen.push(this.zeile('rezeptMenge', 'editor.gegenstand.feld.rezept_menge', this.eingabe(f.rezeptMenge, (v) => (f.rezeptMenge = v), { mono: true })));
      zeilen.push(el('div', stil({ 'grid-column': '1 / -1', color: F.fehler, 'font-size': '11.5px' })));
      this.fehlerEls.set('rezept', zeilen[zeilen.length - 1]);
      f.zutaten.forEach((z, i) => {
        const reihe = el('div', stil({ 'grid-column': '1 / -1', display: 'flex', gap: '8px', 'align-items': 'flex-start' }));
        const item = this.zeile(`zutat.${i}.item`, 'editor.gegenstand.feld.zutat', this.eingabe(z.item, (v) => (z.item = v), { mono: true, liste: listeId }));
        const menge = this.zeile(`zutat.${i}.menge`, 'editor.gegenstand.feld.zutat_menge', this.eingabe(z.menge, (v) => (z.menge = v), { mono: true, breite: '90px' }));
        item.style.flex = '1';
        const weg = knopfT(tA('editor.gegenstand.feld.zutat_weg'), () => {
          f.zutaten.splice(i, 1);
          this.zeichneForm();
        }, { art: 'leise', hoehe: M.knopfHoeheKlein });
        weg.style.marginTop = '18px';
        reihe.append(item, menge, weg);
        zeilen.push(reihe);
      });
      zeilen.push(
        knopfT(tA('editor.gegenstand.feld.zutat_hinzu'), () => {
          f.zutaten.push({ item: '', menge: '1' });
          this.zeichneForm();
        }, { hoehe: M.knopfHoeheKlein })
      );
    }
    const a = this.abschnitt('editor.gegenstand.abschnitt.rezept', ...zeilen);
    a.appendChild(daten);
    return a;
  }

  // ── Saving ─────────────────────────────────────────────────────────

  private frage(info: BestaetigungInfo): Promise<boolean> {
    const liste = this.stand?.eintraege ?? [];
    const inhalt = bestaetigungsInhalt(info, (id) => {
      const e = liste.find((x) => x.id === id);
      return e ? anzeigeName(e) : null;
    });
    return fragenDialog(inhalt);
  }

  /**
   * Runs a save (`lauf` builds its list and its hash from ONE snapshot, see `ablauf.ts`), answers the route's refusals
   * in words; true if it was written. Nothing throws out of here. After a 412 the file is reloaded at once, and if it
   * changed THIS entry the author chooses. If the page is locked (loading, saving, conflict) nothing is sent and the
   * author is told why.
   */
  private async senden(lauf: () => ReturnType<typeof entferneGegenstand>): Promise<boolean> {
    if (!this.stand) return false;
    const sperre = speicherSperre({ laedt: this.laedt, speichert: this.speichert, konflikt: this.konflikt !== null, fehlerAnzahl: 0 });
    if (sperre === 'laedt') this.meldung(tA('editor.gegenstand.seite.gesperrt_laedt'), true);
    else if (sperre === 'speichert') this.meldung(tA('editor.gegenstand.seite.gesperrt_speichert'), true);
    else if (sperre === 'konflikt') this.meldung(tA('editor.gegenstand.seite.gesperrt_konflikt'), true);
    if (sperre !== null) return false;
    this.speichert = true;
    this.aktualisiere();
    let erg: Awaited<ReturnType<typeof lauf>>;
    try {
      erg = await lauf();
    } finally {
      this.speichert = false;
    }
    switch (erg.art) {
      case 'ok':
        this.banner([]);
        this.meldung(tA('editor.gegenstand.seite.gespeichert', { anzahl: erg.eintraege }));
        this.aktualisiere();
        return true;
      case 'veraltet':
        this.meldung(tA('editor.gegenstand.seite.nicht_gespeichert'), true);
        this.aktualisiere();
        await this.laden(true);
        return false;
      case 'ausnahme':
        this.banner([tA('editor.gegenstand.seite.unerwartet')]);
        this.meldung(tA('editor.gegenstand.seite.nicht_gespeichert'), true);
        break;
      case 'gesperrt':
        this.banner([tA('editor.gegenstand.seite.gesperrt', { sekunden: erg.retryAfter })]);
        this.meldung(tA('editor.gegenstand.seite.nicht_gespeichert'), true);
        break;
      case 'verworfen':
        this.banner([
          tA('editor.gegenstand.seite.verworfen_liste', { anzahl: erg.verworfen.length }),
          ...erg.verworfen.map((v) => verworfenZeile(v)),
        ]);
        this.meldung(tA('editor.gegenstand.seite.nicht_gespeichert'), true);
        break;
      case 'dialog-nein':
      case 'abgebrochen':
        this.meldung(tA('editor.gegenstand.seite.nicht_gespeichert'));
        break;
      case 'bestaetigung':
        // `speichernMitBestaetigung` never returns this one; kept so a future change fails loudly.
        this.meldung(tA('editor.gegenstand.seite.nicht_gespeichert'), true);
        break;
      case 'netz':
        this.banner([zugangText(erg.zeit === true ? 'zeit' : 'netz')]);
        this.meldung(tA('editor.gegenstand.seite.nicht_gespeichert'), true);
        break;
      case 'fehler':
        this.banner([fehlerErgebnisText(erg)]);
        this.meldung(tA('editor.gegenstand.seite.nicht_gespeichert'), true);
        break;
    }
    this.aktualisiere();
    return false;
  }

  private async speichern(): Promise<void> {
    if (!this.form || !this.stand || this.fehlerListe().length > 0) return;
    const eintrag = formularZuEintrag(this.form);
    const s = schnappschuss(this.stand);
    const vorher = { form: kanonisch(this.form), id: this.form.id, ausgewaehlt: this.ausgewaehlt };
    const geschrieben = await this.senden(() => speichereSchnappschuss(this.api, s, mitEintrag(s.eintraege, this.ausgewaehlt, eintrag), (info) => this.frage(info)));
    if (!geschrieben) return;
    await this.nachSpeichern(eintrag.id, vorher);
  }

  /**
   * Removes the selected item. If other recipes need it, the mask says so BEFORE the PUT (the route would
   * refuse the file with a 422) and offers to remove those entries with it; "cancel" leaves everything as it is.
   */
  private async entfernen(): Promise<void> {
    if (this.ausgewaehlt === null || !this.stand) return;
    const id = this.ausgewaehlt;
    const vorher = { form: kanonisch(this.form), id: this.form?.id ?? '', ausgewaehlt: this.ausgewaehlt };
    const name = (x: string): string | null => {
      const e = this.stand?.eintraege.find((y) => y.id === x);
      return e ? anzeigeName(e) : null;
    };
    const geschrieben = await this.senden(() =>
      entferneGegenstand(this.api, () => this.stand, id, (abh) => fragenDialog(abhaengigkeitsInhalt(id, abh, name)), (info) => this.frage(info))
    );
    if (!geschrieben) return;
    await this.nachSpeichern(null, vorher);
  }

  /**
   * Reloads the saved state (the writer may have changed the bytes) and selects the entry that was saved, but only if the
   * form is still what was saved: `vorher` is the form when the save started. If the author kept typing meanwhile the
   * draft stays (`entscheideNachSpeichern`) and the banner says that edits are still unsaved.
   */
  private async nachSpeichern(id: string | null, vorher: { form: string; id: string; ausgewaehlt: string | null }): Promise<void> {
    const erg = await ladeGefangen(this.api);
    if (erg.art !== 'ok') return;
    this.stand = erg.stand;
    const e = id === null ? undefined : erg.stand.eintraege.find((x) => x.id === id);
    const w = entscheideNachSpeichern({
      formVorher: vorher.form,
      idVorher: vorher.id,
      ausgewaehltVorher: vorher.ausgewaehlt,
      formJetzt: this.form,
      ausgewaehltJetzt: this.ausgewaehlt,
      gespeicherteId: id,
      server: e ?? null,
    });
    if (w.art === 'ersetzen') this.setzeForm(e ? eintragZuFormular(e) : null, e ? e.id : null);
    else {
      if (w.weiter !== null && this.form !== null) {
        this.ausgewaehlt = w.weiter.ausgewaehlt;
        this.basis = w.weiter.basis;
        this.form.neu = w.weiter.neu;
        this.formAusgang = w.weiter.basis === null ? '' : JSON.stringify(eintragZuFormular(w.weiter.basis));
      }
      this.banner(w.offen ? [tA('editor.gegenstand.seite.nach_speichern_offen')] : []);
      this.zeichneListe();
      this.aktualisiere();
    }
    this.sicher(this.ladeQuittungAnzeige());
  }
}

/** The one toolbar button that opens the mask; the editor calls this once (see `editorMain.ts`). */
export function gegenstandsKnopf(viewport: HTMLElement, api: ApiOptionen = {}): HTMLButtonElement {
  let seite: GegenstandsSeite | null = null;
  return knopfT(
    tA('editor.gegenstand.knopf.titel'),
    () => {
      seite ??= new GegenstandsSeite(viewport, api);
      seite.umschalten();
    },
    { art: 'flaeche', titel: tA('editor.gegenstand.knopf.hinweis') }
  );
}
