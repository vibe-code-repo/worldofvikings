/**
 * Spawn-Panel des 3D-Testflugs — ein richtiges Editor-Interface:
 * durchsuchbare Liste ALLER platzierbaren Prefabs (Vegetation, Felsen,
 * Bauteile, freie Suche über die ganze Registry), dazu Drehung, Abstand
 * und Größe. Muster: DungeonEditor (reines DOM, Callback-Interface,
 * keine Socket-/Szenen-Kopplung).
 *
 * Seit Block A ist „platzierbar" enger als „steht in der Registry":
 * Gesetzt werden darf nur, was in EIGENE_MODELLE steht
 * (istEigenesModell). Alles andere bleibt in der Liste STEHEN,
 * ausgegraut und ohne Klick. Es ganz zu streichen wäre die kürzere
 * Lösung und ist verworfen: Ein spurlos fehlender Eintrag liest sich wie
 * ein eigener Tippfehler, und wer den Fehler bei sich sucht, findet ihn
 * nicht. Ohne beides fiele es erst im Boot-Log des Servers auf, wenn
 * pruefeLayout die fertige Welt zurückweist.
 *
 * Bedienung im Testflug: B öffnet/schließt (Esc gibt den Cursor frei).
 * Platziert wird NUR im aktiven Platzier-Modus: Ein Klick auf einen
 * Listeneintrag startet ihn (Geist hängt an der Maus), Klick/P setzt
 * GENAU EINMAL und beendet den Modus wieder — nach dem Setzen hängt
 * nichts mehr an der Maus. Abbruch ohne Setzen: zweiter Klick auf den
 * Eintrag, Esc oder Rechtsklick. Ohne aktiven Modus setzt ein Klick in
 * die Welt NICHTS — der zuletzt gewählte Eintrag bleibt nur Vorauswahl.
 */
import {
  FOLIAGE,
  BAU_PREFABS,
  PREFABS_BY_NAME,
  EIGENE_MODELLE,
  FRAKTIONEN,
  NPC_ROLLEN,
  QUEST_ZUSTAENDE,
  NPC_NAME_MAX,
  NPC_STUFE_MAX,
  NPC_STUFE_MIN,
  istEigenesModell,
  istNpcPrefab,
  loeseNpcAuf,
} from '@wov/shared';
import type { Fraktion, NpcDef, NpcRolle, QuestZustand } from '@wov/shared';

export interface SpawnEinstellung {
  prefab: string;
  /** Radiant; null = zufällige Drehung je Platzierung. */
  yaw: number | null;
  /** Abstand vor dem Spieler in Metern. */
  abstand: number;
  scale: number;
  /** Untergrund unter der Grundfläche einebnen (Sockel im Layout). */
  einebnen: boolean;
}

export interface SpawnPanelCallbacks {
  platzieren: () => void;
  entferneLetztes: () => void;
  anzahl: () => number;
  /**
   * Tageszeit in Stunden (0–24) setzen und den Zyklus dabei anhalten.
   *
   * Ohne Anhalten wandert jeder eingestellte Wert sofort weiter — ein
   * Weltentag dauert im Spiel 30 Minuten, zum Beurteilen einer Szene bei
   * Sonnenuntergang ist das zu schnell.
   */
  setzeZeit?: (stunden: number, angehalten: boolean) => void;
  /** Aktuelle Tageszeit in Stunden, für die Anzeige beim Öffnen. */
  zeit?: () => number;
  /**
   * Die GEWÄHLTE (angeklickte) Platzierung — null, wenn keine gewählt ist.
   *
   * Die NPC-Felder hängen bewusst an der Auswahl und nicht an der
   * Vorauswahl der Liste: Ein Name gehört zu einer bestimmten Figur in der
   * Welt, nicht zu „der nächsten Völva, die ich setze". Wer die Angaben
   * einer neuen Figur ändern will, klickt sie an — derselbe Griff wie zum
   * Verschieben und Löschen.
   */
  gewaehlteNpc?: () => { prefab: string; npc?: NpcDef } | null;
  /**
   * Geänderte Angaben zurückschreiben; `undefined` entfernt das Feld
   * wieder (alles steht auf Prefab-Vorgabe).
   */
  setzeNpc?: (npc: NpcDef | undefined) => void;
}

