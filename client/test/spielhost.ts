/**
 * Die Dungeon-Knöpfe „Betreten" bleiben auf dem Ursprung des Editors.
 *
 * Früher machte `spielHost()` aus `editor.dev.world-of-vikings.com` den Host
 * `play.dev.world-of-vikings.com`. Der steht nicht mehr in `WOV_ALLOWED_HOSTS`
 * (Vite antwortet dort 403 „Blocked request"), und ein anderer Host heißt auch
 * anderer `localStorage`: Sitzung und Entwurf wären im Spiel nicht zu sehen.
 * Jetzt bauen beide Kataloge nur noch einen Pfad (`spielAdresse.ts`).
 *
 * Geprüft wird die Adressbildung und, am Syntaxbaum, dass in beiden Katalogen
 * kein Host mehr in die Adresse gerät.
 */
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { dungeonUrl, gameUrl } from '../src/editor/spielAdresse';

let fehler = 0;
function pruefe(ok: boolean, was: string): void {
  if (!ok) fehler++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${was}`);
}

// ── Die Adresse: nur ein Pfad, nie ein Host ─────────────────────────────────
for (const basis of ['/play/', '/', '/play']) {
  const ist = dungeonUrl('steingrab-2', basis);
  pruefe(ist === `${gameUrl('', basis)}?dungeon=steingrab-2`, `dungeonUrl mit Basis ${basis}: ${ist}`);
  pruefe(ist.startsWith('/') && !ist.startsWith('//') && !/^[a-z]+:/i.test(ist), `Basis ${basis}: ein Pfad auf dem eigenen Ursprung`);
}
pruefe(dungeonUrl('a b&c=d/ö', '/play/') === '/play/?dungeon=a%20b%26c%3Dd%2F%C3%B6', 'die Kennung wird kodiert (Leerzeichen, &, =, /, Umlaut)');

// ── Die Kataloge ────────────────────────────────────────────────────────────
const KATALOGE = ['../src/editor/DungeonKatalog.ts', '../src/editor/dungeon2/Dungeon2Katalog.ts'];
for (const rel of KATALOGE) {
  const text = readFileSync(new URL(rel, import.meta.url), 'utf8');
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const knoten: ts.Node[] = [];
  const geh = (k: ts.Node): void => {
    knoten.push(k);
    ts.forEachChild(k, geh);
  };
  geh(sf);

  // Kein Aufruf und keine Definition von spielHost/spielHost2.
  const namen = knoten.filter((k) => ts.isIdentifier(k) && /^spielHost2?$/.test(k.text));
  pruefe(namen.length === 0, `${rel}: kein spielHost/spielHost2 mehr (${namen.length} Treffer)`);

  // Die Adresse eines window.open enthält weder Protokoll noch Host.
  const oeffner = knoten.filter(
    (k): k is ts.CallExpression =>
      ts.isCallExpression(k) &&
      ts.isPropertyAccessExpression(k.expression) &&
      ts.isIdentifier(k.expression.expression) &&
      k.expression.expression.text === 'window' &&
      k.expression.name.text === 'open'
  );
  pruefe(oeffner.length === 2, `${rel}: zwei window.open (${oeffner.length})`);
  for (const o of oeffner) {
    const arg = o.arguments[0];
    const quelle = ts.isIdentifier(arg)
      ? knoten.find((k): k is ts.VariableDeclaration => ts.isVariableDeclaration(k) && ts.isIdentifier(k.name) && k.name.text === arg.text)?.initializer
      : arg;
    const ruft = quelle !== undefined && ts.isCallExpression(quelle) && ts.isIdentifier(quelle.expression) && ['gameUrl', 'dungeonUrl'].includes(quelle.expression.text);
    pruefe(ruft, `${rel}: window.open(${arg?.getText().slice(0, 40)}) geht über gameUrl/dungeonUrl, ohne Host`);
  }
  // Kein Adresstext, der location.protocol/host zusammenklebt.
  const geklebt = knoten.filter((k) => ts.isTemplateExpression(k) && /location\.(protocol|host)/.test(k.getText()) && !/wss?|\/ws/.test(k.getText()));
  pruefe(geklebt.length === 0, `${rel}: keine Adresse aus location.protocol/host (${geklebt.length})`);
}

console.log(fehler === 0 ? '\nAlle Adressen bleiben auf dem eigenen Ursprung.' : `\n${fehler} falsch.`);
process.exit(fehler > 0 ? 1 : 0);
