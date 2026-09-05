/**
 * Das Formular „Neuer Saal" im Reiter „Dungeons" (E8).
 *
 * Vier Zahlen — Breite, Tiefe, Pfeilerraster, Gewicht —, ein Knopf, und
 * der Spielserver baut ein GLB, trägt es in die Registry ein und meldet
 * Dreiecke und Masse zurück. Ohne `npm run build`, ohne Deploy, ohne
 * Blender. Der Bauweg selbst steht seit E5 in
 * `server/src/world/dungeon/ModuleBuild.ts`; hier steht nur die
 * Bedienung dazu.
 *
 * ── Warum das Formular eine eigene Datei ist ─────────────────────────
 * Dieselbe Begründung, mit der `DungeonKatalog.ts` seinerzeit aus
 * `editorMain.ts` herausgelöst wurde: Der Katalog hat 1 200 Zeilen, und
 * dieses Formular hat mit dem geöffneten Dokument nichts zu tun. Es
 * steht auch dann da, wenn gar kein Grab offen ist — einen Saal zu bauen
 * ist ein eigener Arbeitsgang, kein Schritt am Dokument.
 *
 * ── Warum es dieselben Klemmen benutzt wie der Server ────────────────
 * `moduleRegistry.pruefeMasse` und `pruefeDreiecke` sind dieselben
 * Funktionen, die `baueModul` aufruft. Das Formular schreibt sie NICHT
 * nach. Zwei Klemmenlisten für dieselbe Sache laufen auseinander, sobald
 * eine angefasst wird — und die im Browser wäre die, die zu viel
 * erlaubt: Der Benutzer wartet dann zehn Sekunden auf eine Absage, die
 * aus vier Zahlen sofort ableitbar war. Umgekehrt ist die Vorabprüfung
 * KEIN Ersatz für die des Servers; sie erspart nur den Weg.
 *
 * ── Warum die Erlaubnis über die ServerConfig kommt ──────────────────
 * `dungeons.modulbau` steht in der `server.yml`, und die erreicht einen
 * Client genau einmal: beim Anmelden, im Flagbyte des
 * `ServerConfig`-Pakets (`shared/src/serverConfigFlags.ts`). Nachgesehen
 * statt angenommen — bis E8 bekam eine Editor-Verbindung dieses Paket
 * gar nicht, weil `onPeerAuthenticated` beim `nurEditor`-Zweig davor
 * ausstieg. Deshalb wanderte dort der Zweig nach unten.
 *
 * ── Warum die Erlaubnisfrage eine EIGENE, kurze Verbindung ist ───────
 * Der Editor soll ohne Spielserver benutzbar bleiben (Kopf von
 * `DungeonSpeichern.ts`). Die Frage „darf ich bauen?" wird deshalb
 * genauso beantwortet wie das Speichern: verbinden, eine Antwort
 * abwarten, trennen. Fällt sie aus — kein Server, keine Anmeldung, kein
 * Admin —, ist die Antwort „nein", und das Formular bleibt weg. Das ist
 * der richtige Ausgang: Ein Formular, das ohne Server dasteht, verspricht
 * einen Weg, den es nicht gibt.
 *
 * ── Und die Rückseite: die Saal-Liste (E9) ──────────────────────────
 * Unter dem Formular steht, was schon gebaut ist — mit einem Knopf „Saal
 * löschen" je Zeile. Sie steht HIER und nicht im Katalog daneben, weil
 * sie dieselbe Erlaubnis, dieselbe Registry und denselben kurzen
 * Verbindungsweg braucht wie das Bauen; im Katalog wäre sie ein zweiter
 * Ort, der dasselbe Tor noch einmal abfragte.
 *
 * Zwei Dinge entscheidet der Server, nicht diese Datei: ob gelöscht
 * werden darf (zwei Tore) und ob der Saal noch benutzt wird (Durchgang
 * über alle Dokumente auf der Platte). Eine Frage kann der Server
 * dagegen NICHT beantworten — ob das GERADE GEÖFFNETE, noch nicht
 * gespeicherte Dokument den Saal benutzt. Es liegt nicht auf der Platte.
 * Deshalb sperrt die Liste diese Zeile selbst.
 *
 * The "new hall" form: four numbers, one button, the game server builds
 * the GLB. Shares its clamps with the server and asks for permission via
 * the ServerConfig flag byte. E9 adds the list of built halls below it,
 * with a delete button per row.
 */
