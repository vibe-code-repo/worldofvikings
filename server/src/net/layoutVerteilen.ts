/**
 * Sending the world layout document to a peer, guarded by the peer's protocol version.
 * Das Weltdokument an einen Peer schicken, abgesichert durch dessen Protokollversion.
 *
 * The handshake only checks the version once, when the peer connects. Every later way a layout reaches a
 * peer (the live update, the document sent at login, any future one) goes through here, so a peer whose
 * client is too old for the document is turned away with the reload message instead of being sent a
 * document it would sanitize differently from the server.
 */
import { PROTOCOL_VERSION_BASIS, darfLayoutBekommen, mindestProtokollVersion, serverVersionFuerMeldung, veraltetMeldung } from '@wov/shared';

export interface LayoutEmpfaenger {
  /** Version the peer sent in the handshake. */
  protokollVersion: number;
  disconnect(reason?: string): void;
}

/** Sends via `senden` when the peer's client may have `layoutRoh`; otherwise disconnects it. Returns whether it was sent. */
export function schickeLayout<P extends LayoutEmpfaenger>(peer: P, layoutRoh: unknown, senden: (peer: P) => void): boolean {
  if (darfLayoutBekommen(peer.protokollVersion, layoutRoh)) {
    senden(peer);
    return true;
  }
  const mindest = Math.max(PROTOCOL_VERSION_BASIS, mindestProtokollVersion(layoutRoh));
  peer.disconnect(veraltetMeldung(peer.protokollVersion, serverVersionFuerMeldung(peer.protokollVersion, mindest)));
  return false;
}
