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
import { existsSync, readFileSync } from 'node:fs';
import { EIGENE_MODELLE, findPrefabByName } from '@wov/shared';

/**
 * `MODELL_ALIAS` aus dem Client MITLESEN statt nachbauen.
 *
 * Die Tabelle steht in `client/src/engine/AssetManager.ts` und nicht in
 * `shared/` — zu Recht: Nur der Client öffnet GLBs. Ein Werkzeug, das den
 * Dateibestand prüft, braucht sie trotzdem, sonst meldet es jeden Alias
 * als fehlendes Modell. Genau das ist beim ersten Lauf passiert
 * (`GrabhuegelGras`, das absichtlich `Grabhuegel.glb` lädt).
 *
 * Deshalb wird sie hier GELESEN und nicht kopiert: Eine zweite Liste
 * derselben Zuordnung wäre eine zweite Wahrheit, und die läge nach dem
 * nächsten Alias falsch — was ein Prüfwerkzeug schlimmer macht als keins.
 */
function aliasTabelle(): Record<string, string> {
  const quelle = readFileSync('client/src/engine/AssetManager.ts', 'utf8');
  const block = /const MODELL_ALIAS[^{]*\{([^}]*)\}/.exec(quelle)?.[1] ?? '';
  const tabelle: Record<string, string> = {};
  for (const m of block.matchAll(/(\w+)\s*:\s*'([^']+)'/g)) tabelle[m[1]!] = m[2]!;
  return tabelle;
}

const alias = aliasTabelle();
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