import { PacketType, moduleBuildAllowed, moduleRegistry } from '@wov/shared';
import { GameSocket, type BinaryReader } from '../net/GameSocket';
import { abschnitt, auswahl, feld, hinweis, knopf, zeile } from './dungeonWidgets';

/** Wartezeit auf Verbindung bzw. Antwort — wie beim Speichern. */
const FRIST_MS = 10_000;
/** Vorgaben des Formulars: ein 4x3-Saal mit dem Standardraster. */
const VORGABE = { cellsX: 4, cellsZ: 3, raster: 2, weight: 1 } as const;

/**
 * Was der Server über den gebauten Saal meldet — die Felder, die das
 * Formular anzeigt. Ausschnitt aus `ModulBauErgebnis` (E5); als eigener
 * Typ, weil `client/` nicht aus `server/` importieren darf und ein
 * geteilter Typ in `shared` ein Paket-Schema festschriebe, das absichtlich
 * als JSON reist.
 */
export interface HallBuildInfo {
  readonly name: string;
  readonly tris: number;
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
}

export interface HallBuildAnswer {
  readonly ok: boolean;
  /** Die Meldung des Servers, wörtlich — auch im Fehlerfall. */
  readonly message: string;
  readonly info?: HallBuildInfo;
}

/** Der Bauweg. Einspeisbar, damit ihn der DOM-Test ohne Netz fahren kann. */
export type HallBuilder = (wish: moduleRegistry.ModulBauWunsch) => Promise<HallBuildAnswer>;

/**
 * Eine kurze Verbindung aufmachen, EIN Paket abwarten, wieder trennen.
 *
 * Beide Netzwege dieses Moduls sehen gleich aus: verbinden, senden,
 * genau eine Antwort oder eine Frist. Sie stehen deshalb in einer
 * Funktion — zwei Kopien liefen bei der nächsten Änderung an der
 * Fehlerbehandlung auseinander, und das Auffälligste daran wäre, dass
 * einer der beiden Wege bei Serverabbruch stumm bliebe.
 *
 * @param antwortTyp Der Pakettyp, auf den gewartet wird.
 * @param lies Liest die Antwort aus dem Paket.
 * @param sende Was gesendet wird, sobald die Verbindung steht. Fehlt es,
 *   wird nur zugehört — so fragt die Erlaubnisprobe.
 */
function eineAntwort<T>(
  antwortTyp: PacketType,
  lies: (reader: BinaryReader) => T,
  beiAbbruch: (grund: string) => T,
  sende?: (socket: GameSocket) => void
): Promise<T> {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // Dritter Parameter `nurEditor`: Ohne ihn legte jeder Klick einen
  // Phantom-Charakter in der Welt an und würfe einen offenen Spielclient
  // hinaus (gemessen 28.08.2026, s. Kopf von `DungeonSpeichern.ts`).
  const socket = new GameSocket(`${proto}://${location.host}/ws`, 'Editor', true);

  return new Promise<T>((fertig) => {
    let erledigt = false;
    const ende = (e: T): void => {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(uhr);
      socket.onDisconnected = null;
      socket.disconnect();
      fertig(e);
    };
    const uhr = setTimeout(
      () => ende(beiAbbruch(`Keine Antwort vom Spielserver (${FRIST_MS / 1000} s)`)),
      FRIST_MS
    );
    socket.on(antwortTyp, (reader) => ende(lies(reader)));
    socket.onConnected = () => sende?.(socket);
    socket.onDisconnected = (grund) =>
      ende(beiAbbruch(grund ? `Verbindung beendet: ${grund}` : 'Verbindung beendet'));
    socket.connect();
  });
}

/**
 * Darf dieser Editor einen Saal bauen?
 *
 * Wirft nie. Jeder Ausgang ausser „Bit gesetzt" heisst nein: kein
 * Spielserver, kein Sitzungstoken, kein Admin, `dungeons.modulbau: false`
 * — für das Formular ist das alles dieselbe Antwort, und keine davon ist
 * ein Fehler, den man dem Benutzer als Fehler zeigen müsste.
 */
export async function fetchModuleBuildPermission(): Promise<boolean> {
  return eineAntwort<boolean>(
    PacketType.ServerConfig,
    (reader) => {
      // Aufbau des Pakets: worldName, worldSeed, worldGenVersion, flags.
      // Gelesen wird nur bis zum Flagbyte — dahinter steht nichts mehr.
      reader.readString();
      reader.readString();
      reader.readInt32();
      return moduleBuildAllowed(reader.readUInt8());
    },
    () => false
  );
}

