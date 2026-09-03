/**
 * BLEIBT — Grundlage des Connector-Modul-Kits (DG_StoneVault),
 * Entscheidung 03.09.2026, s. `LEGACY.md`. / STAYS — the basis of the
 * connector module kit (DG_StoneVault), decision 2026-09-03, see
 * `LEGACY.md`. Baut ueber Connectors;
 * steht neben `client/src/editor/dungeon2/` (design/ARCHITECTURE.md
 * §1.1/§1.2, neue Betriebsart 'dungeon2' neben 'dungeons'). Siehe
 * `LEGACY.md`.
 * Builds over connectors; stands beside `client/src/editor/dungeon2/`
 * (design/ARCHITECTURE.md §1.1/§1.2, new mode 'dungeon2' next to
 * 'dungeons'). See `LEGACY.md`.
 *
 * DungeonEditor (Phase G) — In-Game-Editor für Dungeon-Dokumente.
 *
 * Bedienung: F4 in einer Dungeon-Instanz öffnet das Panel (Admin). Das
 * Dokument kommt per DungeonEditRequest vom Server; Änderungen laufen
 * LOKAL auf einer Kopie (Raum anfügen an offene Connectors, Raum
 * entfernen). Erst "Speichern" schickt das Dokument zurück — der Server
 * sanitisiert, persistiert, materialisiert die Instanz neu und teleportiert
 * den Spieler wieder hinein, sodass die Änderung sofort im Spiel steht.
 *
 * Bewusst kein eigener Ghost-Preview-Renderer: die Instanz selbst IST die
 * Vorschau (Speichern ⇒ Neuaufbau), was den Editor auf reine Dokument-
 * Operationen aus shared/dungeonGenerator.ts (attachRoom, removeRoom,
 * computeOpenConnections) reduziert — dieselben Funktionen, die auch
 * Server und Generator benutzen.
 *
 * Gestaltung wie SettingsPanel (dunkles Leder, Bronzerand, Serifen).
 */
import {
  DUNGEONS_BY_NAME,
  MAX_DUNGEON_PROPS,
  attachRoom,
  computeOpenConnections,
  removeRoom,
  type DungeonDocument,
  type OpenConnection,
} from '@wov/shared';

/**
 * Wie lange nach dem letzten Setzen gewartet wird, bevor gespeichert wird
 * (ms).
 *
 * Ohne diese Pause ginge bei zwanzig Fackeln zwanzigmal ein Dokument über
 * die Leitung, und der Server schriebe zwanzigmal eine Datei. Mit ihr wird
 * aus einer Reihe schnell gesetzter Fackeln EIN Speichervorgang, und wer
 * einzeln setzt, merkt von der Pause nichts.
 */
const SPEICHER_VERZUG_MS = 800;

/** Höhe über dem Spielerfuss, auf der eine Wandfackel sitzt (m). */
const DEKO_HOEHE_M = 1.8;
/**
 * Wie weit vor dem Spieler die Deko landet (m).
 *
 * Der Editor kennt keinen Strahlentest — er ist bewusst ein reiner
 * Dokument-Editor (s. Kopfkommentar). 1,2 m ist die Armlänge zur Wand:
 * Wer sich vor eine stellt und setzt, trifft sie. Wer daneben steht,
 * korrigiert und setzt neu; das kostet zwei Klicks und keine zweite
 * Physik-Welt im Editor.
 */
const DEKO_ABSTAND_M = 1.2;

