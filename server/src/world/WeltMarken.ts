/**
 * WeltMarken.ts (F5) — reine Verwaltung gesetzter GlobalKeys (Fortschritts-
 * marken). Kennt weder Peer noch WorldManager (gleiches Prinzip wie
 * Drossel.ts/ChatReichweite.ts) — testbar ohne Server.
 *
 * BEGRIFFSKLAERUNG (s. F5-Bericht): shared/src/types.ts fasst unter
 * `GlobalKey` ZWEI verschiedene Dinge aus dem Vorbild in EINEM Enum
 * zusammen:
 *
 *   - Weltmodifikatoren (PlayerDamage..NonServerOption): bei der Welt-
 *     ERZEUGUNG gewaehlte, danach feste Werte (Schwierigkeitsgrad-Presets
 *     wie im Vorbild-"modifier"-Befehl). Das ist Erzeugungs-Konfiguration,
 *     keine Laufzeit-Flagge, und aendert sich waehrend des Spiels nicht.
 *   - Fortschrittsmarken (defeated_eikthyr..KilledBat): waehrend des
 *     Spiels gesetzte JA/NEIN-Flaggen. Im Vorbild sind das freie
 *     Zeichenketten (ZoneSystem::SetGlobalKey("defeated_eikthyr")), hier
 *     Enum-Werte — der geschlossene Werteraum ist in diesem Projekt
 *     bewusst so belassen (Typsicherheit an den Aufrufstellen), aendert
 *     aber nichts am LAUFZEIT-Charakter dieser Gruppe.
 *
 * Dieses Modul bedient NUR die zweite Gruppe: einen gesetzt/nicht-gesetzt
 * Zustand je GlobalKey. Weltmodifikatoren sind hier absichtlich NICHT
 * abgebildet — sie brauchen ein anderes Zuhause (Welterzeugungs-
 * Konfiguration, vermutlich neben worldSeed/worldGenVersion in
 * WorldManager), keine Laufzeit-Menge.
 *
 * PERSISTENZ UEBER NAMEN, NICHT ZAHLEN: TypeScript-Enums ohne explizite
 * Werte nummerieren nach Deklarationsreihenfolge durch. Ein spaeter
 * eingefuegtes oder entferntes Enum-Mitglied wuerde bei Zahlen-Persistenz
 * JEDE bestehende Marke lautlos auf ein anderes Mitglied verschieben —
 * ein Spielstand, der "defeated_eikthyr" meint, stuende nach einer
 * harmlosen Enum-Umsortierung ploetzlich fuer "KilledBat". Beim NAMEN
 * bleibt eine Marke auch nach Enum-Umbauten dieselbe; das kostet nur einen
 * String-Vergleich beim Laden.
 */
import { GlobalKey } from '@wov/shared';

/** Alle bekannten GlobalKey-Namen — fuer die Validierung beim Laden/Setzen. */
const BEKANNTE_NAMEN = new Set(
  Object.values(GlobalKey).filter((wert): wert is string => typeof wert === 'string')
);

/**
 * Loest einen Namen (z. B. aus einem Admin-Befehl) zum GlobalKey auf.
 * Exakter Treffer zuerst, sonst gross-/kleinschreibungs-tolerant (gleiches
 * Muster wie WovServer.registerAbbauCommand fuer Prefab-Namen) — ein Admin
 * tippt "marke setzen Defeated_Eikthyr" genauso oft wie die exakte Form.
 */
export function globalKeyVonName(name: string): GlobalKey | undefined {
  if (BEKANNTE_NAMEN.has(name)) {
    return (GlobalKey as unknown as Record<string, number>)[name] as GlobalKey;
  }
  const lower = name.toLowerCase();
  for (const bekannt of BEKANNTE_NAMEN) {
    if (bekannt.toLowerCase() === lower) {
      return (GlobalKey as unknown as Record<string, number>)[bekannt] as GlobalKey;
    }
  }
  return undefined;
}

export class WeltMarken {
  private readonly gesetzt = new Set<GlobalKey>();

  /**
   * Setzt eine Marke. Gibt `true` zurueck, wenn sie NEU gesetzt wurde
   * (`false` = war schon gesetzt) — idempotent, ein Aufrufer (z. B. der
   * Eikthyr-Kill-Pfad) muss selbst nicht pruefen, ob die Marke schon steht.
   */
  setzen(marke: GlobalKey): boolean {
    if (this.gesetzt.has(marke)) return false;
    this.gesetzt.add(marke);
    return true;
  }

  hat(marke: GlobalKey): boolean {
    return this.gesetzt.has(marke);
  }

  /** Alle gesetzten Marken als Namen, sortiert — fuer Admin-Anzeige UND Save. */
  alsNamen(): string[] {
    return [...this.gesetzt].map((k) => GlobalKey[k]).sort();
  }

  /**
   * Stellt den Zustand aus einer Namensliste her (Save-Load). Unbekannte
   * Namen (aelterer Save mit inzwischen entfernten, oder ein neuerer Save
   * mit noch unbekannten Enum-Mitgliedern) werden still uebersprungen statt
   * den Ladevorgang abzubrechen — eine einzelne verlorene Marke ist kein
   * Grund, 250.000 ZDOs zu verwerfen. Ein `undefined`/leeres `namen`
   * bedeutet "keine Marken gesetzt" (Altstaende vor diesem Umbau, oder eine
   * frische Welt) — KEIN Fehlerfall.
   */
  ausListe(namen: readonly string[] | undefined): void {
    this.gesetzt.clear();
    if (!namen) return;
    for (const name of namen) {
      if (!BEKANNTE_NAMEN.has(name)) continue;
      const wert = (GlobalKey as unknown as Record<string, number>)[name];
      if (typeof wert === 'number') this.gesetzt.add(wert as GlobalKey);
    }
  }
}