/** Anzeigetexte der Listen aus shared/npc.ts (unbekanntes zeigt sich roh). */
const ROLLE_TEXT: Readonly<Record<string, string>> = {
  zivil: 'Zivil',
  quest: 'Quest-Geber',
  haendler: 'Händler',
  monster: 'Monster',
};
const FRAKTION_TEXT: Readonly<Record<string, string>> = {
  neutral: 'Neutral',
  wikinger: 'Wikinger',
  sachsen: 'Sachsen',
  wild: 'Wild (Tiere)',
  muspel: 'Muspel (Feuer)',
};
const QUEST_TEXT: Readonly<Record<string, string>> = {
  keine: 'keine',
  verfuegbar: 'verfügbar (?)',
  laeuft: 'läuft',
  fertig: 'fertig (!)',
};

/**
 * Platzierbares nach vorn, Gesperrtes ans Ende; innerhalb beider Gruppen
 * bleibt die Reihenfolge, wie sie war.
 *
 * Nötig wegen des Fensters von 80 Zeilen: In „Alle (mit Modell)" stehen
 * 113 eigene Namen zwischen 3.557 fremden, in der Vegetation 54 zwischen
 * 97. Unsortiert bestünde die sichtbare Seite fast nur aus gesperrten
 * Zeilen — die Liste wäre als Werkzeug unbrauchbar, ohne dass man ihr
 * ansieht, warum.
 *
 * Verworfen: die Gesperrten gar nicht erst zurückgeben. Dann stünde in
 * „Bauteile" nur noch zwei von neun Einträgen, und niemand könnte
 * unterscheiden, ob die anderen sieben entfallen sind oder nie existiert
 * haben.
 */
function eigeneZuerst(namen: readonly string[]): string[] {
  return [
    ...namen.filter((n) => istEigenesModell(n)),
    ...namen.filter((n) => !istEigenesModell(n)),
  ];
}

const KATEGORIEN: ReadonlyArray<{ name: string; namen: () => string[] }> = [
  // Zuerst, und damit die Vorgabe beim Öffnen: die kurze Liste der selbst
  // erzeugten Modelle. In den anderen Kategorien gehen sie zwischen
  // hunderten Einträgen unter (die Liste zeigt nur die ersten 80).
  // Nicht vorhandene Namen werden gefiltert, damit ein Eintrag ohne
  // passende GLB die Auswahl nicht mit einer toten Zeile verstopft.
  { name: 'Eigene Modelle', namen: () => EIGENE_MODELLE.filter((n) => PREFABS_BY_NAME.has(n)) },
  { name: 'Vegetation', namen: () => eigeneZuerst([...new Set(FOLIAGE.map((f) => f.prefabName))]) },
  { name: 'Bauteile', namen: () => eigeneZuerst([...BAU_PREFABS]) },
  {
    name: 'Alle (mit Modell)',
    namen: () =>
      eigeneZuerst([...PREFABS_BY_NAME.values()].filter((d) => d.model).map((d) => d.name)),
  },
];

/**
 * Vorgabe der Vorauswahl. Hier stand 'Beech1' — eine Buche aus dem
 * Valheim-Export, die es seit Block A nicht mehr gibt. Die hohe Birke ist
 * der nächstliegende Ersatz: derselbe Zweck (ein Laubbaum zum
 * Ausprobieren) und der erste Eintrag von EIGENE_MODELLE, also das, was
 * die Liste beim Öffnen ohnehin ganz oben zeigt.
 */
const VORGABE_PREFAB = 'BirkeHoch1';

/**
 * Vorauswahl der letzten Sitzung — aber nur, wenn sie noch ins Spiel
 * gehört.
 *
 * Jeder Browser, der den Editor vor Block A offen hatte, trägt einen
 * Valheim-Namen in localStorage. Gesetzt bekäme man ihn zwar nicht (der
 * Platzier-Modus wird erst durch den Klick auf eine Listenzeile scharf,
 * und gesperrte Zeilen nehmen keinen Klick mehr an), aber er stünde in
 * der Fußzeile als „Vorauswahl: Beech1" — eine Angabe, die die Liste
 * darunter nirgends bestätigt.
 */
