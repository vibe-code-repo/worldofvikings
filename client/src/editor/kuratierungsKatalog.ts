/**
 * Kuratierungskatalog (Roadmap B3) — die Auswahl-/Filterlogik hinter der
 * Kuratierungsliste einer Region (`RegionDef.vegetation` / `.locations` /
 * `.spawns`). Reine Funktionen, kein DOM: Die Bedienung (Suche, Klick zum
 * Hinzufügen/Entfernen) sitzt in `KuratierungsAuswahl.ts`, sie ruft nur
 * diese Funktionen.
 *
 * ── Woher die Auswahlmenge kommt ──────────────────────────────────────
 * `RegionDef.vegetation/locations/spawns` akzeptiert laut
 * `worldlayout/types.ts` "Namen aus FOLIAGE / FEATURES / SPAWN_TABLE" —
 * dieselben drei Tabellen, gegen die auch `pruefeLayout`
 * (worldlayout/pruefung.ts) unbekannte Namen meldet. Diese Datei baut aus
 * denselben drei Tabellen die AUSWAHLLISTE für den Editor, damit Katalog
 * und Prüfung nie auseinanderlaufen.
 *
 * Stand bei Entwurf: FOLIAGE 102 eigene Arten, FEATURES 0 (kein eigenes
 * Bauwerk auf der Whitelist), SPAWN_TABLE 0 (kein eigenes Kreaturmodell
 * lauffähig) — siehe features.ts/spawnData.ts. Die Roadmap-Zahl "120" für
 * die Vegetation stammt aus `vegetationData.json` (den geparsten
 * Fremdmodellen); seit Block A fallen die vollständig heraus (siehe
 * Kopfkommentar von vegetation.ts), übrig bleiben die 102 eigenen Arten
 * aus flora.ts. Locations und Spawns haben deshalb HEUTE keinen einzigen
 * wählbaren Eintrag — der Katalog liefert für sie eine leere Liste, kein
 * Fehler, und `KuratierungsAuswahl` muss das als eigenen Zustand zeigen
 * ("noch keine eigenen Locations/Kreaturen"), nicht als leere Suche.
 *
 * ── Reihenfolge ────────────────────────────────────────────────────────
 * Der Kopfkommentar von vegetation.ts hält fest, dass die Reihenfolge in
 * FOLIAGE Streu-Vorrecht ist (wer zuerst kommt, bekommt den Platz). Für
 * eine EINZELNE Region ist die Reihenfolge in `RegionDef.vegetation`
 * dagegen nur die Reihenfolge, in der der Nutzer Arten eingetragen hat —
 * sie hat keine Bedeutung für den Streudurchlauf, der arbeitet über
 * FOLIAGE, nicht über die Kuratierungsliste. Trotzdem gilt: bestehende
 * Einträge NIE stillschweigend umsortieren (etwa alphabetisch), weil sich
 * sonst niemand mehr sicher ist, ob eine Reihenfolge zufällig oder
 * gewollt ist. Deshalb: `geordneteAuswahl` gibt exakt die Reihenfolge von
 * `wert` zurück, `eintragHinzufuegen` hängt nur ans Ende an, und Entfernen
 * geschieht über den INDEX, nicht über den Namen — sonst würde ein
 * doppelter Alteintrag (Freitext-Altlast) beide Vorkommen auf einmal
 * verlieren.
 */
import {
  BIOME_BY_NAME,
  FEATURES,
  FOLIAGE,
  GRASLAND_FLORA_NAMEN,
  NADELWALD_FLORA_NAMEN,
  SUMPF_FLORA_NAMEN,
  HOCHNORD_FLORA_NAMEN,
  ASCHE_FLORA_NAMEN,
  SPAWN_TABLE,
  type BiomeName,
} from '@wov/shared';

/** Welche der drei Kuratierungslisten einer Region. */
export type KuratierungsArt = 'vegetation' | 'locations' | 'spawns';

