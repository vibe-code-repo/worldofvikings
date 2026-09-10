/**
 * festeKoerper.ts — WELCHE Prefabs überhaupt einen Körper bekommen.
 *
 * Die Frage vor der Form. Sie stand bis zum 10.09.2026 im
 * `EntityManager` des Clients und war damit eine reine Client-Auskunft;
 * der Server, der die Spielerbewegung gegen Hindernisse rechnet, hätte
 * sie ein zweites Mal beantworten müssen. Zwei Antworten auf „ist das
 * fest?" laufen lautlos auseinander: Der Spieler bliebe im Client vor
 * einem Fass stehen, das der Server nicht kennt, und würde von der
 * Serverkorrektur hindurchgezogen.
 *
 * Which prefabs get a collision body at all — shared so client and
 * server agree on the same set.
 */
import { PrefabFlag } from '../types.js';
import type { PrefabDef } from '../prefabs.js';
import { istStoreModell } from '../storeKatalog.js';
import { STORE_NICHT_STREUEN } from '../storePrefabs.js';
import { STORE_OHNE_KOERPER } from '../storeKollisionDaten.js';

/**
 * Welche Prefab-KLASSEN den Spieler blockieren.
 *
 * Das ist die eigentliche Regel des Originals: Unity entscheidet über
 * Layer, und Character.cs nimmt genau die soliden davon —
 *   s_groundRayMask = LayerMask.GetMask("Default", "static_solid",
 *       "Default_small", "piece", "terrain", "blocker", "vehicle")
 * (Character.cs:518). Die Layer-Zuordnung je Prefab liegt nicht im
 * Export (die Prefab-Roots fehlen, nur Sub-Meshes wurden extrahiert),
 * also bilden die Flags dieselbe Einteilung ab.
 *
 * Vorher hing die Auswahl an der GEOMETRIE („alles über 0,5 m"). Genau
 * daher kamen die riesigen Kollisionsboxen um Äste und Deko: Ein
 * liegender Ast ist gross, aber im Vorbild läuft man hindurch, weil er
 * auf keinem soliden Layer liegt.
 */
export const KOLLIDIERENDE_FLAGS =
  PrefabFlag.TREE_BASE | //         grosse, fällbare Bäume
  // Kleine Bäume, Stümpfe, Felsen und Klippen tragen in den
  // Originaldaten NICHT TREE_BASE, sondern DESTRUCTIBLE — TREE_BASE ist
  // den fällbaren Bäumen mit Umfall-Animation vorbehalten. Ohne dieses
  // Flag lief man durch Beech_small1/2, FirTree_small und stubbe
  // hindurch.
  PrefabFlag.DESTRUCTIBLE |
  PrefabFlag.TREE_LOG | //          gefällte Stämme
  PrefabFlag.MINE_ROCK_5 | //       abbaubare Felsen
  PrefabFlag.PIECE | //             Bauteile
  PrefabFlag.WEAR_N_TEAR | //       Gebautes mit Abnutzung
  PrefabFlag.DOOR |
  PrefabFlag.BED |
  PrefabFlag.CHAIR |
  PrefabFlag.CONTAINER |
  PrefabFlag.CRAFTING_STATION |
  PrefabFlag.COOKING_STATION |
  PrefabFlag.SMELTER |
  PrefabFlag.FIREPLACE |
  PrefabFlag.ITEM_STAND |
  PrefabFlag.ARMOR_STAND;

/**
 * Klassen, die NIE blockieren, auch wenn sie zufällig eines der obigen
 * Flags mitführen: Aufsammelbares ist im Original ein Trigger, Pflanzen
 * und Item-Drops laufen einem durch.
 */
export const NIE_KOLLIDIERENDE_FLAGS =
  PrefabFlag.PICKABLE | PrefabFlag.PICKABLE_ITEM | PrefabFlag.ITEM_DROP | PrefabFlag.PLANT;

/**
 * Weiche Vegetation, durch die man läuft, obwohl sie DESTRUCTIBLE ist.
 *
 * Büsche, Sträucher und herumliegende Äste sind zerstörbar, aber kein
 * Hindernis — im Vorbild entscheidet darüber der Layer, den unser Export
 * nicht enthält (die Prefab-Roots fehlen). Der Name ist hier der
 * verlässlichste verfügbare Ersatz; er trifft AshlandsBranch1-3, Bush01,
 * RaspberryBush, shrub_2 und Verwandte, während Beech_small, FirTree_small,
 * stubbe und alle Felsen solide bleiben.
 */
export const WEICHE_VEGETATION = /bush|shrub|branch|berry|seed|shoot|sapling|vines|flower|grass/i;

