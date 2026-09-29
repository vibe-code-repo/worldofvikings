/**
 * Abgleich der getragenen Waffe mit dem Server (Kampfkern K2a).
 *
 * Der Server fuehrt die Waffe (`peer.waffe`); der Client zeigt sie sofort an
 * (optimistisch) und meldet jede Aenderung per Equip. Auf jedes Equip kommt
 * genau ein EquipStand zurueck: passt er nicht zur lokalen Anzeige, rollt der
 * Client zurueck (Ablehnung, Waffe verschwunden). Ungefragte Staende (Login,
 * Inventarabgleich) gelten ebenso.
 *
 * Wechselt der Spieler schneller, als Antworten kommen, sind mehrere Equip
 * unterwegs: Solange Antworten offen sind, wird kein Stand angewendet — die
 * letzte Antwort gewinnt, sonst flackerte die Anzeige zwischen den Waffen.
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

export class WaffenAbgleich {
  /** Was der Server nach unserem Wissen traegt (zuletzt gesendet oder gemeldet). */
  private serverSicht = '';
  private offeneAntworten = 0;
  private begruesst = false;
  private anwenden = false;

  constructor(
    private readonly traeger: WaffenTraeger,
    private readonly finde: (name: string) => ItemStack | null,
    private readonly sende: (slot: string, name: string) => void
  ) {
    traeger.onChanged(() => this.lokalGeaendert());
  }

  private get lokalerName(): string {
    return this.traeger.rightItem?.shared.name ?? '';
  }

  private lokalGeaendert(): void {
    if (this.anwenden) return;
    const name = this.lokalerName;
    if (name === this.serverSicht) return;
    this.serverSicht = name;
    this.offeneAntworten++;
    this.sende('waffe', name);
  }

  /** EquipStand vom Server. */
  stand(slot: string, name: string, aufAnfrage: boolean): void {
    if (slot !== 'waffe') return;
    if (aufAnfrage && this.offeneAntworten > 0) this.offeneAntworten--;
    if (this.offeneAntworten > 0) return;
    this.serverSicht = name;
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
    // Erste Meldung der Verbindung: das Equip sagt dem Server, dass dieser
    // Client Waffen ueber Equip fuehrt (dann zaehlt nicht mehr der Paketname).
    if (!this.begruesst) {
      this.begruesst = true;
      this.offeneAntworten++;
      this.sende('waffe', this.serverSicht);
    }
  }
}

/**
 * Handler fuer PacketType.EquipStand. Der Abgleich entsteht mit dem ersten
 * Stand (dann gibt es Ausruestung und Inventar) und wird neu gebaut, wenn die
 * Ausruestung ausgetauscht wurde.
 */
export function waffenStandHandler(
  traeger: () => WaffenTraeger | null,
  finde: (name: string) => ItemStack | null,
  sende: (slot: string, name: string) => void
): (reader: { readString(): string; readBool(): boolean }) => void {
  let abgleich: WaffenAbgleich | null = null;
  let fuer: WaffenTraeger | null = null;
  return (reader) => {
    const t = traeger();
    if (!t) return;
    if (!abgleich || fuer !== t) {
      abgleich = new WaffenAbgleich(t, finde, sende);
      fuer = t;
    }
    abgleich.stand(reader.readString(), reader.readString(), reader.readBool());
  };
}
