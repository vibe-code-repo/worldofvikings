/**
 * Move proof: drafts the manifest of a step from two states.
 *
 *   node_modules/.bin/tsx tools/verschiebung/entwurf.ts --alt <ref> --neu <ref|arbeitsbaum> \
 *        --quelle <file> [--klasse <name>] --ziel <file> [--ziel <file> ...] --einstieg <file> [...]
 *
 * For every target file it lists the names the file declares on module level that the OLD source
 * file declares too (form 0), and the functions that carry the name of a method of the class
 * (form k). The draft has no releases: the proof names the findings that need one, and a release
 * needs a reason a person writes.
 *
 * The draft is a help for writing the manifest, not a part of the proof. Read it before use.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { ArbeitsbaumStand, GitStand, repoWurzel, type Stand } from './stand';
import { anweisungen, deklarierteNamen, liesDatei, mitgliedName } from './stuecke';

interface Angaben {
  alt: string;
  neu: string;
  quelle: string;
  klasse?: string;
  ziele: string[];
  einstiege: string[];
}

function leseAngaben(argv: readonly string[]): Angaben {
  const a: Partial<Angaben> & { ziele: string[]; einstiege: string[] } = { ziele: [], einstiege: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const wert = argv[i + 1];
    if (wert === undefined) throw new Error(`${argv[i]} needs a value`);
    switch (argv[i]) {
      case '--alt': a.alt = wert; break;
      case '--neu': a.neu = wert; break;
      case '--quelle': a.quelle = wert; break;
      case '--klasse': a.klasse = wert; break;
      case '--ziel': a.ziele.push(wert); break;
      case '--einstieg': a.einstiege.push(wert); break;
      default: throw new Error(`unknown switch ${argv[i]}`);
    }
  }
  if (!a.alt || !a.neu || !a.quelle || a.ziele.length === 0) throw new Error('needs --alt, --neu, --quelle and at least one --ziel');
  return a as Angaben;
}

export function entwirf(a: Angaben, alt: Stand, neu: Stand): unknown {
  const altText = alt.lies(a.quelle);
  if (altText === undefined) throw new Error(`${a.quelle} does not exist in the old state`);
  const quelle = liesDatei('alt', a.quelle, altText);
  const altNamen = new Set(anweisungen(quelle).stuecke.flatMap((s) => deklarierteNamen(s.knoten)));
  const klasse = a.klasse === undefined ? undefined : quelle.sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === a.klasse);
  const methoden = new Set((klasse?.members ?? []).filter(ts.isMethodDeclaration).map((m) => mitgliedName(m) ?? ''));
  const ziele = a.ziele.map((pfad) => {
    const text = neu.lies(pfad);
    if (text === undefined) throw new Error(`${pfad} does not exist in the new state`);
    const datei = liesDatei('neu', pfad, text);
    const woertlich: string[] = [];
    const verschoben: string[] = [];
    let kontextTyp: string | undefined;
    for (const s of anweisungen(datei).stuecke) {
      const k = s.knoten;
      const namen = deklarierteNamen(k);
      if (ts.isFunctionDeclaration(k) && k.name && methoden.has(k.name.text) && !altNamen.has(k.name.text)) {
        verschoben.push(k.name.text);
        const typ = k.parameters[0]?.type;
        if (typ && ts.isTypeReferenceNode(typ) && ts.isIdentifier(typ.typeName)) kontextTyp = typ.typeName.text;
        continue;
      }
      for (const n of namen) if (altNamen.has(n)) woertlich.push(n);
    }
    return {
      datei: pfad,
      ...(woertlich.length > 0 ? { woertlich } : {}),
      ...(verschoben.length > 0 ? { methoden: verschoben, kontext: { parameter: 'k', typ: kontextTyp ?? 'Kontext' } } : {}),
    };
  });
  return {
    version: 1,
    alt: a.alt.startsWith('git:') ? a.alt : `git:${a.alt}`,
    neu: a.neu === 'arbeitsbaum' || a.neu.startsWith('git:') ? a.neu : `git:${a.neu}`,
    quelle: a.quelle,
    ...(a.klasse !== undefined && ziele.some((z) => 'methoden' in z) ? { klasse: a.klasse } : {}),
    ziele,
    einstiege: a.einstiege.length > 0 ? a.einstiege : [a.quelle],
    freigaben: [],
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const a = leseAngaben(process.argv.slice(2));
    const wurzel = repoWurzel(process.cwd());
    const oeffne = (s: string): Stand => (s === 'arbeitsbaum' ? new ArbeitsbaumStand(wurzel) : new GitStand(wurzel, s.replace(/^git:/, '')));
    process.stdout.write(`${JSON.stringify(entwirf(a, oeffne(a.alt), oeffne(a.neu)), null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`entwurf: ${(e as Error).message}\n`);
    process.exitCode = 2;
  }
}