/** Einen Saal bauen lassen. Wirft nicht; jeder Ausgang ist eine Antwort. */
export async function buildHallViaGameServer(
  wish: moduleRegistry.ModulBauWunsch
): Promise<HallBuildAnswer> {
  return eineAntwort<HallBuildAnswer>(
    PacketType.DungeonModulBauErgebnis,
    (reader) => {
      const ok = reader.readBool();
      const message = reader.readString();
      const json = reader.readString();
      let info: HallBuildInfo | undefined;
      try {
        info = json ? (JSON.parse(json) as HallBuildInfo) : undefined;
      } catch {
        info = undefined;
      }
      return { ok, message, info };
    },
    (grund) => ({ ok: false, message: grund }),
    (socket) => socket.sendDungeonModulBau(wish.cellsX, wish.cellsZ, wish.raster, wish.weight)
  );
}

/** Was der Server über den Löschgang meldet. */
export interface HallDeleteInfo {
  readonly name: string;
  readonly verbleibend: number;
}

export interface HallDeleteAnswer {
  readonly ok: boolean;
  readonly message: string;
  readonly info?: HallDeleteInfo;
}

/** Der Löschweg. Einspeisbar, damit ihn der DOM-Test ohne Netz fahren kann. */
export type HallDeleter = (name: string) => Promise<HallDeleteAnswer>;

/**
 * Einen gebauten Saal entfernen lassen. Wirft nicht; jeder Ausgang ist
 * eine Antwort — auch „kein Server".
 */
export async function deleteHallViaGameServer(name: string): Promise<HallDeleteAnswer> {
  return eineAntwort<HallDeleteAnswer>(
    PacketType.DungeonModulLoeschErgebnis,
    (reader) => {
      const ok = reader.readBool();
      const message = reader.readString();
      const json = reader.readString();
      let info: HallDeleteInfo | undefined;
      try {
        info = json ? (JSON.parse(json) as HallDeleteInfo) : undefined;
      } catch {
        info = undefined;
      }
      return { ok, message, info };
    },
    (grund) => ({ ok: false, message: grund }),
    (socket) => socket.sendDungeonModulLoeschen(name)
  );
}

/**
 * Der Abschnitt „Neuer Saal" in der Dungeon-Seitenleiste.
 *
 * ── Warum der Zustand an der Klasse hängt und nicht in den Feldern ───
 * Dieselbe Begründung wie bei „Neu anlegen" nebenan: `DungeonSeite.baue()`
 * wirft die ganze Leiste weg und legt sie neu an — nach jedem Anfügen,
 * jedem Klick auf einen Raum, jedem Speichern. Ein Wert, der nur im
 * Element stünde, wäre danach wieder auf der Vorgabe, und ein Formular,
 * das sich beim Tippen selbst leert, kann man nicht ausfüllen.
 */
export class NewHallForm {
  /** Darf gebaut werden? Bis die Probe antwortet: nein (s. Kopf). */
  private erlaubt = false;
  private breite = String(VORGABE.cellsX);
  private tiefe = String(VORGABE.cellsZ);
  private raster = String(VORGABE.raster);
  private gewicht = String(VORGABE.weight);
  private baut = false;
  /** Die letzte Antwort des Servers — sie überlebt den Neuaufbau. */
  private antwort: HallBuildAnswer | null = null;

  /**
   * Die Räume des GERADE GEÖFFNETEN Dokuments (E9).
   *
   * Der Server durchsucht beim Löschen die Dokumente auf der PLATTE. Ein
   * Grab, das im Editor offen und noch nicht gespeichert ist, steht dort
   * nicht — es ist die einzige Nutzung, die er nicht sehen kann. Deshalb
   * sperrt die Liste diese eine Zeile selbst.
   */
  private offeneRaeume: readonly string[] = [];
  /** Was in dieser Sitzung schon gelöscht wurde — die Zeile bleibt stehen. */
  private readonly geloescht = new Set<string>();
  /** Der Saal, dessen Löschgang gerade läuft. */
  private loescht: string | null = null;
  /** Die letzte Löschantwort des Servers, wörtlich. */
  private loeschAntwort: HallDeleteAnswer | null = null;

  constructor(
    private readonly neuAufbauen: () => void,
    private readonly bauer: HallBuilder = buildHallViaGameServer,
    private readonly loescher: HallDeleter = deleteHallViaGameServer
  ) {}