export interface DungeonEditorCallbacks {
  /** Dokument vom Server anfordern ('' = aktueller Dungeon). */
  anfordern(dungeonId: string): void;
  /** Dokument speichern (JSON). */
  speichern(json: string): void;
  /** Admin-Kommandozeile (regen etc.). */
  admin(line: string): void;
  /** Kurzmeldung im HUD. */
  meldung(text: string): void;
  /**
   * Wo der Spieler steht und wohin er sieht — Ursprung jeder gesetzten
   * Deko.
   *
   * Der Editor fragt beim Klick und merkt sich nichts: Die Position ändert
   * sich zwischen Öffnen des Panels und dem Setzen ständig, und ein
   * gemerkter Wert wäre genau der, an dem die Fackel dann NICHT landet.
   */
  spielerPose(): { x: number; y: number; z: number; yaw: number } | null;
  /**
   * In den freien Platzierungsmodus wechseln: Panel zu, Geist ans
   * Fadenkreuz, Linksklick setzt (s. `DekoPlatzierung`).
   *
   * Das Panel gibt hier die Kontrolle ab und bekommt das Ergebnis über
   * `dekoAusWelt` zurück. Es könnte den Modus auch selbst führen — aber
   * dann bräuchte es Szene, Physik und Kamera, und ein DOM-Panel, das
   * Strahlen schiesst, ist der Anfang vom Ende der Trennung.
   */
  freiSetzen(prefab: string): void;
}

export class DungeonEditor {
  private readonly root: HTMLDivElement;
  private visible = false;
  private doc: DungeonDocument | null = null;
  private offene: OpenConnection[] = [];

  // UI-Elemente, die bei jedem Dokumentstand neu gefüllt werden
  private kopf!: HTMLDivElement;
  private raumListe!: HTMLDivElement;
  private connWahl!: HTMLSelectElement;
  private raumWahl!: HTMLSelectElement;
  private ausrichtungWahl!: HTMLSelectElement;
  private dekoWahl!: HTMLSelectElement;
  private dekoListe!: HTMLDivElement;
  private speicherTimer: ReturnType<typeof setTimeout> | null = null;
  private idFeld!: HTMLInputElement;
  private seedFeld!: HTMLInputElement;
  private status!: HTMLDivElement;

  constructor(private readonly cb: DungeonEditorCallbacks) {
    const root = document.createElement('div');
    root.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:1000',
      'display:none', 'align-items:center', 'justify-content:center',
      'background:rgba(10,8,4,.55)', 'font-family:Georgia,"Times New Roman",serif',
    ].join(';');
    root.addEventListener('click', (e) => {
      if (e.target === root) this.hide();
    });

    const panel = document.createElement('div');
    panel.style.cssText = [
      'width:min(560px,94vw)', 'max-height:86vh', 'overflow-y:auto',
      'background:linear-gradient(180deg,#3a2f22,#241c14)',
      'border:2px solid #8a6a34', 'border-radius:6px',
      'box-shadow:0 12px 40px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,220,150,.08)',
      'padding:20px 24px 16px', 'color:#e8d9b8',
    ].join(';');
    root.appendChild(panel);

    const title = document.createElement('div');
    title.textContent = 'Dungeon-Editor';
    title.style.cssText =
      'font-size:22px;letter-spacing:.06em;color:#f2c86a;text-align:center;margin-bottom:4px;text-shadow:0 1px 2px #000';
    panel.appendChild(title);

    this.kopf = document.createElement('div');
    this.kopf.style.cssText =
      'font-size:13px;color:#a8916a;text-align:center;margin-bottom:14px';
    this.kopf.textContent = 'Kein Dokument geladen';
    panel.appendChild(this.kopf);

    // ── Räume ────────────────────────────────────────────────────────
    panel.appendChild(this.abschnitt('Räume'));
    this.raumListe = document.createElement('div');
    this.raumListe.style.cssText =
      'max-height:180px;overflow-y:auto;border:1px solid #5a4626;border-radius:4px;' +
      'padding:4px 6px;margin-bottom:14px;font-size:13px;background:rgba(0,0,0,.25)';
    panel.appendChild(this.raumListe);

