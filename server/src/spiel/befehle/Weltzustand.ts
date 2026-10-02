/**
 * Admin commands for the state of the world: `marke` (progress markers) and `wetter` (weather).
 * They were methods of `WovServer` and moved here as functions with a context (refactoring I1,
 * step 1): `k` is the server itself, `this` became `k`, nothing else changed. `WovServer`
 * keeps one forwarding method per function, and its constructor still calls them; the weather
 * service itself (`wetterDienst`) stays in the class.
 */

import { GlobalKey } from '@wov/shared';
import { fuehreWetterBefehlAus } from '../Wetter.js';
import { globalKeyVonName } from '../../world/WeltMarken.js';
import type { SpielKontext } from '../Kontext.js';

/** What this module uses of the server: 3 members. */
type WeltzustandKontext = SpielKontext<'adminCommands' | 'weltMarken' | 'wetterDienst'>;

/**
 * `marke liste` / `marke setzen <Name>` — Fortschrittsmarken (F5) von
 * Hand setzen und anzeigen. Ueber peer.isAdmin gegated (der einzige Weg
 * zu dieser Methode ist AdminCommandRegistry.execute(), das jeden
 * Befehl schon vor dem Dispatch gegen canUseAdminCommands prueft) —
 * nicht jeder Spieler soll sich selbst die Boss-Progression schenken.
 *
 * Bewusst NUR die Fortschrittsmarken-Haelfte von GlobalKey bedient, s.
 * Kopfkommentar von shared/src/types.ts und WeltMarken.ts — die
 * Weltmodifikator-Haelfte (WorldLevel, PlayerDamage, ...) ist
 * Welterzeugungs-Konfiguration und gehoert nicht in einen
 * Laufzeit-Befehl.
 */
function registerMarkeCommand(k: WeltzustandKontext): void {
  k.adminCommands.register('marke', (_peer, args) => {
    const sub = (args.shift() ?? '').toLowerCase();

    if (sub === 'liste' || sub === 'list') {
      const namen = k.weltMarken.alsNamen();
      return {
        ok: true,
        active: false,
        message:
          namen.length > 0
            ? `${namen.length} gesetzte Marke(n): ${namen.join(', ')}`
            : 'Keine Marke gesetzt',
      };
    }

    if (sub === 'setzen' || sub === 'set') {
      const name = args[0];
      if (!name) {
        return { ok: false, active: false, message: 'Aufruf: marke setzen <Name>' };
      }
      const marke = globalKeyVonName(name);
      if (marke === undefined) {
        return { ok: false, active: false, message: `Unbekannte Marke: "${name}"` };
      }
      const neu = k.weltMarken.setzen(marke);
      return {
        ok: true,
        active: false,
        message: neu
          ? `Marke "${GlobalKey[marke]}" gesetzt`
          : `Marke "${GlobalKey[marke]}" war schon gesetzt`,
      };
    }

    return { ok: false, active: false, message: 'Aufruf: marke liste | marke setzen <Name>' };
  });
}

/** `wetter <Zustand|auto> [Biom]` — Wetter setzen, s. spiel/Wetter.ts. */
function registerWetterCommand(k: WeltzustandKontext): void {
  k.adminCommands.register('wetter', (_peer, args) => fuehreWetterBefehlAus(k.wetterDienst(), args));
}

export { registerMarkeCommand, registerWetterCommand };
