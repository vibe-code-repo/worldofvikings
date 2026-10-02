/**
 * The state the E key keeps per connection (client side, no browser needed).
 *
 * The client does not learn from the server whether the player has admin rights, and `dungeon enter` / `dungeon leave` are
 * admin commands (`AdminCommands.execute`). The one thing it can read is the server's refusal, which arrives as the answer to
 * the command. After the first refusal the E key sends no admin command from the overworld any more: a player without rights
 * had no business there, and the refusal on every press was the fault reported on 02.10.2026. A new connection starts fresh
 * (the rights are read from the admin list when the player connects, so they can change between two connections).
 * A flag in `ServerConfig` would let the client know before the first press; that needs `WovServer.ts` (follow-up card).
 */
import { eOhneZiel } from './eOhneZiel';
import type { EOhneZielAktion, EOhneZielLage } from './eOhneZiel';

/** The server's answer to an admin command of a player without admin rights (`server/src/admin/AdminCommands.ts`, `execute`). */
export const ADMIN_VERWEIGERT_TEXT = 'Admin commands are not allowed for this player';

export class ESitzung {
  private adminVerweigert = false;

  /** `beiNeuerVerbindung` runs on every (re)connection: what the client remembers of the old session is dropped there. */
  constructor(private readonly beiNeuerVerbindung: () => void) {}

  /** `PeerInfo` arrived: a new connection (also the first one). */
  neueVerbindung(): void {
    this.adminVerweigert = false;
    this.beiNeuerVerbindung();
  }

  /** The text of an `AdminEvent`. Returns it unchanged, so the caller can show it. */
  adminAntwort(text: string): string {
    if (text === ADMIN_VERWEIGERT_TEXT) this.adminVerweigert = true;
    return text;
  }

  get hatAdminVerweigert(): boolean {
    return this.adminVerweigert;
  }

  /** What E does with nothing in reach (see `eOhneZiel`). */
  aktion(lage: Omit<EOhneZielLage, 'adminVerweigert'>): EOhneZielAktion {
    return eOhneZiel({ ...lage, adminVerweigert: this.adminVerweigert });
  }
}