    // ── Anfügen ──────────────────────────────────────────────────────
    panel.appendChild(this.abschnitt('Raum anfügen'));
    const anfuegen = document.createElement('div');
    anfuegen.style.cssText = 'display:flex;gap:8px;margin-bottom:14px;align-items:center;flex-wrap:wrap';
    this.connWahl = document.createElement('select');
    this.connWahl.style.cssText = this.selectStil() + ';flex:1 1 180px';
    this.raumWahl = document.createElement('select');
    this.raumWahl.style.cssText = this.selectStil() + ';flex:1 1 180px';
    // Ausrichtung: WELCHE Kante des gewählten Raums an der offenen Kante
    // hängt. Ohne dieses Feld nimmt `attachRoom` den ersten kollisionsfreien
    // eigenen Connector — bei einer Zelle mit vier gleichwertigen Kanten
    // entscheidet dann die Reihenfolge in `eigeneDungeons.ts`, in welche
    // Richtung ein Gang weiterläuft, und der Mensch am Panel hat keine
    // Handhabe. Die Liste hängt an BEIDEN anderen Feldern (der Typ des
    // offenen Connectors filtert, der Raum liefert die Kanten) und wird
    // deshalb bei jeder Änderung neu gefüllt.
    this.ausrichtungWahl = document.createElement('select');
    this.ausrichtungWahl.style.cssText = this.selectStil() + ';flex:1 1 150px';
    this.ausrichtungWahl.title = 'Ausrichtung: welche Kante des neuen Raums andockt';
    this.connWahl.addEventListener('change', () => this.ausrichtungenFuellen());
    this.raumWahl.addEventListener('change', () => this.ausrichtungenFuellen());
    const anfBtn = this.knopf('Anfügen', () => this.anfuegen());
    const tuerBtn = this.knopf('Tür setzen', () => this.tuerSetzen());
    anfuegen.appendChild(this.connWahl);
    anfuegen.appendChild(this.raumWahl);
    anfuegen.appendChild(this.ausrichtungWahl);
    anfuegen.appendChild(anfBtn);
    anfuegen.appendChild(tuerBtn);
    panel.appendChild(anfuegen);

    // ── Deko ─────────────────────────────────────────────────────────
    panel.appendChild(this.abschnitt('Deko setzen'));
    const deko = document.createElement('div');
    deko.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center;flex-wrap:wrap';
    this.dekoWahl = document.createElement('select');
    this.dekoWahl.style.cssText = this.selectStil() + ';flex:1 1 200px';
    deko.appendChild(this.dekoWahl);
    deko.appendChild(this.knopf('Hier setzen', () => this.dekoSetzen()));
    deko.appendChild(
      this.knopf('Frei setzen', () => {
        const wahl = this.dekoWahl.value;
        if (!wahl) {
          this.status.textContent = 'Kein Deko-Teil gewählt';
          return;
        }
        this.hide();
        this.cb.freiSetzen(wahl);
      })
    );
    panel.appendChild(deko);

    this.dekoListe = document.createElement('div');
    this.dekoListe.style.cssText =
      'max-height:140px;overflow-y:auto;border:1px solid #5a4626;border-radius:4px;' +
      'padding:4px 6px;margin-bottom:14px;font-size:13px;background:rgba(0,0,0,.25)';
    panel.appendChild(this.dekoListe);

    // ── Aktionen ─────────────────────────────────────────────────────
    panel.appendChild(this.abschnitt('Aktionen'));
    const aktionen = document.createElement('div');
    aktionen.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center';

    aktionen.appendChild(this.knopf('Speichern', () => this.speichern(null)));

    this.idFeld = document.createElement('input');
    this.idFeld.placeholder = 'neue-id';
    this.idFeld.style.cssText = this.selectStil() + ';width:130px';
    aktionen.appendChild(this.idFeld);
    aktionen.appendChild(this.knopf('Speichern als', () => this.speichern(this.idFeld.value.trim())));

    this.seedFeld = document.createElement('input');
    this.seedFeld.placeholder = 'Seed';
    this.seedFeld.style.cssText = this.selectStil() + ';width:80px';
    aktionen.appendChild(this.seedFeld);
    aktionen.appendChild(
      this.knopf('Neu generieren', () => {
        if (!this.doc) return;
        const seed = this.seedFeld.value.trim();
        this.cb.admin(`dungeon regen ${this.doc.id}${seed ? ` ${seed}` : ''}`);
        // Neu laden + Instanz neu betreten, sobald der Server fertig ist.
        setTimeout(() => {
          this.cb.admin(`dungeon enter ${this.doc!.id}`);
          this.cb.anfordern(this.doc!.id);
        }, 500);
      })
    );

