/**
 * The state the E key keeps per connection (client side, no browser needed).
 *
 * `dungeon enter` / `dungeon leave` are admin commands (`AdminCommands.execute`). The client learns from the server whether the
 * player is an admin: at login in the `ServerConfig` flags (`FLAG_ADMIN`), afterwards live in the `AdminEvent` with the command
 * `adminrechte` (`gleicheAdminrechteAb`: rights granted or withdrawn in mid-session). The E key sends `dungeon enter` from the
 * overworld only for an admin. The flag is a hint for the interface only: the server checks every command itself, whatever the
 * client says (the refusal on every press was the fault reported on 02.10.2026; N2 learned it from the refusal text, N3 asks
 * the server up front, so there is no fallback on the text any more).
 */
import { adminAusFlags } from '@wov/shared';
import { eOhneZiel } from './eOhneZiel';
import type { EOhneZielAktion, EOhneZielLage } from './eOhneZiel';

/** The command name of the `AdminEvent` that changes the rights live (`gleicheAdminrechteAb`, `server/src/spiel/befehle/AdminListe.ts`). */
export const ADMINRECHTE_EREIGNIS = 'adminrechte';

export class ESitzung {
  private admin = false;

  /** `beiNeuerVerbindung` runs on every (re)connection: what the client remembers of the old session is dropped there. */
  constructor(private readonly beiNeuerVerbindung: () => void) {}

  /** `PeerInfo` arrived: a new connection (also the first one). The rights start at "no" until `ServerConfig` says otherwise. */
  neueVerbindung(): void {
    this.admin = false;
    this.beiNeuerVerbindung();
  }

  /** The flag byte of `ServerConfig` (once per login). */
  serverConfig(flags: number): void {
    this.admin = adminAusFlags(flags);
  }

  /** An `AdminEvent`: only the command `adminrechte` (the live rights change) carries the new rights in `active`; the answers to the commands `admin list/add/remove` are named `admin` with active=false and change nothing. Returns the text unchanged, so the caller can show it. */
  adminEreignis(command: string, active: boolean, text: string): string {
    if (command === ADMINRECHTE_EREIGNIS) this.admin = active;
    return text;
  }

  get istAdmin(): boolean {
    return this.admin;
  }

  /** What E does with nothing in reach (see `eOhneZiel`). */
  aktion(lage: Omit<EOhneZielLage, 'istAdmin'>): EOhneZielAktion {
    return eOhneZiel({ ...lage, istAdmin: this.admin });
  }
}