function vorauswahl(): string {
  const gemerkt = localStorage.getItem('wov-editor-spawn-prefab');
  return gemerkt !== null && istEigenesModell(gemerkt) ? gemerkt : VORGABE_PREFAB;
}

export class SpawnPanel {
  /** Wird bei jeder Änderung von Wahl/Modus gerufen — main.ts gleicht den Geist ab. */
  aufWahl: (() => void) | null = null;
  /**
   * Platzier-Modus: erst der BEWUSSTE Klick auf einen Listeneintrag schaltet
   * ihn scharf. Ohne ihn ist `einstellung.prefab` reine Vorauswahl (aus
   * localStorage) — sonst hinge nach jedem Laden sofort ein Geist an der
   * Maus und jeder Klick in die Welt setzte ungewollt ein Objekt.
   */
  private modusAktiv = false;
  readonly einstellung: SpawnEinstellung = {
    prefab: vorauswahl(),
    yaw: null,
    abstand: 4,
    scale: 1,
    // Einebnen ist eine BEWUSSTE Entscheidung und startet immer AUS. Der
    // erste Anlauf (Vorgabe AN ab 8 m renderScale-Breite) griff daneben:
    // Die Breite misst z. B. bei Bäumen die KRONE, und weil erst der Klick
    // auf den Listeneintrag den Platzier-Modus scharf schaltet, überschrieb
    // die Vorgabe dabei jede Handabwahl — der Boden wurde trotz
    // abgewähltem Haken planiert.
    einebnen: false,
  };
  private readonly root: HTMLDivElement;
  private readonly liste: HTMLDivElement;
  /** Zeile unter der Liste: wie viel der Kategorie gesperrt ist. */
  private readonly gesperrtZeile: HTMLDivElement;
  private readonly zaehler: HTMLDivElement;
  private suchtext = '';
  private kategorie = 0;
  // ── NPC-Felder (nur bei NPC-Prefabs sichtbar, s. npcAktualisiere) ──
  private readonly npcBlock: HTMLDivElement;
  private readonly npcName: HTMLInputElement;
  private readonly npcRolle: HTMLSelectElement;
  private readonly npcFraktion: HTMLSelectElement;
  private readonly npcStufe: HTMLInputElement;
  private readonly npcQuest: HTMLSelectElement;
  private readonly npcQuestZeile: HTMLDivElement;
  /** Prefab der Platzierung, die die Felder gerade zeigen ('' = keine). */
  private npcPrefab = '';
  /** Läuft der Tageszyklus gerade, oder steht er auf einem festen Wert? */
  private zeitAngehalten = false;
  private laufKasten: HTMLInputElement | null = null;

  constructor(private readonly cb: SpawnPanelCallbacks) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;top:60px;right:12px;width:280px;max-height:80vh;overflow-y:auto;' +
      'background:rgba(18,22,31,0.94);border:1px solid #3a3325;border-radius:6px;padding:10px;' +
      'font-family:Georgia,serif;font-size:13px;color:#d8cfa8;z-index:900;display:none;';
    // ── Kein Durchfallen ins Spiel ───────────────────────────────────
    // Klicks und Rad im Panel gehören ausschließlich dem Panel: Die
    // Spiel-Handler hängen auf window/document (Platzieren bei gefangener
    // Maus in main.ts, Kamera-Zoom im InputManager) und würden im Bubbling
    // sonst mitlaufen — der Auswahl-Klick dürfte dann selbst setzen bzw.
    // das Rad die Kamera zoomen statt die Liste zu scrollen.
    // pointerup/mouseup bleiben bewusst frei: Ein Drag, der auf dem Canvas
    // beginnt und über dem Panel endet, muss sein window-pointerup noch
    // bekommen (sonst klebt die gegriffene Platzierung an der Maus).
    for (const typ of ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel'] as const) {
      this.root.addEventListener(typ, (e) => e.stopPropagation());
    }
    this.root.addEventListener('contextmenu', (e) => {
      // Rechtsklick im Panel: weder Browser-Menü noch das „Verwerfen" des Spiels.
      e.preventDefault();
      e.stopPropagation();
    });
    const titel = document.createElement('div');
    titel.textContent = '✦ Spawn-Editor';
    titel.style.cssText = 'font-size:15px;color:#e8d48a;margin-bottom:6px;';
    this.root.appendChild(titel);

