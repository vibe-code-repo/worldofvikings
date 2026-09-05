/**
 * Die Flagbits des `ServerConfig`-Pakets — EINE Liste für beide Seiten.
 *
 * ── Warum diese Datei entstanden ist ─────────────────────────────────
 * Die sechs Bits standen bis E8 ZWEIMAL im Quelltext: als `const FLAG_…`
 * in `server/src/WovServer.ts` und noch einmal in `client/src/main.ts`.
 * Die einzige Zusage, dass sie übereinstimmen, war ein Kommentar an
 * beiden Stellen („same order client-side" / „same order server-side").
 * Das ging gut, solange niemand ein Bit hinzufügte.
 *
 * E8 fügt eines hinzu — und braucht es an einer DRITTEN Stelle, im
 * Karteneditor. Drei Kopien einer Bitfolge sind keine Frage der Ordnung
 * mehr: Zwei auseinandergelaufene Listen verschieben kein Feld und
 * werfen keinen Fehler, sie machen aus einem gesetzten Schalter ein
 * ANDERES Bit. Das Formular „Neuer Saal" erschiene dann, wenn der Server
 * im Layout-Modus läuft.
 *
 * ── Warum die Namen unverändert bleiben ──────────────────────────────
 * `FLAG_BLEND_SMOOTHSTEP` und die anderen fünf heissen weiter so, wie sie
 * an beiden alten Stellen hiessen. Eine Umbenennung im selben Zug hätte
 * den Umzug unlesbar gemacht: Man sähe nicht mehr, dass hier NUR
 * verschoben wurde.
 *
 * The ServerConfig packet's flag bits — one list for both sides. They
 * used to exist twice (server and client), kept in step by a comment.
 */

// ── Die Bits ────────────────────────────────────────────────────────────
export const FLAG_BLEND_SMOOTHSTEP = 1 << 0;
export const FLAG_BILINEAR_HEIGHT = 1 << 1;
export const FLAG_ASHLANDS_MODERN = 1 << 2;
export const FLAG_RIVER_AFFECTS_OCEAN = 1 << 3;
export const FLAG_DISABLE_DISTANT_RIVERS = 1 << 4;
/** Kündigt an, dass direkt nach ServerConfig ein WorldLayoutData folgt. */
export const FLAG_LAYOUT_MODE = 1 << 5;
/**
 * Dieser Peer darf einen Saal bauen (E8).
 *
 * ── Warum das Bit die UND-Verknüpfung beider Tore trägt ──────────────
 * Gebaut werden darf nur, wenn `dungeons.modulbau` in der `server.yml`
 * steht UND der Peer Admin ist (`ModuleBuild.baueModul` prüft beides und
 * bleibt die einzige Klemmenliste). Meldete dieses Bit bloss den
 * SCHALTER, sähe ein Nicht-Admin ein Formular, das bei jedem Klick
 * absagt — ein Angebot, das erst beim Klicken scheitert, ist schlechter
 * als keines. Das Bit beantwortet deshalb die Frage, die das Formular
 * wirklich stellt: „Darf ICH hier bauen?"
 *
 * Es kann dabei nie mehr versprechen, als der Server hergibt: Es ist aus
 * denselben zwei Werten gebildet, die `baueModul` später noch einmal
 * liest. Ein Client, der das Bit fälschte, käme an der Prüfung dort
 * trotzdem nicht vorbei.
 */
export const FLAG_MODULE_BUILD = 1 << 6;

/**
 * Woraus das Flagbyte gebildet wird.
 *
 * Bewusst BOOLEANS und nicht die `ServerConfig` des Servers: `shared`
 * kennt sie nicht und soll sie nicht kennen. Der Aufrufer übersetzt
 * `worldMode === 'layout'` und `dungeonsModulbau && peer.isAdmin` selbst
 * — beides Aussagen, die nur er treffen kann.
 */
export interface ServerConfigFlagSources {
  readonly blendSmoothStep: boolean;
  readonly bilinearHeight: boolean;
  readonly ashlandsModernNoise: boolean;
  readonly riverAffectsOcean: boolean;
  readonly disableDistantRivers: boolean;
  readonly layoutMode: boolean;
  readonly moduleBuild: boolean;
}

/** Das Flagbyte des ServerConfig-Pakets — die einzige Stelle, die es baut. */
export function serverConfigFlags(q: ServerConfigFlagSources): number {
  let flags = 0;
  if (q.blendSmoothStep) flags |= FLAG_BLEND_SMOOTHSTEP;
  if (q.bilinearHeight) flags |= FLAG_BILINEAR_HEIGHT;
  if (q.ashlandsModernNoise) flags |= FLAG_ASHLANDS_MODERN;
  if (q.riverAffectsOcean) flags |= FLAG_RIVER_AFFECTS_OCEAN;
  if (q.disableDistantRivers) flags |= FLAG_DISABLE_DISTANT_RIVERS;
  if (q.layoutMode) flags |= FLAG_LAYOUT_MODE;
  if (q.moduleBuild) flags |= FLAG_MODULE_BUILD;
  return flags;
}

/** Darf dieser Peer einen Saal bauen? Die Leseseite von {@link FLAG_MODULE_BUILD}. */
export function moduleBuildAllowed(flags: number): boolean {
  return (flags & FLAG_MODULE_BUILD) !== 0;
}