  setzeErlaubt(an: boolean): void {
    this.erlaubt = an;
  }

  /**
   * Welche Räume das offene Dokument benutzt — aus `DungeonSeite.baue()`.
   * Ohne Dokument eine leere Liste; dann sperrt nichts.
   */
  setzeOffeneRaeume(namen: readonly string[]): void {
    this.offeneRaeume = namen;
  }

  /**
   * Die vier Zahlen, so wie sie gerade in den Feldern stehen.
   *
   * `Number('')` ist 0 und fiele damit in die Klemme „ausserhalb 2…8" —
   * das ist die richtige Meldung für ein leeres Feld, nicht `NaN`.
   */
  private wunsch(): moduleRegistry.ModulBauWunsch {
    return {
      cellsX: Number(this.breite),
      cellsZ: Number(this.tiefe),
      raster: Number(this.raster),
      weight: Number(this.gewicht),
    };
  }

  /**
   * Was der Vorschautext sagt — und ob gebaut werden darf.
   *
   * Beides in einer Rechnung, weil es dieselbe Frage ist: Steht dort eine
   * Absage, ist der Knopf gesperrt. Ein gesperrter Knopf ohne sichtbaren
   * Grund wäre der schlechteste der drei möglichen Zustände.
   */
  private vorschau(): { text: string; absage: string | null } {
    const w = this.wunsch();
    const masse = moduleRegistry.pruefeMasse(w);
    if (masse) return { text: '', absage: masse };
    const tris = moduleRegistry.dreiecke(w.cellsX, w.cellsZ, w.raster);
    const name = moduleRegistry.modulName(w.cellsX, w.cellsZ, w.raster);
    const text =
      `${name} · ${moduleRegistry.hallSizeM(w.cellsX)} × ${moduleRegistry.hallSizeM(w.cellsZ)} m · ` +
      `${tris} Dreiecke`;
    return { text, absage: moduleRegistry.pruefeDreiecke(tris) };
  }