/**
 * Der Ordner, in dem der Speicher seine PFLANZEN führt.
 *
 * Er ist die Grenze von {@link istFesterStoreKoerper} — siehe die
 * Begründung dort.
 */
export const STORE_VEGETATIONSORDNER = 'vegetation/';

/**
 * Ist das ein Speicher-Modell, das ein HINDERNIS sein soll?
 *
 * ── Warum die Flags hier nicht reichen ───────────────────────────────
 * {@link KOLLIDIERENDE_FLAGS} liest die Prefab-Flags des Altbestands
 * (TREE_BASE, DESTRUCTIBLE, PIECE …). Die Speicher-Prefabs haben davon
 * KEINES: Ihr Generator (`tools/store-prefabs.mjs`) vergibt genau
 * `PERSISTENT`, mit der ausdrücklichen Begründung, alle anderen Flags
 * beschrieben VERHALTEN, und ein Fremdmodell habe keins — „es steht da,
 * und das ist alles".
 *
 * Für Deko stimmt das. Für einen Findling nicht: Ohne Körper läuft man
 * mitten durch einen 20-m-Felsen hindurch, und das ist der einzige
 * Fehler dieser Art, den man beim Spielen sofort merkt.
 *
 * ── Warum die Vegetation ausgenommen ist ─────────────────────────────
 * Die Grenze ist der Ordner: Was unter `…/vegetation/` liegt, bleibt
 * durchlässig, alles andere aus dem Speicher wird fest. Die Kollision
 * der Bäume ist eine eigene Entscheidung mit eigener Messung (rund 150
 * Stämme im 48-m-Kollisionsfenster einer Waldzone).
 *
 * ── Und die, die der Speicher selbst als „kein Körper" führt ─────────
 * Zwei Mengen, und sie sind NICHT dieselbe — nachgemessen am
 * 10.09.2026, weil der alte Kommentar an dieser Stelle das Gegenteil
 * behauptete:
 *
 *   {@link STORE_OHNE_KOERPER}  27 Prefabs mit `art: 'none'` aus
 *       `prefabs.json` — 21 davon Vegetation (Büsche, Äste, Gras,
 *       Pilz), dazu drei Kulissen und drei Wolken.
 *   `STORE_NICHT_STREUEN`  21 Prefabs mit `platzierbar: false` — die
 *       drei Kulissen, drei Himmels-/Wolkenteile und 15 HÖHENFELDER.
 *
 * Die 15 Höhenfelder sind der Unterschied: Sie führen in der Quelle
 * `art: 'box'`, dürfen aber trotzdem keinen Körper bekommen (jedes
 * bringt sein eigenes Gelände mit, bis 300 m). Nur nach `art` zu fragen
 * hätte sie neu fest gemacht — 15 Prefabs, deren Kollision niemand
 * bestellt hat. Deshalb ZÄHLEN BEIDE: Wer unplatzierbar ist ODER
 * `art: 'none'` trägt, bleibt durchlässig. Für den heutigen Bestand ist
 * das exakt die alte Menge (454 feste Speicher-Prefabs);
 * `shared/test/kollision-formen.ts` hält beides fest.
 *
 * Is this a store model that should block the player?
 */
export function istFesterStoreKoerper(def: PrefabDef | undefined): boolean {
  if (!def?.model || !istStoreModell(def.model)) return false;
  if (def.model.includes(STORE_VEGETATIONSORDNER)) return false;
  return !STORE_NICHT_STREUEN.has(def.name) && !STORE_OHNE_KOERPER.has(def.name);
}

/**
 * Die volle Frage: Bekommt dieses Prefab einen Kollisionskörper?
 *
 * `dungeonRaum` und `begehbar` umgehen das Flag-Gatter aus demselben
 * Grund: Beide tragen nur `PERSISTENT`, und das steht nicht in
 * {@link KOLLIDIERENDE_FLAGS}. Ohne die Ausnahme landeten sie in
 * `colliderless`, noch bevor ihre Mesh-Zweige je erreicht würden —
 * gemessen am laufenden Client hatte deshalb auch der Steinkreis gar
 * keine Kollision, man lief mitten hindurch.
 */
export function istFesterKoerper(
  def: PrefabDef | undefined,
  prefabName: string,
  optionen: { dungeonRaum?: boolean; begehbar?: boolean } = {}
): boolean {
  if (optionen.dungeonRaum === true || optionen.begehbar === true) return true;
  const flags = def?.flags ?? 0n;
  return (
    ((flags & KOLLIDIERENDE_FLAGS) !== 0n || istFesterStoreKoerper(def)) &&
    (flags & NIE_KOLLIDIERENDE_FLAGS) === 0n &&
    !WEICHE_VEGETATION.test(prefabName)
  );
}
