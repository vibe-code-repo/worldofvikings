/**
 * Abgleich der getragenen Waffe mit dem Server (Kampfkern K2a).
 *
 * Der Server fuehrt die Waffe (`peer.waffe`); der Client zeigt sie sofort an
 * (optimistisch) und meldet die Wahl per Equip. Der Server antwortet mit
 * EquipStand — und der LETZTE Stand vom Server gewinnt immer: Passt er nicht
 * zur lokalen Anzeige, rollt der Client zurueck (Ablehnung, Waffe verschwunden,
 * Login). Ungefragte Staende gelten sofort und verwerfen eine noch nicht
 * gesendete Wahl.
 *
 * Schneller Wechsel: Gesendet wird erst nach RUHE_MS ohne neue Wahl, und nur
 * die letzte (Hotbar-Tasten 1-2-1-2 ergeben ein Equip, nicht vier; die Anzeige
 * bleibt trotzdem sofort). Solange ein Equip unterwegs ist, wird die Antwort
 * auf ein aelteres nicht angewendet (kein Flackern). Eine Antwort, die nie
 * kommt (die Server-Drossel verwirft ueberzaehlige Equip stumm), haelt den
 * Abgleich nicht fest: nach FRIST_MS gilt die Anfrage als verfallen, und die
 * Wahl wird erneut gesendet (hoechstens WIEDERHOLUNGEN mal).
 *
 * Bewusst ohne Babylon: nur die Schnittstelle, die Equipment schon hat.
 */
import type { ItemStack, AusruestungsSlot } from '@wov/shared';

export interface WaffenTraeger {
  readonly rightItem: ItemStack | null;
  onChanged(fn: () => void): () => void;
  equip(item: ItemStack, slot?: AusruestungsSlot): void;
  unequip(slot?: AusruestungsSlot): void;
}

/** Ruhezeit, bevor die letzte Wahl gesendet wird: unter der Reaktionsschwelle, ueber dem Tastenhaemmern (~8 Tasten/s). */
export const RUHE_MS = 120;
/** So lange wartet eine Anfrage auf ihre Antwort, dann verfaellt sie. */
export const FRIST_MS = 2000;
/** Wie oft eine unbeantwortete Wahl erneut gesendet wird. */
export const WIEDERHOLUNGEN = 2;

export interface AbgleichZeiten {
  ruheMs: number;
  fristMs: number;
}

export class WaffenAbgleich {
  /** Was der Server nach unserem Wissen traegt (letzter EquipStand). */
  private serverSicht = '';
  /** Zeitpunkte der gesendeten, noch nicht beantworteten Equip. */
  private offen: number[] = [];
  private begruesst = false;
  private anwenden = false;
  private ruheTimer: ReturnType<typeof setTimeout> | null = null;
  private fristTimer: ReturnType<typeof setTimeout> | null = null;
  private wiederholt = 0;
  private abmelden: (() => void) | null;

  constructor(
    private readonly traeger: WaffenTraeger,
    private readonly finde: (name: string) => ItemStack | null,
    private readonly sende: (slot: string, name: string) => void,
    private readonly zeiten: AbgleichZeiten = { ruheMs: RUHE_MS, fristMs: FRIST_MS }
  ) {
    this.abmelden = traeger.onChanged(() => this.lokalGeaendert());
  }

  /** Haengt den Abgleich vom Traeger ab (neue Verbindung baut einen neuen). */
  dispose(): void {
    this.abmelden?.();
    this.abmelden = null;
    this.stoppeRuhe();
    this.stoppeFrist();
    this.offen = [];
  }

  private get lokalerName(): string {
    return this.traeger.rightItem?.shared.name ?? '';
  }

  private stoppeRuhe(): void {
    if (this.ruheTimer) clearTimeout(this.ruheTimer);
    this.ruheTimer = null;
  }

  private stoppeFrist(): void {
    if (this.fristTimer) clearTimeout(this.fristTimer);
    this.fristTimer = null;
  }