    // Kategorie + Suche
    const kat = document.createElement('select');
    kat.style.cssText = this.feldStil();
    KATEGORIEN.forEach((k, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = k.name;
      kat.appendChild(o);
    });
    kat.onchange = () => {
      this.kategorie = Number(kat.value);
      this.listeFuellen();
    };
    this.root.appendChild(kat);

    const suche = document.createElement('input');
    suche.placeholder = 'Suchen … (z. B. birke, fels, grab)';
    suche.style.cssText = this.feldStil();
    let sucheTimer: number | null = null;
    suche.oninput = () => {
      this.suchtext = suche.value.trim().toLowerCase();
      if (sucheTimer !== null) window.clearTimeout(sucheTimer);
      sucheTimer = window.setTimeout(() => this.listeFuellen(), 150);
    };
    this.root.appendChild(suche);

    this.liste = document.createElement('div');
    // overscroll-behavior: Am Listenende soll das Rad nicht ans Panel/die
    // Seite weiterreichen — sonst „springt" beim Durchscrollen der Prefabs
    // plötzlich das ganze Panel.
    this.liste.style.cssText =
      'max-height:220px;overflow-y:auto;overscroll-behavior:contain;' +
      'border:1px solid #3a3325;border-radius:4px;margin:4px 0;';
    this.root.appendChild(this.liste);

    // Die Quote gehört UNTER den Kasten, nicht hinein: Im Kasten wäre sie
    // eine Zeile unter 80 und beim ersten Scrollen weg — gefragt wird sie
    // aber genau dann, wenn man auf die grauen Zeilen schaut.
    this.gesperrtZeile = document.createElement('div');
    this.gesperrtZeile.style.cssText = 'font-size:10px;color:#9a8f6a;margin:-2px 0 2px;';
    this.root.appendChild(this.gesperrtZeile);

    // Drehung
    this.root.appendChild(this.label('Drehung'));
    const drehZeile = document.createElement('div');
    drehZeile.style.cssText = 'display:flex;gap:6px;align-items:center;';
    const dreh = document.createElement('input');
    dreh.type = 'range';
    dreh.min = '0';
    dreh.max = '360';
    dreh.value = '0';
    dreh.style.cssText = 'flex:1;';
    const drehWert = document.createElement('span');
    drehWert.textContent = 'zufällig';
    drehWert.style.cssText = 'width:58px;font-size:11px;';
    const zufall = document.createElement('input');
    zufall.type = 'checkbox';
    zufall.checked = true;
    const drehAktualisieren = (): void => {
      this.einstellung.yaw = zufall.checked ? null : (Number(dreh.value) * Math.PI) / 180;
      drehWert.textContent = zufall.checked ? 'zufällig' : `${dreh.value}°`;
    };
    dreh.oninput = () => {
      zufall.checked = false;
      drehAktualisieren();
    };
    zufall.onchange = drehAktualisieren;
    drehZeile.append(dreh, drehWert, zufall);
    this.root.appendChild(drehZeile);

    // Abstand + Größe
    this.root.appendChild(this.schieber('Abstand (m)', 2, 20, 4, 1, (v) => (this.einstellung.abstand = v)));
    this.root.appendChild(this.schieber('Größe', 0.2, 3, 1, 0.1, (v) => (this.einstellung.scale = v)));

    // ── Untergrund einebnen ──────────────────────────────────────────
    // Rein manuell: Der Haken gilt für die folgenden Platzierungen der
    // Sitzung und wird von der Prefab-Wahl NICHT angefasst — keine
    // Automatik, die eine Handabwahl übersteuern könnte (s. einstellung).
    const sockelZeile = document.createElement('div');
    sockelZeile.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:6px;';
    const sockel = document.createElement('input');
    sockel.type = 'checkbox';
    sockel.checked = this.einstellung.einebnen;
    sockel.onchange = () => (this.einstellung.einebnen = sockel.checked);
    const sockelTxt = document.createElement('span');
    sockelTxt.textContent = 'Untergrund einebnen (manuell, für große Bauwerke)';
    sockelTxt.style.cssText = 'font-size:11px;color:#9a8f6a;';
    sockelZeile.append(sockel, sockelTxt);
    this.root.appendChild(sockelZeile);