    aktionen.appendChild(this.knopf('Schließen', () => this.hide()));
    panel.appendChild(aktionen);

    this.status = document.createElement('div');
    this.status.style.cssText = 'font-size:12px;color:#a8916a;min-height:16px';
    panel.appendChild(this.status);

    document.body.appendChild(root);
    this.root = root;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Panel öffnen und das aktuelle Dokument anfordern. */
  show(): void {
    this.visible = true;
    this.root.style.display = 'flex';
    this.status.textContent = 'Lade Dokument…';
    this.cb.anfordern('');
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
  }

  toggle(): boolean {
    if (this.visible) this.hide();
    else this.show();
    return this.visible;
  }

  /** Antwort des Servers (DungeonEditData) einspielen. */
  empfangen(ok: boolean, message: string, json: string): void {
    if (!ok) {
      this.status.textContent = message;
      this.cb.meldung(message);
      return;
    }
    if (json) {
      try {
        this.doc = JSON.parse(json) as DungeonDocument;
      } catch {
        this.status.textContent = 'Antwort unlesbar';
        return;
      }
      this.aktualisieren();
    }
    this.status.textContent = message;
  }

  // ── interne Operationen ────────────────────────────────────────────

  private anfuegen(): void {
    if (!this.doc) return;
    const conn = this.offene[Number(this.connWahl.value)];
    const raum = this.raumWahl.value;
    if (!conn || !raum) return;
    // Leerer Wert = „automatisch": kein Index, also genau das alte
    // Verhalten (erster kollisionsfreier Connector). Der Unterschied muss
    // `undefined` sein und nicht etwa −1 — `attachRoom` unterscheidet
    // „nicht gesetzt" von „gesetzt, aber unpassend" und meldet Letzteres
    // als Fehler.
    const wahl = this.ausrichtungWahl.value;
    const connIndex = wahl === '' ? undefined : Number(wahl);
    const result = attachRoom(this.doc.layout, this.doc.base, conn, raum, connIndex);
    if (!result.ok) {
      this.status.textContent = result.reason;
      return;
    }
    this.doc.layout.rooms.push(result.placed);
    this.doc.mode = 'custom';
    this.aktualisieren();
    this.status.textContent = `${raum} angefügt (ungespeichert)`;
  }

  /** Tür/Gitter am gewählten offenen Connector platzieren. */
  private tuerSetzen(): void {
    const doc = this.doc;
    if (!doc) return;
    const conn = this.offene[Number(this.connWahl.value)];
    if (!conn) return;
    const def = DUNGEONS_BY_NAME.get(doc.base);
    const passend = def?.doorTypes.filter((t) => t.connectionType === conn.type) ?? [];
    const tuer = passend[0] ?? def?.doorTypes[0];
    if (!tuer) {
      this.status.textContent = `${doc.base} hat keine Türtypen`;
      return;
    }
    const belegt = doc.layout.doors.some(
      (d) => (d.pos.x - conn.pos.x) ** 2 + (d.pos.y - conn.pos.y) ** 2 + (d.pos.z - conn.pos.z) ** 2 < 0.09
    );
    if (belegt) {
      this.status.textContent = 'Hier steht schon eine Tür';
      return;
    }
    doc.layout.doors.push({
      prefabName: tuer.prefabName,
      prefabHash: tuer.prefabHash,
      pos: { ...conn.pos },
      rot: { ...conn.rot },
    });
    doc.mode = 'custom';
    this.aktualisieren();
    this.status.textContent = `${tuer.prefabName} gesetzt (ungespeichert)`;
  }

  private entfernen(index: number): void {
    if (!this.doc) return;
    const result = removeRoom(this.doc.layout, this.doc.base, index);
    if (!result.ok) {
      this.status.textContent = result.reason ?? 'Entfernen fehlgeschlagen';
      return;
    }
    this.doc.mode = 'custom';
    this.aktualisieren();
    this.status.textContent = 'Raum entfernt (ungespeichert)';
  }