  private lokalGeaendert(): void {
    if (this.anwenden) return;
    this.wiederholt = 0;
    this.stoppeRuhe();
    this.ruheTimer = setTimeout(() => {
      this.ruheTimer = null;
      this.senden();
    }, this.zeiten.ruheMs);
  }

  /** Die aktuelle lokale Wahl melden (falls der Server sie nicht schon so kennt). */
  private senden(): void {
    const name = this.lokalerName;
    if (name === this.serverSicht && this.offen.length === 0) return;
    this.offen.push(Date.now());
    this.sende('waffe', name);
    this.stoppeFrist();
    this.fristTimer = setTimeout(() => this.fristAbgelaufen(), this.zeiten.fristMs);
  }

  private fristAbgelaufen(): void {
    this.fristTimer = null;
    // Der Timer gehoert zur letzten Sendung: alles, was bis jetzt offen ist, ist verfallen.
    this.offen = [];
    if (this.ruheTimer) return;
    if (this.lokalerName !== this.serverSicht && this.wiederholt < WIEDERHOLUNGEN) {
      this.wiederholt++;
      this.senden();
    }
  }

  /** EquipStand vom Server. */
  stand(slot: string, name: string, aufAnfrage: boolean): void {
    if (slot !== 'waffe') return;
    this.serverSicht = name;
    // Verfallene Anfragen (Antwort blieb aus, z. B. Drossel) zaehlen nicht mehr als „unterwegs“.
    const grenze = Date.now() - this.zeiten.fristMs;
    this.offen = this.offen.filter((t) => t > grenze);
    if (aufAnfrage) this.offen.shift();
    else {
      // Ungefragt: der Server hat entschieden, eine noch nicht gesendete Wahl ist hinfaellig.
      this.stoppeRuhe();
    }
    // Antwort auf eine AELTERE Anfrage, waehrend eine neuere unterwegs oder in Ruhe ist: nicht anwenden.
    const neuerUnterwegs = aufAnfrage && (this.offen.length > 0 || this.ruheTimer !== null);
    if (!neuerUnterwegs) {
      if (this.offen.length === 0) this.stoppeFrist();
      if (name !== this.lokalerName) {
        this.anwenden = true;
        try {
          const item = name === '' ? null : this.finde(name);
          if (item) this.traeger.equip(item, 'waffe');
          else this.traeger.unequip('waffe');
        } finally {
          this.anwenden = false;
        }
      }
    }
    // Erste Meldung der Verbindung: das Equip sagt dem Server, dass dieser
    // Client Waffen ueber Equip fuehrt (dann zaehlt nicht mehr der Paketname).
    if (!this.begruesst) {
      this.begruesst = true;
      this.offen.push(Date.now());
      this.sende('waffe', this.serverSicht);
    }
  }
}

/**
 * Handler fuer PacketType.EquipStand. Der Abgleich entsteht mit dem ersten
 * Stand (dann gibt es Ausruestung und Inventar) und wird neu gebaut, wenn die
 * Ausruestung ausgetauscht wurde. Jeder Handler (eine Verbindung) loest bei
 * der Neuanlage den Abgleich der vorigen ab, sonst meldete nach einem
 * Reconnect jede Altinstanz die Wahl erneut.
 */
let aktiverAbgleich: WaffenAbgleich | null = null;

export function waffenStandHandler(
  traeger: () => WaffenTraeger | null,
  finde: (name: string) => ItemStack | null,
  sende: (slot: string, name: string) => void,
  zeiten?: AbgleichZeiten
): (reader: { readString(): string; readBool(): boolean }) => void {
  let abgleich: WaffenAbgleich | null = null;
  let fuer: WaffenTraeger | null = null;
  return (reader) => {
    const t = traeger();
    if (!t) return;
    if (!abgleich || fuer !== t) {
      aktiverAbgleich?.dispose();
      abgleich = aktiverAbgleich = new WaffenAbgleich(t, finde, sende, zeiten);
      fuer = t;
    }
    abgleich.stand(reader.readString(), reader.readString(), reader.readBool());
  };
}
