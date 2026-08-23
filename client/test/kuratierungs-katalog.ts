/**
 * Kuratierungskatalog (Roadmap B3): Katalogaufbau, Suche und
 * ordnungserhaltendes Hinzufügen/Entfernen — DOM-frei, siehe
 * client/src/editor/kuratierungsKatalog.ts.
 *
 * Lauf:  npx tsx test/kuratierungs-katalog.ts
 */
import { FOLIAGE, FEATURES, SPAWN_TABLE, GRASLAND_FLORA_NAMEN } from '@wov/shared';
import {
  katalog,
  geordneteAuswahl,
  filtereKatalog,
  eintragHinzufuegen,
  eintragEntfernenAnIndex,
  type KatalogEintrag,
} from '../src/editor/kuratierungsKatalog';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ── Katalog deckt die echte Tabelle vollständig und ohne Dubletten ────
// Der Test bindet sich bewusst an FOLIAGE/FEATURES/SPAWN_TABLE.length und
// nicht an eine feste Zahl (die Roadmap nennt "120" — das war die Zählung
// VOR Block A; die echte Zahl heute ist 102, siehe Kopfkommentar der
// Katalogdatei). So bleibt der Test gültig, wenn eigene Locations oder
// Kreaturen dazukommen, ohne dass jemand eine Zahl nachpflegen muss.
const veg = katalog('vegetation');
check('Vegetation: ein Eintrag je FOLIAGE-Art', veg.length === FOLIAGE.length, `${veg.length} vs ${FOLIAGE.length}`);
check(
  'Vegetation: keine Dubletten',
  new Set(veg.map((e) => e.name)).size === veg.length
);
check(
  'Vegetation: jeder FOLIAGE-Name kommt im Katalog vor',
  FOLIAGE.every((f) => veg.some((e) => e.name === f.prefabName))
);

const loc = katalog('locations');
check('Locations: ein Eintrag je FEATURES-Eintrag', loc.length === FEATURES.length, `${loc.length} vs ${FEATURES.length}`);

const spw = katalog('spawns');
check('Spawns: ein Eintrag je SPAWN_TABLE-Eintrag', spw.length === SPAWN_TABLE.length, `${spw.length} vs ${SPAWN_TABLE.length}`);

// ── Einordnung ist wirklich aus den Daten, nicht erfunden ─────────────
const eiche1 = veg.find((e) => e.name === 'Eiche1');
check('Eiche1 steht im Katalog', eiche1 !== undefined);
check(
  'Eiche1 trägt „Grasland" nur, weil GRASLAND_FLORA_NAMEN sie wirklich enthält',
  eiche1 !== undefined && eiche1.einordnung.includes('Grasland') === GRASLAND_FLORA_NAMEN.includes('Eiche1')
);
check(
  'Eiche1 trägt eine Meter-Angabe',
  eiche1 !== undefined && eiche1.einordnung.some((t) => /\d+(\.\d+)? m$/.test(t))
);

// ── Bekannt/unbekannt, Reihenfolge erhalten ────────────────────────────
// Nachgebaut aus einem echten Fund in der DEV-Welt (Kopie unter /tmp
// geprüft, nicht Teil dieses Tests): Region insel-18 trägt
// `locations: ["grassland", "blackforest"]` — zwei Biomnamen im
// Locations-Freitextfeld, wo FEATURES heute nichts kennt. Der Katalog
// muss beide als unbekannt zeigen, nicht verschlucken.
const wert = ['Eiche1', 'grassland', 'Eiche2', 'blackforest'] as const;
const geordnet = geordneteAuswahl(wert, veg);
check('geordneteAuswahl behält die Reihenfolge', geordnet.map((e) => e.name).join(',') === wert.join(','));
check(
  'geordneteAuswahl markiert bekannt/unbekannt korrekt',
  geordnet.map((e) => e.bekannt).join(',') === 'true,false,true,false'
);
check(
  'unbekannter Eintrag hat leere Einordnung statt geratener Angaben',
  geordnet[1]!.einordnung.length === 0 && geordnet[3]!.einordnung.length === 0
);

// ── Filter ──────────────────────────────────────────────────────────
check('leere Suche liefert den vollen Katalog', filtereKatalog(veg, '').length === veg.length);
check('leere Suche (nur Leerzeichen) liefert den vollen Katalog', filtereKatalog(veg, '   ').length === veg.length);
const treffer = filtereKatalog(veg, 'eiche1');
check('Suche ist gross-/kleinschreibungsunabhängig und trifft den Namen', treffer.some((e) => e.name === 'Eiche1'));
check('Suche über die Einordnung findet ganze Bündel', filtereKatalog(veg, 'Nadelwald').length > 0);
check(
  'Suche über die Einordnung trifft nur, was das Bündel wirklich enthält',
  filtereKatalog(veg, 'Nadelwald').every((e) => e.einordnung.includes('Nadelwald'))
);

// ── Hinzufügen/Entfernen: ans Ende, ohne Dubletten, indexgenau ────────
check('Hinzufügen zu undefined ergibt eine Einer-Liste', eintragHinzufuegen(undefined, 'Eiche1').join(',') === 'Eiche1');
check(
  'Hinzufügen hängt ans Ende an',
  eintragHinzufuegen(['Eiche1', 'Eiche2'], 'Eiche3').join(',') === 'Eiche1,Eiche2,Eiche3'
);
check(
  'Hinzufügen eines bereits vorhandenen Namens ändert nichts',
  eintragHinzufuegen(['Eiche1', 'Eiche2'], 'Eiche1').join(',') === 'Eiche1,Eiche2'
);
check(
  'Hinzufügen eines Alt-Duplikats verdoppelt nicht erneut',
  eintragHinzufuegen(['Eiche1', 'Eiche1'], 'Eiche1').join(',') === 'Eiche1,Eiche1'
);

check(
  'Entfernen per Index trifft genau das angeklickte Vorkommen',
  eintragEntfernenAnIndex(['Eiche1', 'Eiche1', 'Eiche2'], 1).join(',') === 'Eiche1,Eiche2'
);
check(
  'Entfernen am Anfang lässt den Rest in Reihenfolge',
  eintragEntfernenAnIndex(['Eiche1', 'Eiche2', 'Eiche3'], 0).join(',') === 'Eiche2,Eiche3'
);
check('Entfernen aus undefined liefert eine leere Liste', eintragEntfernenAnIndex(undefined, 0).length === 0);

// ── Leerer Katalog ist ein eigener, klarer Zustand ────────────────────
// Locations/Spawns sind heute leer (siehe oben) — das ist eine ECHTE
// Aussage über den Datenbestand, keine kaputte Suche. Ein Aufrufer
// (KuratierungsAuswahl) unterscheidet das über `katalog(art).length === 0`.
const leererKatalog: readonly KatalogEintrag[] = [];
check('Filter über einen leeren Katalog bleibt leer', filtereKatalog(leererKatalog, 'irgendwas').length === 0);

console.log(fehler === 0 ? '\nOK — Kuratierungskatalog stimmt in jedem Fall' : `\n${fehler} ABWEICHUNGEN`);
process.exit(fehler > 0 ? 1 : 0);
