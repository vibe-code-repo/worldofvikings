/**
 * The `storage` listener of the flight for the draft key, without a browser: what to do when another
 * tab writes the draft. DOM-free (takes any target with `addEventListener`).
 *
 * Der `storage`-Hörer des Flugs für den Entwurfsschlüssel, ohne Browser.
 *
 * It works only while the terrain tab is open (T2 N1-1): every write of the editor to the draft, a
 * placement too, would otherwise cost a parse of the whole layer (150 ms at 100 000 points). When the
 * tab is closed nothing is lost: opening it and the start of every stroke compare the ground with the
 * draft anyway (`GelaendeSteuerung.entwurfGeaendert`).
 */
export interface StorageZiel {
  addEventListener(art: 'storage', f: (e: { key: string | null }) => void): void;
  removeEventListener(art: 'storage', f: (e: { key: string | null }) => void): void;
}

/** `key === null` is `clear()` in the other tab (every key is gone, ours too). Returns the remover. */
export function verdrahteEntwurfHoerer(ziel: StorageZiel, schluessel: string, gelaendeOffen: () => boolean, abgleichen: () => void): () => void {
  const f = (e: { key: string | null }): void => {
    if (!gelaendeOffen()) return;
    if (e.key === null || e.key === schluessel) abgleichen();
  };
  ziel.addEventListener('storage', f);
  return () => ziel.removeEventListener('storage', f);
}
