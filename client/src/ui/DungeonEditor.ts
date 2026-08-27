/**
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
  private dekoWahl!: HTMLSelectElement;
  private dekoListe!: HTMLDivElement;
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
    const anfBtn = this.knopf('Anfügen', () => this.anfuegen());
    const tuerBtn = this.knopf('Tür setzen', () => this.tuerSetzen());
    anfuegen.appendChild(this.connWahl);
    anfuegen.appendChild(this.raumWahl);
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
    const result = attachRoom(this.doc.layout, this.doc.base, conn, raum);
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

    // Nächstgelegener Raum. Er entscheidet nur, was beim Entfernen dieses
    // Raums mitgeht — ein Fehlgriff kostet eine Fackel, keinen Absturz.
    let roomIndex = -1;
    let beste = Infinity;
    doc.layout.rooms.forEach((r, i) => {
      const d =
        (r.pos.x - pos.x) * (r.pos.x - pos.x) + (r.pos.z - pos.z) * (r.pos.z - pos.z);
      if (d < beste) {
        beste = d;
        roomIndex = i;
      }
    });

    doc.layout.props.push({
      prefabName: typ.prefabName,
      prefabHash: typ.prefabHash,
      pos,
      rot: { x: 0, y: Math.sin(halb), z: 0, w: Math.cos(halb) },
      roomIndex,
    });
    this.status.textContent =
      `${typ.label ?? typ.prefabName} gesetzt (ungespeichert) — ` +
      `${doc.layout.props.length} Stück`;
    this.aktualisieren();
  }

  private dekoEntfernen(index: number): void {
    const doc = this.doc;
    if (!doc) return;
    doc.layout.props.splice(index, 1);
    this.status.textContent = 'Deko entfernt (ungespeichert)';
    this.aktualisieren();
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

    // Raum-Palette der Basis (Endcaps ans Ende sortiert)
    const def = DUNGEONS_BY_NAME.get(doc.base);
    this.raumWahl.textContent = '';
    if (def) {
      const rooms = [...def.rooms].sort((a, b) => Number(a.endCap) - Number(b.endCap));
      for (const r of rooms) {
        const opt = document.createElement('option');
        opt.value = r.name;
        opt.textContent = `${r.name}${r.endCap ? ' (Endcap)' : ''}${r.entrance ? ' (Eingang)' : ''}`;
        this.raumWahl.appendChild(opt);
      }
    }
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
