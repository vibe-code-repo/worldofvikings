/**
 * Die spielbaren Figuren — EINE Liste für Client und Server.
 *
 * WARUM GEMEINSAM: Der Client zeigt sie im Anmeldebildschirm an und lädt
 * das Modell, der Server prüft die eingehende Wahl und schreibt sie ans
 * Charakter-ZDO. Zwei getrennte Listen liefen unweigerlich auseinander —
 * genau das ist in diesem Projekt schon zweimal passiert (das MCP-Schema
 * kannte `meadows`, als die Welt längst `grassland` hiess; `server.yml`
 * versprach sechzehn Schlüssel, die niemand las). Wer eine Figur
 * hinzufügt, trägt sie HIER ein, und beide Seiten wissen davon.
 *
 * WARUM DIE KENNUNG NICHT DER DATEINAME IST: Die Kennung steht im
 * Spielstand und im ZDO jedes Spielers. Ein umbenanntes Modell wäre damit
 * ein kaputter Spielstand. Die Kennung ist stabil, `modell` darf sich
 * ändern.
 */

export interface Figur {
  /** Stabile Kennung — steht im Spielstand und im ZDO. Nie ändern. */
  readonly id: string;
  /**
   * Modellname OHNE Endung — so, wie ihn der AssetManager erwartet
   * (`getMasters('npc_1_walk')`). Die Endung haengt er selbst an.
   * Wer hier `PlayerAvatar.glb` einträgt, bekommt `PlayerAvatar.glb.glb`
   * und einen 404, den man erst am fehlenden Modell im Spiel bemerkt —
   * genau das ist am 22.08.2026 in der ersten Fassung passiert.
   */
  readonly modell: string;
  /** Beschriftung im Anmeldebildschirm. */
  readonly name: string;
}

/**
 * Reihenfolge = Reihenfolge im Anmeldebildschirm.
 *
 * ── Warum nur noch EINE Figur (Stand 22.08.2026) ────────────────────
 * Hier standen drei: `wikinger` (PlayerAvatar), `wikingerin` und
 * `walkuere`. Gepflegt wurde nur die Wikingerin — sie hat als einzige
 * das vollstaendige Rig mit 51 Knochen und 24 Fingern, sechs auf den
 * Boden gesetzte Clips, eine Comic-Hautkarte, 21 Frisuren und Ruestung.
 * Die beiden anderen waren Staende aus frueheren Wochen ohne diese
 * Teile; im Anmeldebildschirm haetten sie eine Auswahl vorgetaeuscht,
 * hinter der nichts steht.
 *
 * ── Warum ein Ordner im Modellnamen steht ───────────────────────────
 * `wikingerin/WikingerinKoerper` ist kein Tippfehler. Die Figur ist in
 * Einzeldateien aufgeteilt — Koerper, 21 Frisuren, Ruestungsteile —,
 * damit die Charaktererstellung nur laedt, was getragen wird: 3,76 MB
 * statt 17,5 MB. Alle Teile liegen unter assets/models/wikingerin/ und
 * tragen dieselbe Gelenkliste; erzeugt werden sie von
 * tools/asset-aufteilen.py, das genau das nachprueft.
 *
 * Die alte Einzeldatei WikingerinBasis.glb bleibt vorerst liegen: Sie
 * ist der Stand, mit dem bis heute gespielt wurde.
 *
 * ⚠ Der Wikingerin fehlt der Sprung nicht mehr: Ihre Clips heissen
 * `idle/gehen/rennen/springen/angriff/weitsprung`. AvatarRig sucht sie
 * ueber Namensmuster; `weitsprung` enthaelt bewusst weder "spring" noch
 * "rennen", damit es keinem Zustand untergeschoben wird.
 */
export const FIGUREN: readonly Figur[] = [
  { id: 'wikingerin', modell: 'wikingerin/WikingerinKoerper', name: 'Wikingerin' },
] as const;

/** Was ein Spieler bekommt, der nie gewählt hat — der bisherige Charakter. */
export const FIGUR_VORGABE = FIGUREN[0]!.id;

/**
 * Name des ZDO-Members am Charakter-ZDO, in dem die Figur steht.
 *
 * Als ZDO-Member und nicht als eigenes Paket: Der Wert läuft damit im
 * vorhandenen ZDO-Sync mit, landet im Save und erreicht jeden Peer, der
 * die Figur ohnehin schon sieht — dieselbe Begründung wie bei
 * TRUHE_INHALT_MEMBER (F1). Ein eigener Pakettyp müsste Sichtbarkeit,
 * Nachzügler und Persistenz alle drei selbst lösen.
 */
export const FIGUR_MEMBER = 'figur';

/**
 * Kennt die Liste diese Kennung? Der Server glaubt dem Client nichts.
 *
 * Bewusst KEIN Typwaechter (`id is string`): Der Aufrufer uebergibt meist
 * schon einen `string`, und die Verengung machte den Fehlerzweig zu
 * `never` — man koennte den abgelehnten Wert dann nicht einmal mehr ins
 * Log schreiben. Der Gewinn waere ohnehin keiner gewesen: Die Frage ist
 * nicht, ob es ein String ist, sondern ob er in der Liste steht.
 */
export function istFigur(id: unknown): boolean {
  return typeof id === 'string' && FIGUREN.some((f) => f.id === id);
}

/**
 * Kennung → Figur. Unbekanntes fällt auf die Vorgabe zurück, statt zu
 * werfen: Eine Figur, die es nicht mehr gibt (umbenannt, entfernt), darf
 * einen alten Spielstand nicht unbrauchbar machen.
 */
export function figurZu(id: string | null | undefined): Figur {
  return FIGUREN.find((f) => f.id === id) ?? FIGUREN[0]!;
}

/**
 * Modellname OHNE Endung — fuer den AssetManager (fremde Spieler).
 */
export function modellZu(id: string | null | undefined): string {
  return figurZu(id).modell;
}

/**
 * Dateiname MIT Endung — fuer den direkten Loader der eigenen Figur
 * (`SceneLoader.ImportMeshAsync` in AvatarRig, der einen echten
 * Dateinamen will). Zwei Funktionen statt einer, weil genau diese
 * Verwechslung schon einen 404 gekostet hat.
 */
export function modellDateiZu(id: string | null | undefined): string {
  return `${figurZu(id).modell}.glb`;
}