  /**
   * Deko dort setzen, wo der Spieler steht — genauer: eine Armlänge vor
   * ihm, auf Kopfhöhe, ihm zugewandt.
   *
   * Die Drehung ist die des Spielers plus 180°: Wer eine Wandfackel setzt,
   * steht vor der Wand und sieht sie an; die Fackel soll zurückschauen.
   */
  private dekoSetzen(): void {
    const doc = this.doc;
    if (!doc) return;
    const def = DUNGEONS_BY_NAME.get(doc.base);
    const typ = (def?.propTypes ?? []).find((p) => p.prefabName === this.dekoWahl.value);
    if (!typ) {
      this.status.textContent = 'Kein Deko-Teil gewählt';
      return;
    }
    if (doc.layout.props.length >= MAX_DUNGEON_PROPS) {
      this.status.textContent = `Grenze erreicht (${MAX_DUNGEON_PROPS})`;
      return;
    }
    const pose = this.cb.spielerPose();
    if (!pose) {
      this.status.textContent = 'Spielerposition unbekannt';
      return;
    }

    // Blickrichtung aus dem Gierwinkel. Die Konvention steht in
    // `PlayerController`: „increasing yaw sweeps forward from -Z towards
    // -X" — bei yaw 0 sieht die Figur nach -z, bei 90 Grad nach -x. Daraus
    // folgt das MINUS. Mit Plus landete die Deko hinter dem Spieler, und
    // das merkt man erst, wenn man sich umdreht.
    const pos = {
      x: pose.x - Math.sin(pose.yaw) * DEKO_ABSTAND_M,
      y: pose.y + DEKO_HOEHE_M,
      z: pose.z - Math.cos(pose.yaw) * DEKO_ABSTAND_M,
    };
    // Die halbe Drehung dazu: Wer vor einer Wand steht und sie ansieht,
    // hat den Rücken zum Raum — die Fackel soll andersherum stehen.
    // Nachgerechnet an der +x-Wand: Der Spieler steht dort auf Gierwinkel
    // 270, die Fackel braucht 90, und 270 + 180 = 90. Die 90 sind kein
    // Überschlag, sondern gemessen: Von den vier Vierteldrehungen sitzt im
    // Prüfstand genau diese flach an der Wand.
    const halb = (pose.yaw + Math.PI) / 2;

    doc.layout.props.push({
      prefabName: typ.prefabName,
      prefabHash: typ.prefabHash,
      pos,
      rot: { x: 0, y: Math.sin(halb), z: 0, w: Math.cos(halb) },
      roomIndex: this.naechsterRaum(pos),
    });
    this.status.textContent =
      `${typ.label ?? typ.prefabName} gesetzt (ungespeichert) — ` +
      `${doc.layout.props.length} Stück`;
    this.aktualisieren();
  }

  /**
   * Deko übernehmen, die im Spiel gesetzt wurde.
   *
   * Die Koordinaten kommen aus der WELT der Instanz und wandern
   * unverändert ins Dokument. Das ist erst seit dem Umbau auf eigene
   * Instanzwelten richtig: Vorher lag eine Instanz bei x ≈ 100.000, und
   * hier hätte ein Abzug des Instanz-Ursprungs stehen müssen — mit dem
   * float32-Fehler, den man sich dort einhandelt.
   */
  dekoAusWelt(prefab: string, pos: { x: number; y: number; z: number }, yawGrad: number): void {
    const doc = this.doc;
    if (!doc) return;
    const def = DUNGEONS_BY_NAME.get(doc.base);
    const typ = (def?.propTypes ?? []).find((p) => p.prefabName === prefab);
    if (!typ) return;
    if (doc.layout.props.length >= MAX_DUNGEON_PROPS) {
      this.cb.meldung(`Grenze erreicht (${MAX_DUNGEON_PROPS})`);
      return;
    }
    const halb = (yawGrad * Math.PI) / 360;
    doc.layout.props.push({
      prefabName: typ.prefabName,
      prefabHash: typ.prefabHash,
      pos: { ...pos },
      rot: { x: 0, y: Math.sin(halb), z: 0, w: Math.cos(halb) },
      roomIndex: this.naechsterRaum(pos),
    });
    this.cb.meldung(`${typ.label ?? typ.prefabName} gesetzt (${doc.layout.props.length})`);
    this.aktualisieren();
    this.baldSpeichern();
  }