    // ── NPC: Name, Rolle, Fraktion, Stufe, Quest ─────────────────────
    // Der ganze Block ist ausgeblendet, solange keine FIGUR gewählt ist
    // (istNpcPrefab) — bei Bäumen und Steinen wären fünf zusätzliche
    // Felder nur Wegstrecke zwischen Liste und „Platzieren".
    this.npcBlock = document.createElement('div');
    this.npcBlock.style.cssText =
      'display:none;margin-top:8px;padding-top:6px;border-top:1px solid #3a3325;';
    const npcTitel = document.createElement('div');
    npcTitel.textContent = '👤 Figur (gewählte Platzierung)';
    npcTitel.style.cssText = 'font-size:12px;color:#e8d48a;margin-bottom:2px;';
    this.npcBlock.appendChild(npcTitel);

    this.npcBlock.appendChild(this.label('Name'));
    this.npcName = document.createElement('input');
    this.npcName.maxLength = NPC_NAME_MAX;
    this.npcName.style.cssText = this.feldStil();
    // `change` statt `input`: Bei jedem Tastenanschlag zu speichern hiesse,
    // die Platzierung im Entwurf und die Instanz in der Welt buchstabenweise
    // neu zu schreiben. Der Fokusverlust bzw. Enter genügt.
    this.npcName.onchange = () => this.npcSchreiben();
    this.npcBlock.appendChild(this.npcName);

    this.npcRolle = this.npcAuswahl('Rolle', NPC_ROLLEN, ROLLE_TEXT);
    this.npcFraktion = this.npcAuswahl('Fraktion', FRAKTIONEN, FRAKTION_TEXT);

    this.npcBlock.appendChild(this.label('Stufe'));
    this.npcStufe = document.createElement('input');
    this.npcStufe.type = 'number';
    this.npcStufe.min = String(NPC_STUFE_MIN);
    this.npcStufe.max = String(NPC_STUFE_MAX);
    this.npcStufe.step = '1';
    this.npcStufe.value = '1';
    this.npcStufe.style.cssText = this.feldStil();
    this.npcStufe.onchange = () => this.npcSchreiben();
    this.npcBlock.appendChild(this.npcStufe);

    // Quest-Zustand nur bei Rolle `quest`: Ein Händler mit „Quest läuft"
    // wäre eine Angabe, die nirgends gelesen wird (s. questZeichen).
    this.npcQuestZeile = document.createElement('div');
    this.npcQuestZeile.style.cssText = 'display:none;';
    this.npcQuestZeile.appendChild(this.label('Quest-Zustand'));
    this.npcQuest = document.createElement('select');
    this.npcQuest.style.cssText = this.feldStil();
    for (const q of QUEST_ZUSTAENDE) {
      const o = document.createElement('option');
      o.value = q;
      o.textContent = QUEST_TEXT[q] ?? q;
      this.npcQuest.appendChild(o);
    }
    this.npcQuest.onchange = () => this.npcSchreiben();
    this.npcQuestZeile.appendChild(this.npcQuest);
    this.npcBlock.appendChild(this.npcQuestZeile);

    const npcTip = document.createElement('div');
    npcTip.style.cssText = 'font-size:10px;color:#9a8f6a;margin-top:4px;';
    npcTip.textContent =
      'Leer gelassene Felder erben die Vorgabe des Prefabs. Andere Figur bearbeiten: in der Welt anklicken.';
    this.npcBlock.appendChild(npcTip);
    this.root.appendChild(this.npcBlock);

    // ── Tageszeit ────────────────────────────────────────────────────
    // Am Regler zu ziehen hält den Zyklus an: Wer eine Szene bei
    // Sonnenuntergang beurteilen will, hat sonst zwei Minuten, bevor es
    // Nacht ist (ein Weltentag dauert 30 Minuten).
    if (this.cb.setzeZeit) {
      this.zeitAngehalten = false;
      const start = Math.round((this.cb.zeit?.() ?? 12) * 10) / 10;
      this.root.appendChild(
        this.schieber('Tageszeit (h)', 0, 24, start, 0.25, (v) => {
          this.zeitAngehalten = true;
          this.cb.setzeZeit?.(v, true);
          if (this.laufKasten) this.laufKasten.checked = false;
        })
      );
      const zeile = document.createElement('div');
      zeile.style.cssText = 'display:flex;gap:6px;align-items:center;margin:-4px 0 6px;';
      const kasten = document.createElement('input');
      kasten.type = 'checkbox';
      kasten.checked = true;
      kasten.onchange = () => {
        this.zeitAngehalten = !kasten.checked;
        this.cb.setzeZeit?.(this.cb.zeit?.() ?? 12, this.zeitAngehalten);
      };
      this.laufKasten = kasten;
      const txt = document.createElement('span');
      txt.textContent = 'Zeit läuft weiter';
      txt.style.cssText = 'font-size:11px;color:#9a8f6a;';
      zeile.append(kasten, txt);
      this.root.appendChild(zeile);
    }