/**
 * Ein wählbarer Eintrag im Katalog. `einordnung` sind die Kurzangaben,
 * die die jeweilige Tabelle tatsächlich hergibt — je Art unterschiedlich
 * (siehe die drei Bau-Funktionen unten). Ohne Vorschaubild (Roadmap B9,
 * hängt an F2); die Zeile ist bewusst so gebaut, dass ein Bild links
 * später ohne Umbau dazukommt.
 */
export interface KatalogEintrag {
  readonly name: string;
  readonly einordnung: readonly string[];
}

/** Ein Eintrag der AKTUELLEN Regionsliste, mit Bekanntheits-Status. */
export interface EintragMitStatus {
  readonly name: string;
  /** false = Name steht nicht im Katalog — alt, falsch geschrieben, oder
   *  (wie bei Locations/Spawns heute) der Katalog ist schlicht leer. */
  readonly bekannt: boolean;
  /** Leer, wenn unbekannt — es gibt nichts zum Einordnen. */
  readonly einordnung: readonly string[];
}

function formatMeter(n: number): string {
  return Number.isInteger(n) ? `${n} m` : `${n.toFixed(1)} m`;
}

/** Biom-Bitmaske → Autornamen, in der festen Reihenfolge von BIOME_BY_NAME. */
function biomeNamen(maske: number): BiomeName[] {
  const namen: BiomeName[] = [];
  for (const [name, bit] of BIOME_BY_NAME) {
    if ((maske & bit) !== 0) namen.push(name);
  }
  return namen;
}

/**
 * Vegetation: Name + die Streubündel, in denen die Art vorkommt
 * (Grasland/Nadelwald/Sumpf/Hoher Norden/Aschewüste — dieselben Bündel,
 * die die Bewuchs-Knöpfe in editorMain.ts setzen), plus der Mindestradius
 * als Grössenangabe. Die Biom-Bitmaske selbst trägt hier NICHTS bei: seit
 * "Warum eigene Flora keine Biom-Maske mehr hat" (flora.ts) steht bei
 * jeder eigenen Art ALLE_BIOME — sie wäre bei jedem Eintrag identisch und
 * damit keine Einordnung.
 */
function vegetationsKatalog(): KatalogEintrag[] {
  const buendel: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
    ['Grasland', new Set(GRASLAND_FLORA_NAMEN)],
    ['Nadelwald', new Set(NADELWALD_FLORA_NAMEN)],
    ['Sumpf', new Set(SUMPF_FLORA_NAMEN)],
    ['Hoher Norden', new Set(HOCHNORD_FLORA_NAMEN)],
    ['Aschewüste', new Set(ASCHE_FLORA_NAMEN)],
  ];
  return FOLIAGE.map((f) => {
    const einordnung = buendel.filter(([, set]) => set.has(f.prefabName)).map(([name]) => name);
    einordnung.push(formatMeter(f.radius));
    return { name: f.prefabName, einordnung };
  });
}

/**
 * Locations: Name + `group` (die einzige echte Kategorie, die
 * `Feature` mitbringt) + die Biome, in denen sie platziert werden darf.
 * Heute immer eine leere Liste (FEATURES.length === 0, siehe
 * features.ts) — die Funktion bleibt trotzdem vollständig, damit sie
 * ohne Änderung greift, sobald eigene Bauwerke auf die Whitelist kommen.
 */
function locationsKatalog(): KatalogEintrag[] {
  return FEATURES.map((f) => {
    const einordnung: string[] = [];
    if (f.group) einordnung.push(f.group);
    einordnung.push(...biomeNamen(f.biome));
    return { name: f.name, einordnung };
  });
}

/**
 * Spawns: Name + Biome + Gruppengrösse + Monster/friedlich
 * (`aggro === false` → NPC laut spawnData.ts-Kopfkommentar). Heute immer
 * leer (SPAWN_TABLE.length === 0) — Deer/Boar/Greydwarf sind
 * Fremdmodelle und fallen bei `bauSpawnTabelle()` alle heraus.
 */