  /**
   * Speichern anstossen, aber erst wenn eine Weile nichts mehr gesetzt
   * wurde.
   *
   * Der Server lässt die Instanz stehen, solange sich nur Deko geändert hat
   * (`upsertDocument`, `instanzErhalten`) — es gibt also weder Abriss noch
   * Teleport. Das ist die Voraussetzung dafür, dass Setzen überhaupt
   * automatisch speichern DARF.
   */
  private baldSpeichern(): void {
    if (this.speicherTimer !== null) clearTimeout(this.speicherTimer);
    this.speicherTimer = setTimeout(() => {
      this.speicherTimer = null;
      if (!this.doc) return;
      this.cb.speichern(JSON.stringify(this.doc));
      this.cb.meldung('Deko gespeichert');
    }, SPEICHER_VERZUG_MS);
  }

  /**
   * Nächstgelegener Raum zu einem Punkt.
   *
   * Er entscheidet nur, was beim Entfernen dieses Raums mitgeht — ein
   * Fehlgriff kostet eine Fackel, keinen Absturz.
   */
  private naechsterRaum(pos: { x: number; z: number }): number {
    const doc = this.doc;
    if (!doc) return -1;
    let index = -1;
    let beste = Infinity;
    doc.layout.rooms.forEach((r, i) => {
      const d = (r.pos.x - pos.x) ** 2 + (r.pos.z - pos.z) ** 2;
      if (d < beste) {
        beste = d;
        index = i;
      }
    });
    return index;
  }

  private dekoEntfernen(index: number): void {
    const doc = this.doc;
    if (!doc) return;
    doc.layout.props.splice(index, 1);
    this.status.textContent = 'Deko entfernt';
    this.aktualisieren();
    this.baldSpeichern();
  }

  private speichern(alsId: string | null): void {
    if (!this.doc) return;
    const doc = { ...this.doc, layout: this.doc.layout };
    if (alsId) {
      doc.id = alsId.toLowerCase();
      doc.name = alsId;
      doc.mode = 'custom';
    }
    this.status.textContent = 'Speichere…';
    this.cb.speichern(JSON.stringify(doc));
  }