  /** Den Abschnitt in den Behälter hängen. Ohne Erlaubnis: gar nichts. */
  render(b: HTMLElement): void {
    if (!this.erlaubt) return;

    b.appendChild(abschnitt('Neuer Saal'));

    // ── Die beiden Zahlenfelder ──────────────────────────────────────
    //
    // Sie heissen „Modulzellen" und nicht „Zellen", und das ist keine
    // Wortklauberei: Zwei Felder weiter oben (Formular „Neu anlegen")
    // bedeutet „Zellen" die Zellzahl des GANZEN GRABES (G8). Hier ist es
    // die Kantenlänge EINES Moduls. Die Konzeptnotiz führt die
    // Verwechslung unter „Risiken" — und ein Formular, in dem dasselbe
    // Wort zweimal etwas anderes heisst, wird verwechselt.
    //
    // ── Warum die Eingabe NICHT die Leiste neu aufbaut ───────────────
    // `neuAufbauen()` wirft jedes Element weg und legt es neu an. An
    // einem `oninput` hiesse das: Nach jedem getippten Zeichen ist das
    // Feld ein ANDERES Element, und der Schreibmarke fehlt der Halt — man
    // könnte genau eine Ziffer eintippen. Der DOM-Stummel im Test merkt
    // davon nichts (er hat keinen Fokus), ein Browser sehr wohl.
    // Erneuert werden deshalb nur die zwei Stellen, die sich ändern:
    // Vorschauzeile und Knopf. `aktualisiere()` steht weiter unten, wo
    // beide schon existieren.
    const zahl = (wert: string, bei: (v: string) => void): HTMLInputElement => {
      const i = feld('', '60px');
      i.type = 'number';
      i.value = wert;
      i.oninput = () => {
        bei(i.value);
        aktualisiere();
      };
      return i;
    };
    b.appendChild(
      zeile(
        'Breite (Modulzellen)',
        zahl(this.breite, (v) => (this.breite = v)),
        'Tiefe (Modulzellen)',
        zahl(this.tiefe, (v) => (this.tiefe = v))
      )
    );

    // ── Pfeilerraster als AUSWAHL, nicht als Feld ────────────────────
    //
    // Erlaubt sind genau drei Werte (`RASTER_ERLAUBT`), und ein Feld, in
    // das man 3 tippen kann, ist ein Feld, in das man 3 tippt.
    const rw = auswahl();
    for (const r of moduleRegistry.RASTER_ERLAUBT) {
      const o = document.createElement('option');
      o.value = String(r);
      o.textContent = `Raster ${r} m`;
      if (String(r) === this.raster) o.selected = true;
      rw.appendChild(o);
    }
    rw.onchange = () => {
      this.raster = rw.value;
      aktualisiere();
    };
    const gw = feld('', '60px');
    gw.type = 'number';
    gw.step = '0.1';
    gw.min = String(moduleRegistry.GEWICHT_MIN);
    gw.max = String(moduleRegistry.GEWICHT_MAX);
    gw.value = this.gewicht;
    gw.oninput = () => {
      this.gewicht = gw.value;
      aktualisiere();
    };
    b.appendChild(zeile(rw, 'Gewicht', gw));

    // ── Vorschau und Knopf ───────────────────────────────────────────
    const zeigt = document.createElement('div');
    b.appendChild(zeigt);
    const bauKnopf = knopf('Saal bauen', () => {
      void this.baue();
    });
    b.appendChild(zeile(bauKnopf));

    /**
     * Vorschauzeile und Knopf auf den Stand der vier Felder bringen.
     *
     * Beides in EINER Funktion, weil es EINE Aussage ist: Was in der
     * Zeile steht, sperrt den Knopf. Ein gesperrter Knopf ohne sichtbaren
     * Grund wäre der schlechteste der drei möglichen Zustände.
     */
    const aktualisiere = (): void => {
      const { text, absage } = this.vorschau();
      zeigt.style.cssText = `font-size:12px;line-height:1.5;color:${absage ? '#c8a24a' : '#e8d9b8'}`;
      zeigt.textContent = absage ? `${text ? `${text} — ` : ''}${absage}` : text;
      const gesperrt = absage !== null || this.baut;
      bauKnopf.textContent = this.baut ? 'Baut …' : 'Saal bauen';
      bauKnopf.disabled = gesperrt;
      bauKnopf.style.opacity = gesperrt ? '.5' : '1';
    };
    aktualisiere();

    b.appendChild(
      hinweis(
        'Gebaut wird auf dem Spielserver; der muss dafür laufen. Der Name entsteht aus ' +
          'dem Mass und ist unveränderlich — ein geänderter Saal ist ein neuer Name ' +
          '(live liegen Assets sieben Tage im Browsercache). Das Gewicht wird ' +
          'mitgeschrieben, wirkt aber nicht: Gebaute Säle sind „nur manuell" und ' +
          'stehen nie in der Stempelauswahl des Generators.'
      )
    );

    // ── Die Antwort ──────────────────────────────────────────────────
    if (this.antwort) {
      const a = document.createElement('div');
      a.style.cssText = `font-size:12px;line-height:1.6;white-space:pre-line;color:${
        this.antwort.ok ? '#9ec888' : '#d08a6a'
      }`;
      const i = this.antwort.info;
      a.textContent =
        this.antwort.message +
        (this.antwort.ok && i
          ? `\n${i.tris} Dreiecke · ${i.sizeX} x ${i.sizeZ} m, Höhe ${i.sizeY} m`
          : '');
      b.appendChild(a);
      // Die beiden Wege NUR nach einem gelungenen Bau: Nach einer Absage
      // liegt nichts zum Nachladen bereit, und ein Hinweis „Seite neu
      // laden" wäre dann ein falscher Rat.
      if (this.antwort.ok) {
        b.appendChild(
          hinweis(
            'Seite neu laden, damit der Saal im Katalog steht — die Modulliste entsteht ' +
              'beim Aufbau der Seite. Auf live erst nach `tools/wov-update.sh --assets`: ' +
              'assets/ reist als eigenes tar und nicht mit `git pull`.'
          )
        );
      }
    }

    this.renderListe(b);
  }