    // Aktionen
    const aktionen = document.createElement('div');
    aktionen.style.cssText = 'display:flex;gap:6px;margin-top:8px;';
    aktionen.appendChild(this.knopf('Platzieren (P)', () => this.cb.platzieren()));
    aktionen.appendChild(this.knopf('↩ Letztes weg', () => {
      this.cb.entferneLetztes();
      this.aktualisiere();
    }));
    this.root.appendChild(aktionen);

    this.zaehler = document.createElement('div');
    this.zaehler.style.cssText = 'font-size:11px;color:#9a8f6a;margin-top:6px;';
    this.root.appendChild(this.zaehler);

    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:10px;color:#9a8f6a;margin-top:4px;';
    tip.textContent =
      'Eintrag anklicken startet die Platzierung (Geist an der Maus). Klick/P setzt einmal ' +
      'und beendet sie; für ein weiteres Exemplar den Eintrag erneut anklicken. ' +
      'Abbruch: erneuter Klick, Esc oder Rechtsklick.';
    this.root.appendChild(tip);

    document.body.appendChild(this.root);
    this.listeFuellen();
  }

  private feldStil(): string {
    return 'width:100%;background:#0d1420;color:#d8cfa8;border:1px solid #3a3325;padding:4px;margin:2px 0;box-sizing:border-box;';
  }

  private label(text: string): HTMLDivElement {
    const l = document.createElement('div');
    l.textContent = text;
    l.style.cssText = 'font-size:11px;color:#9a8f6a;margin-top:6px;';
    return l;
  }

  private knopf(text: string, cb: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText =
      'flex:1;padding:6px;background:#1d2431;color:#d8cfa8;border:1px solid #3a3325;border-radius:4px;cursor:pointer;font-family:inherit;';
    b.onclick = () => {
      cb();
      // Fokus sofort abgeben: Ein fokussierter Knopf feuert später auf
      // Enter/Leertaste ERNEUT — auch wenn das Menü längst zu ist.
      b.blur();
    };
    return b;
  }

  private schieber(
    name: string,
    min: number,
    max: number,
    start: number,
    schritt: number,
    setz: (v: number) => void
  ): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.appendChild(this.label(name));
    const zeile = document.createElement('div');
    zeile.style.cssText = 'display:flex;gap:6px;align-items:center;';
    const s = document.createElement('input');
    s.type = 'range';
    s.min = String(min);
    s.max = String(max);
    s.step = String(schritt);
    s.value = String(start);
    s.style.cssText = 'flex:1;';
    const wert = document.createElement('span');
    wert.textContent = String(start);
    wert.style.cssText = 'width:36px;font-size:11px;';
    s.oninput = () => {
      setz(Number(s.value));
      wert.textContent = s.value;
    };
    zeile.append(s, wert);
    wrap.appendChild(zeile);
    return wrap;
  }

  /** Beschriftetes Auswahlfeld im NPC-Block (Rolle, Fraktion). */
  private npcAuswahl(
    name: string,
    werte: readonly string[],
    texte: Readonly<Record<string, string>>
  ): HTMLSelectElement {
    this.npcBlock.appendChild(this.label(name));
    const s = document.createElement('select');
    s.style.cssText = this.feldStil();
    for (const w of werte) {
      const o = document.createElement('option');
      o.value = w;
      // Fällt auf den rohen Wert zurück: Wächst FRAKTIONEN um einen
      // Eintrag, steht er sofort zur Wahl — auch ohne Anzeigetext.
      o.textContent = texte[w] ?? w;
      s.appendChild(o);
    }
    s.onchange = () => this.npcSchreiben();
    this.npcBlock.appendChild(s);
    return s;
  }

  /**
   * Felder auf die gewählte Platzierung stellen (oder den Block ausblenden).
   *
   * Gezeigt wird der AUFGELÖSTE Zustand — also das, was auch am
   * Namensschild steht: Was die Platzierung nicht selbst sagt, kommt aus
   * der Prefab-Vorgabe. Der Name bleibt als Platzhalter stehen statt im
   * Feld, damit man sieht, was geerbt und was gesetzt ist.
   */
  private npcAktualisiere(): void {
    const ziel = this.cb.gewaehlteNpc?.() ?? null;
    if (!ziel || !istNpcPrefab(ziel.prefab)) {
      this.npcBlock.style.display = 'none';
      this.npcPrefab = '';
      return;
    }
    const ist = loeseNpcAuf(ziel.prefab, ziel.npc);
    const vorgabe = loeseNpcAuf(ziel.prefab);
    if (!ist || !vorgabe) return;
    this.npcPrefab = ziel.prefab;
    this.npcBlock.style.display = 'block';
    this.npcName.value = ziel.npc?.name ?? '';
    this.npcName.placeholder = vorgabe.name;
    this.npcRolle.value = ist.rolle;
    this.npcFraktion.value = ist.fraktion;
    this.npcStufe.value = String(ist.stufe);
    this.npcQuest.value = ist.quest;
    this.npcQuestZeile.style.display = ist.rolle === 'quest' ? 'block' : 'none';
  }

  /**
   * Felder → Entwurf. Gespeichert wird nur, was von der Prefab-Vorgabe
   * ABWEICHT (s. PlacementDef.npc): Wer nichts umstellt, bekommt keinen
   * `npc`-Block ins Dokument, und eine spätere Änderung an NPC_VORGABEN
   * schlägt auf alle Platzierungen durch, die sie nicht ausdrücklich
   * übersteuern.
   */
  private npcSchreiben(): void {
    if (!this.npcPrefab || !this.cb.setzeNpc) return;
    const vorgabe = loeseNpcAuf(this.npcPrefab);
    if (!vorgabe) return;
    const def: {
      name?: string;
      rolle?: NpcRolle;
      fraktion?: Fraktion;
      stufe?: number;
      quest?: QuestZustand;
    } = {};
    const name = this.npcName.value.trim().slice(0, NPC_NAME_MAX);
    if (name.length > 0 && name !== vorgabe.name) def.name = name;
    const rolle = this.npcRolle.value as NpcRolle;
    if (rolle !== vorgabe.rolle) def.rolle = rolle;
    const fraktion = this.npcFraktion.value as Fraktion;
    if (fraktion !== vorgabe.fraktion) def.fraktion = fraktion;
    const stufe = Math.min(
      NPC_STUFE_MAX,
      Math.max(NPC_STUFE_MIN, Math.round(Number(this.npcStufe.value) || vorgabe.stufe))
    );
    this.npcStufe.value = String(stufe);
    if (stufe !== vorgabe.stufe) def.stufe = stufe;
    // Ohne Quest-Rolle wird der Zustand gar nicht erst geschrieben.
    const quest = this.npcQuest.value as QuestZustand;
    if (rolle === 'quest' && quest !== vorgabe.quest) def.quest = quest;
    this.npcQuestZeile.style.display = rolle === 'quest' ? 'block' : 'none';
    this.cb.setzeNpc(Object.keys(def).length > 0 ? def : undefined);
  }

  private listeFuellen(): void {
    this.liste.innerHTML = '';
    const alle = KATEGORIEN[this.kategorie]!.namen();
    const gefiltert = this.suchtext
      ? alle.filter((n) => n.toLowerCase().includes(this.suchtext))
      : alle;
    const treffer = gefiltert.slice(0, 80);
    for (const name of treffer) {
      // Gesperrt heißt: kein eigenes Modell, also nichts, was in der Welt
      // stehen darf. Die Zeile bleibt trotzdem, nur grau und ohne Klick —
      // s. Kopf der Datei.
      const gesperrt = !istEigenesModell(name);
      const zeile = document.createElement('div');
      zeile.textContent = gesperrt ? `${name} — kein eigenes Modell` : name;
      // Zwei Markierungen: kräftig hinterlegt = Platzier-Modus AKTIV,
      // nur Randstreifen = bloße Vorauswahl (localStorage) ohne Modus.
      const gewaehlt = name === this.einstellung.prefab;
      zeile.style.cssText = gesperrt
        ? 'padding:2px 6px;cursor:not-allowed;color:#6f664e;'
        : 'padding:2px 6px;cursor:pointer;' +
          (gewaehlt
            ? this.modusAktiv
              ? 'background:#243044;color:#e8d48a;'
              : 'color:#e8d48a;border-left:2px solid #6a5d35;padding-left:4px;'
            : '');
      if (gesperrt) {
        // Der Grund im Klartext, an der Zeile selbst — sonst bleibt nur
        // die Vermutung, der Editor sei kaputt.
        zeile.title =
          `${name} steht nicht in EIGENE_MODELLE (shared/src/prefabs.ts) und gehört seit ` +
          'Block A nicht mehr in die Welt: Der Client hat kein Modell dafür, und ' +
          'pruefeLayout weist die Platzierung beim Start des Servers ab.';
        this.liste.appendChild(zeile);
        continue;
      }
      zeile.onclick = () => {
        if (this.modusAktiv && name === this.einstellung.prefab) {
          // Zweiter Klick auf den aktiven Eintrag = Abwahl: Der Modus
          // endet, die Vorauswahl bleibt bestehen.
          this.modusAktiv = false;
        } else {
          this.modusAktiv = true;
          this.einstellung.prefab = name;
          localStorage.setItem('wov-editor-spawn-prefab', name);
          // Den Einebnen-Haken bewusst NICHT anfassen: Dieser Klick schaltet
          // den Platzier-Modus scharf — eine Vorgabe an dieser Stelle hat
          // jede Handabwahl direkt vor dem Setzen wieder überschrieben.
        }
        this.aufWahl?.();
        this.listeFuellen();
      };
      this.liste.appendChild(zeile);
    }
    const gesamt = gefiltert.length;
    if (gesamt > treffer.length) {
      const mehr = document.createElement('div');
      mehr.textContent = `… und ${gesamt - treffer.length} weitere — Suche verfeinern`;
      mehr.style.cssText = 'padding:2px 6px;color:#9a8f6a;font-style:italic;';
      this.liste.appendChild(mehr);
    }
    if (treffer.length === 0) {
      const leer = document.createElement('div');
      leer.textContent = 'keine Treffer';
      leer.style.cssText = 'padding:4px 6px;color:#9a8f6a;';
      this.liste.appendChild(leer);
    }
    const gesperrtGesamt = gefiltert.filter((n) => !istEigenesModell(n)).length;
    this.gesperrtZeile.textContent =
      gesperrtGesamt === 0
        ? ''
        : `${gesperrtGesamt} von ${gesamt} ohne eigenes Modell — grau, nicht platzierbar.`;
  }

  aktualisiere(): void {
    // Die NPC-Felder hängen an der AUSWAHL, und die ändert sich genau
    // dann, wenn das hier gerufen wird (Greifen, Setzen, Löschen).
    this.npcAktualisiere();
    this.zaehler.textContent =
      `${this.cb.anzahl()} Platzierung(en) im Entwurf — ` +
      (this.modusAktiv
        ? `platziert: ${this.einstellung.prefab}`
        : `Vorauswahl: ${this.einstellung.prefab} (Klick in der Liste aktiviert)`);
  }

  /** Nur im aktiven Modus darf irgendein Pfad (Klick, P, Knopf) setzen. */
  get istPlatzierModus(): boolean {
    return this.modusAktiv;
  }

  /** Modus beenden (Esc, Rechtsklick, Abwahl) — die Vorauswahl bleibt. */
  beendePlatzierModus(): void {
    if (!this.modusAktiv) return;
    this.modusAktiv = false;
    this.aufWahl?.(); // main.ts räumt darüber den Geist an der Maus ab
    this.listeFuellen();
  }

  toggle(): boolean {
    const sichtbar = this.root.style.display === 'none';
    this.root.style.display = sichtbar ? 'block' : 'none';
    if (sichtbar) this.aktualisiere();
    return sichtbar;
  }

  get istOffen(): boolean {
    return this.root.style.display !== 'none';
  }
}