  /** UI aus dem aktuellen Dokumentstand neu füllen. */
  private aktualisieren(): void {
    const doc = this.doc;
    if (!doc) return;
    this.kopf.textContent =
      `${doc.id} — Basis ${doc.base}, ${doc.mode}, Seed ${doc.seed}, ` +
      `${doc.layout.rooms.length} Räume, ${doc.layout.doors.length} Türen, ` +
      `${doc.layout.props.length} Deko`;

    // Raumliste
    this.raumListe.textContent = '';
    doc.layout.rooms.forEach((r, i) => {
      const zeile = document.createElement('div');
      zeile.style.cssText =
        'display:flex;justify-content:space-between;align-items:center;padding:1px 2px';
      const label = document.createElement('span');
      label.textContent = `${i}: ${r.room} (${r.pos.x.toFixed(0)},${r.pos.y.toFixed(0)},${r.pos.z.toFixed(0)})`;
      zeile.appendChild(label);
      if (i > 0) {
        const del = document.createElement('button');
        del.textContent = '✕';
        del.title = 'Raum entfernen';
        del.style.cssText =
          'background:none;border:1px solid #8a6a34;color:#e8d9b8;border-radius:3px;' +
          'cursor:pointer;font-size:11px;padding:0 6px';
        del.addEventListener('click', () => this.entfernen(i));
        zeile.appendChild(del);
      }
      this.raumListe.appendChild(zeile);
    });

    // Offene Connectors
    this.offene = computeOpenConnections(doc.layout, doc.base);
    this.connWahl.textContent = '';
    this.offene.forEach((c, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      const raumName = doc.layout.rooms[c.roomIndex]?.room ?? '?';
      opt.textContent = `${raumName}#${c.roomIndex}/${c.connIndex}${c.type ? ` [${c.type}]` : ''}`;
      this.connWahl.appendChild(opt);
    });

    // Deko-Katalog und gesetzte Deko.
    //
    // Der Katalog kommt aus `propTypes` des Kits — derselben Liste, gegen
    // die der Server sanitisiert. Aus einer Quelle, damit hier nichts
    // angeboten wird, was beim Speichern stillschweigend verschwindet.
    const basis = DUNGEONS_BY_NAME.get(doc.base);
    const gewaehlt = this.dekoWahl.value;
    this.dekoWahl.textContent = '';
    for (const p of basis?.propTypes ?? []) {
      const opt = document.createElement('option');
      opt.value = p.prefabName;
      opt.textContent = p.label ?? p.prefabName;
      this.dekoWahl.appendChild(opt);
    }
    if (gewaehlt) this.dekoWahl.value = gewaehlt;

    this.dekoListe.textContent = '';
    if (doc.layout.props.length === 0) {
      const leer = document.createElement('div');
      leer.style.cssText = 'color:#8a7350;padding:2px';
      leer.textContent = basis?.propTypes?.length
        ? 'Noch nichts gesetzt.'
        : 'Dieses Kit kennt keine setzbare Deko.';
      this.dekoListe.appendChild(leer);
    }
    doc.layout.props.forEach((p, i) => {
      const zeile = document.createElement('div');
      zeile.style.cssText =
        'display:flex;justify-content:space-between;align-items:center;padding:1px 2px';
      const label = document.createElement('span');
      label.textContent =
        `${i}: ${p.prefabName} (${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)},${p.pos.z.toFixed(1)})` +
        (p.roomIndex >= 0 ? ` → Raum ${p.roomIndex}` : '');
      zeile.appendChild(label);
      const del = document.createElement('button');
      del.textContent = '✕';
      del.title = 'Deko entfernen';
      del.style.cssText =
        'background:none;border:1px solid #8a6a34;color:#e8d9b8;border-radius:3px;' +
        'cursor:pointer;font-size:11px;padding:0 6px';
      del.addEventListener('click', () => this.dekoEntfernen(i));
      zeile.appendChild(del);
      this.dekoListe.appendChild(zeile);
    });

    // Raum-Palette der Basis (Endcaps ans Ende sortiert), in zwei Gruppen:
    // erst die begehbaren Zellen, dann die Abschlüsse. Die Sortierung tat
    // das schon; die Zwischenüberschriften sagen nur laut, wo die Grenze
    // liegt — bei einem Kit mit einem Dutzend Wandvarianten ist das der
    // Unterschied zwischen Suchen und Sehen.
    //
    // Die getroffene Wahl wird über das Neufüllen gerettet: `aktualisieren`
    // läuft nach JEDEM Anfügen, und wer eine Gangkette baut, will nicht
    // nach jedem Klick denselben Raum neu heraussuchen.
    const def = DUNGEONS_BY_NAME.get(doc.base);
    const gewaehlterRaum = this.raumWahl.value;
    this.raumWahl.textContent = '';
    if (def) {
      const rooms = [...def.rooms].sort((a, b) => Number(a.endCap) - Number(b.endCap));
      let gruppe: HTMLOptGroupElement | null = null;
      let gruppeIstEndCap: boolean | null = null;
      for (const r of rooms) {
        if (gruppeIstEndCap !== !!r.endCap) {
          gruppeIstEndCap = !!r.endCap;
          gruppe = document.createElement('optgroup');
          gruppe.label = gruppeIstEndCap ? 'Abschlüsse' : 'Zellen';
          this.raumWahl.appendChild(gruppe);
        }
        const opt = document.createElement('option');
        opt.value = r.name;
        opt.textContent = `${r.name}${r.endCap ? ' (Endcap)' : ''}${r.entrance ? ' (Eingang)' : ''}`;
        (gruppe ?? this.raumWahl).appendChild(opt);
      }
      if (gewaehlterRaum) this.raumWahl.value = gewaehlterRaum;
    }

    this.ausrichtungenFuellen();
  }