  /**
   * Die Liste der gebauten Säle mit einem Knopf „Saal löschen" je Zeile.
   *
   * Gelesen wird `registeredModules()` — der Stand DIESER Seite, also
   * genau das, was der Katalog daneben anbietet. Nicht die Datei: Ein
   * Eintrag, den diese Seite nicht registrieren konnte, steht auch in
   * keinem Katalog, und ein Löschknopf für etwas Unsichtbares wäre ein
   * Versprechen ohne Deckung.
   */
  private renderListe(b: HTMLElement): void {
    const module = moduleRegistry.registeredModules();
    if (module.length === 0) {
      b.appendChild(hinweis('Gebaute Säle: noch keiner.'));
      return;
    }

    b.appendChild(abschnitt('Gebaute Säle'));
    for (const m of module) {
      const weg = this.geloescht.has(m.name);
      const imDokument = this.offeneRaeume.includes(m.name);
      const zeigt = document.createElement('span');
      zeigt.style.cssText = `font-size:12px;color:${weg ? '#8a7350' : '#e8d9b8'}`;
      zeigt.textContent =
        `${m.name} · ${moduleRegistry.hallSizeM(m.zellenX)} × ` +
        `${moduleRegistry.hallSizeM(m.zellenZ)} m · ${m.tris} Dreiecke` +
        `${weg ? ' — gelöscht' : ''}`;

      if (weg) {
        b.appendChild(zeile(zeigt));
        continue;
      }
      const k = knopf('Saal löschen', () => {
        void this.loesche(m.name);
      });
      // Gesperrt, solange dieser Saal im OFFENEN Dokument steht: Der
      // Server sieht nur die Platte, und ein ungespeichertes Grab liegt
      // nicht dort. Ohne diese Sperre wäre der Saal weg und das Dokument
      // verlöre seinen Raum beim nächsten Speichern — wortlos.
      const gesperrt = imDokument || this.loescht !== null;
      k.disabled = gesperrt;
      k.style.opacity = gesperrt ? '.5' : '1';
      if (this.loescht === m.name) k.textContent = 'Löscht …';
      b.appendChild(zeile(zeigt, k));
      if (imDokument) {
        b.appendChild(
          hinweis(
            `${m.name} steht im geöffneten Dokument — erst dort entfernen. Der Server ` +
              `durchsucht nur gespeicherte Dokumente.`
          )
        );
      }
    }

    if (this.loeschAntwort) {
      const a = document.createElement('div');
      a.style.cssText = `font-size:12px;line-height:1.6;white-space:pre-line;color:${
        this.loeschAntwort.ok ? '#9ec888' : '#d08a6a'
      }`;
      a.textContent = this.loeschAntwort.message;
      b.appendChild(a);
      if (this.loeschAntwort.ok) {
        b.appendChild(
          hinweis(
            'Seite neu laden — der Katalog dieser Seite kennt den Saal noch, und bis dahin ' +
              'lehnt der Server jedes Speichern mit „Registry veraltet" ab. Auf live ist die ' +
              'GLB-Datei erst nach `tools/wov-update.sh --assets` fort.'
          )
        );
      }
    }
  }

  /**
   * Einen Saal löschen lassen und die Antwort behalten.
   *
   * Der Saal wird hier NICHT aus den Nachschlagewerken dieser Seite
   * genommen, obwohl die Funktion dafür in `shared` steht. Der Grund ist
   * das offene Dokument: Es kann den Raum benutzen (der Server sieht nur
   * die Platte), und ein Grundriss, dem mitten in der Arbeit ein Raumtyp
   * unter den Füssen weggezogen wird, verlöre ihn beim nächsten
   * Zeichnen — wortlos. Der richtige Schnitt ist das Neuladen, und die
   * Prüfsumme aus E6 erzwingt es: Bis dahin lehnt der Server jedes
   * Speichern ab, statt ein Dokument mit gelöschtem Raum abzulegen.
   */
  private async loesche(name: string): Promise<void> {
    if (this.loescht !== null) return;
    // Derselbe Gurt wie beim Bauen: `disabled` ist eine Eigenschaft des
    // Elements, kein Riegel — ein Klick aus einem Skript käme durch.
    if (this.geloescht.has(name) || this.offeneRaeume.includes(name)) return;
    this.loescht = name;
    this.loeschAntwort = null;
    this.neuAufbauen();
    const antwort = await this.loescher(name);
    this.loescht = null;
    this.loeschAntwort = antwort;
    if (antwort.ok) this.geloescht.add(name);
    this.neuAufbauen();
  }

  /** Den Auftrag hinausschicken und die Antwort behalten. */
  private async baue(): Promise<void> {
    if (this.baut) return;
    // Der Gurt zur Vorabprüfung: Der Knopf ist in diesem Fall gesperrt,
    // aber `disabled` ist eine Eigenschaft des Elements und kein Riegel —
    // ein Klick aus einem Skript käme durch.
    if (this.vorschau().absage !== null) return;
    this.baut = true;
    this.antwort = null;
    this.neuAufbauen();
    this.antwort = await this.bauer(this.wunsch());
    this.baut = false;
    this.neuAufbauen();
  }
}