function spawnsKatalog(): KatalogEintrag[] {
  return SPAWN_TABLE.map((e) => {
    const einordnung: string[] = [...biomeNamen(e.biomes)];
    einordnung.push(e.aggro === false ? 'friedlich' : 'Monster');
    einordnung.push(
      e.groupSizeMin === e.groupSizeMax ? `${e.groupSizeMin} Stück` : `${e.groupSizeMin}–${e.groupSizeMax} Stück`
    );
    return { name: e.prefab, einordnung };
  });
}

/** Der Katalog wählbarer Einträge für eine Kuratierungsart. */
export function katalog(art: KuratierungsArt): readonly KatalogEintrag[] {
  switch (art) {
    case 'vegetation':
      return vegetationsKatalog();
    case 'locations':
      return locationsKatalog();
    case 'spawns':
      return spawnsKatalog();
  }
}

/**
 * Die aktuelle Regionsliste (`wert`) gegen den Katalog gelegt — in
 * EXAKT der gespeicherten Reihenfolge. Ein Name, der im Katalog fehlt,
 * bleibt trotzdem in der Liste (bekannt: false) statt zu verschwinden —
 * das ist Punkt 4 des Auftrags: ein alter oder falsch geschriebener
 * Eintrag einer bestehenden Welt darf nicht still wegfallen, er soll
 * sichtbar als unbekannt markiert werden. Tatsächlich beobachtet in der
 * DEV-Welt (Kopie geprüft): Region insel-18 trägt
 * `locations: ["grassland", "blackforest"]` — zwei Biomnamen, offenbar
 * versehentlich ins Freitextfeld für Locations eingetragen, und beide
 * unbekannt, weil FEATURES heute leer ist.
 */
export function geordneteAuswahl(
  wert: readonly string[] | undefined,
  eintraege: readonly KatalogEintrag[]
): readonly EintragMitStatus[] {
  const nachName = new Map(eintraege.map((e) => [e.name, e.einordnung] as const));
  return (wert ?? []).map((name) => {
    const einordnung = nachName.get(name);
    return { name, bekannt: einordnung !== undefined, einordnung: einordnung ?? [] };
  });
}

/**
 * Katalog-Suche: Groß-/Kleinschreibung ignoriert, prüft Name UND die
 * Einordnungs-Angaben (so findet „Nadelwald" auch Arten, die nur über
 * das Bündel dort stehen, nicht über den Namen).
 */
export function filtereKatalog(eintraege: readonly KatalogEintrag[], suchtext: string): readonly KatalogEintrag[] {
  const t = suchtext.trim().toLowerCase();
  if (!t) return eintraege;
  return eintraege.filter(
    (e) => e.name.toLowerCase().includes(t) || e.einordnung.some((tag) => tag.toLowerCase().includes(t))
  );
}

/**
 * Anhängen ans ENDE — nie einsortieren. Kommt der Name schon vor (egal
 * ob über den Katalog oder als Alteintrag), passiert nichts: eine Liste
 * ist eine MENGE mit Reihenfolge, kein Multiset, und ein zweiter Klick
 * auf denselben Katalogeintrag ist keine Bestellung eines zweiten
 * Exemplars.
 */
export function eintragHinzufuegen(wert: readonly string[] | undefined, name: string): string[] {
  const liste = wert ? [...wert] : [];
  if (!liste.includes(name)) liste.push(name);
  return liste;
}

/**
 * Entfernen über den INDEX, nicht über den Namen: Ein doppelter
 * Alteintrag aus der Freitext-Zeit (kommt vor, siehe Kommentar oben an
 * `geordneteAuswahl`) verliert damit nur das angeklickte Vorkommen, nicht
 * beide auf einmal.
 */
export function eintragEntfernenAnIndex(wert: readonly string[] | undefined, index: number): string[] {
  const liste = wert ? [...wert] : [];
  liste.splice(index, 1);
  return liste;
}