  /**
   * Das Feld „Ausrichtung" neu füllen — die Kanten des gewählten Raums,
   * gefiltert auf den Typ des gewählten offenen Connectors.
   *
   * Der Filter ist kein Komfort, sondern die Bedingung: `attachRoom` weist
   * einen Index mit falschem Connector-Typ ab. Was hier steht, ist genau
   * das, was dort auch durchgeht.
   *
   * „automatisch" bleibt der erste Eintrag und damit die Vorgabe — wer das
   * Feld nicht anfasst, baut wie vor dieser Erweiterung.
   */
  private ausrichtungenFuellen(): void {
    const vorher = this.ausrichtungWahl.value;
    this.ausrichtungWahl.textContent = '';
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = 'automatisch';
    this.ausrichtungWahl.appendChild(auto);

    const doc = this.doc;
    if (!doc) return;
    const conn = this.offene[Number(this.connWahl.value)];
    const raum = DUNGEONS_BY_NAME.get(doc.base)?.rooms.find((r) => r.name === this.raumWahl.value);
    if (!conn || !raum) return;

    raum.connections.forEach((c, i) => {
      if (c.type !== conn.type) return;
      const opt = document.createElement('option');
      opt.value = String(i);
      // Der Index steht mit in der Beschriftung, weil eine Zelle zwei
      // Kanten auf DERSELBEN Seite haben kann (z. B. die Doppelzelle mit
      // je zwei Ost- und West-Kanten) — zwei Einträge „Ost" wären sonst
      // nicht auseinanderzuhalten.
      const name = this.kantenName(c.localPos, i);
      opt.textContent = name.startsWith('Kante') ? name : `${name} #${i}`;
      this.ausrichtungWahl.appendChild(opt);
    });
    // Die alte Wahl nur zurücksetzen, wenn sie noch angeboten wird; sonst
    // bleibt „automatisch" stehen, statt still auf eine fremde Kante zu
    // zeigen.
    if (vorher) this.ausrichtungWahl.value = vorher;
  }

  /**
   * Himmelsrichtung einer Kante aus ihrer lokalen Position — +z Nord,
   * −z Süd, +x Ost, −x West (die Bezeichnungen, die auch in
   * `eigeneDungeons.ts` an den Connectors stehen).
   *
   * Entschieden wird über die DOMINANTE Achse: eine Kante bei
   * (x 2, z 1) liegt im Osten, auch wenn sie nach Norden versetzt sitzt.
   * Ist keine Achse dominant (beide gleich gross, etwa bei einer Diagonale
   * oder bei (0,0)), gibt es keine ehrliche Antwort — dann heisst die
   * Kante schlicht nach ihrem Index.
   */
  private kantenName(localPos: { x: number; z: number }, index: number): string {
    const ax = Math.abs(localPos.x);
    const az = Math.abs(localPos.z);
    if (ax > az) return localPos.x > 0 ? 'Ost' : 'West';
    if (az > ax) return localPos.z > 0 ? 'Nord' : 'Süd';
    return `Kante ${index}`;
  }

  // ── Stil-Helfer ────────────────────────────────────────────────────

  private abschnitt(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText =
      'font-size:13px;letter-spacing:.08em;color:#a8916a;margin-bottom:6px;text-transform:uppercase';
    return el;
  }

  private knopf(text: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText =
      'background:linear-gradient(180deg,#5a4626,#3a2f22);border:1px solid #8a6a34;' +
      'color:#f2c86a;border-radius:4px;cursor:pointer;font-family:inherit;' +
      'font-size:13px;padding:5px 12px';
    btn.addEventListener('click', onClick);
    return btn;
  }

  private selectStil(): string {
    return (
      'background:#241c14;border:1px solid #8a6a34;color:#e8d9b8;border-radius:4px;' +
      'font-family:inherit;font-size:13px;padding:4px 6px'
    );
  }
}
