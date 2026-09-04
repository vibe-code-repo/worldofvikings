/**
 * Abgleich zwischen Whitelist, Prefab-Tabelle und Plattenbestand.
 *
 * Drei Listen müssen zusammenpassen, damit ein eigenes Modell im Spiel
 * ankommt: `EIGENE_MODELLE` (die Whitelist), `HINT_DEFS` (die Definition
 * mit Modellnamen) und die GLB-Datei selbst. Fällt eine aus, passiert
 * nichts Lautes — die Art bleibt einfach unsichtbar.
 *
 * Genau so steckt seit unbekannter Zeit `GrabhuegelMeadows` in der Welt:
 * platziert, aber ohne Modell. `pruefeLayout()` findet das für PLATZIERTE
 * Prefabs; dieser Abgleich findet es für ALLE registrierten.
 *
 * Lauf: npx tsx tools/modell-abgleich.ts
 */
import { existsSync } from 'node:fs';
import { EIGENE_MODELLE, findPrefabByName } from '@wov/shared';
/*
  `MODELL_ALIAS` aus dem Client MITLESEN statt nachbauen.

  Die Tabelle steht in `client/src/engine/AssetManager.ts` und nicht in
  `shared/` — zu Recht: Nur der Client öffnet GLBs. Ein Werkzeug, das den
  Dateibestand prüft, braucht sie trotzdem, sonst meldet es jeden Alias
  als fehlendes Modell. Genau das ist beim ersten Lauf passiert
  (`GrabhuegelGras`, das absichtlich `Grabhuegel.glb` lädt).

  Der Leser stand bis F5 hier als eigene Funktion und ein zweites Mal in
  `tools/asset-manifest.mjs`. Zwei Regexe über dieselbe Tabelle sind eine
  zweite Wahrheit über die erste — und die schwächere von beiden gab bei
  einer umbenannten Tabelle stillschweigend eine LEERE Zuordnung zurück.
  Jetzt lesen beide durch `tools/manifest-zuordnung.ts`, und der wirft.
*/
import { readModelAlias } from './manifest-zuordnung.js';

const alias = readModelAlias(process.cwd());
const ohneDef: string[] = [];
const ohneDatei: string[] = [];

for (const name of EIGENE_MODELLE) {
  const def = findPrefabByName(name);
  if (!def) {
    ohneDef.push(name);
    continue;
  }
  const gemeint = def.model ?? name;
  const datei = alias[gemeint] ?? gemeint;
  if (!existsSync(`assets/models/${datei}.glb`)) ohneDatei.push(`${name} → ${datei}.glb`);
}

console.log(`Whitelist: ${EIGENE_MODELLE.length} Einträge, ${Object.keys(alias).length} Alias-Zuordnung(en)`);
console.log(`ohne Prefab-Definition: ${ohneDef.length}${ohneDef.length ? '  ' + ohneDef.join(', ') : ''}`);
console.log(`ohne GLB-Datei: ${ohneDatei.length}`);
for (const z of ohneDatei) console.log('   ', z);
