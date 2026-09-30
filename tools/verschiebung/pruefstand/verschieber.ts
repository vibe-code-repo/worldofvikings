/**
 * Test bench of the move proof: a mover.
 *
 * Builds, from the text of an old source file, the cut a careful worker would build by hand:
 * the rest with its forwarders, imports and re-exports, and the target files with header comment,
 * imports, the moved declarations and an export list.
 *
 * The mover is deliberately NOT built from the modules of the proof. It finds the extents of the
 * statements, the `this` of a method and the names a text uses with its own code. If mover and
 * proof shared that code, a mistake in it would make both agree on something wrong.
 *
 * Used by the self-tests (`tools/test/verschiebung-*.ts`) and by the probes on real files.
 */
import { posix } from 'node:path';
import ts from 'typescript';

const K = ts.SyntaxKind;

export interface ZielAuftrag {
  datei: string;
  woertlich?: string[];
  methoden?: string[];
  /** Name of the context parameter and of the context type. Defaults: `k`, `Kontext`. */
  kontext?: { parameter?: string; typ?: string };
  /** Text of the header comment, without the comment signs. */
  kopf?: string;
}

export interface Auftrag {
  quelle: string;
  klasse?: string;
  ziele: ZielAuftrag[];
  /**
   * The file that provides the context type of the class, `type <typ><K extends keyof Klasse> =
   * Pick<Klasse, K>`. Without it a target file builds its context type with `Pick` itself.
   */
  kontextDatei?: { datei: string; typ: string };
}

export interface Schnitt {
  rest: string;
  ziele: Record<string, string>;
  /** Further new files: the context file of the class. */
  weitere: Record<string, string>;
  /** Text of every forwarder by method name, as it stands in the rest. */
  weiterleitungen: Record<string, string>;
  /** Members that lost `private` or `protected`. */
  gelockert: string[];
}

interface Bereich {
  von: number;
  bis: number;
}

interface Ersatz extends Bereich {
  neu: string;
}

function ersetze(text: string, stellen: readonly Ersatz[]): string {
  let aus = text;
  for (const s of [...stellen].sort((a, b) => b.von - a.von || b.bis - a.bis)) aus = aus.slice(0, s.von) + s.neu + aus.slice(s.bis);
  return aus;
}

/** Start of the lines that belong to a node: after the line on which the node before it ended. */
function beginnMitVorlauf(text: string, vorEnde: number, start: number): number {
  const zeilenEnde = text.indexOf('\n', vorEnde);
  if (zeilenEnde < 0 || zeilenEnde >= start) return vorEnde;
  const dazwischen = text.slice(vorEnde, zeilenEnde);
  const nurNachlauf = /^[ \t]*(\/\/.*|(\/\*([^*\r\n]|\*(?!\/))*\*\/[ \t]*)*(\/\/.*)?)?\r?$/.test(dazwischen);
  return nurNachlauf ? zeilenEnde + 1 : vorEnde;
}

/** Extents of sibling nodes: each from the end of the line of its predecessor to the end of its own line. */
function ausdehnungen(text: string, knoten: readonly ts.Node[], start: number, ende: number, sf: ts.SourceFile): Bereich[] {
  const anfaenge = knoten.map((k, i) => (i === 0 ? start : beginnMitVorlauf(text, knoten[i - 1]!.end, k.getStart(sf))));
  return knoten.map((k, i) => ({ von: anfaenge[i]!, bis: i + 1 < knoten.length ? anfaenge[i + 1]! : Math.max(k.end, beginnMitVorlauf(text, k.end, ende)) }));
}

/** Section line `// -- title --`, written with box drawing dashes. */
const ABSCHNITT = /^[ \t]*\/\/ \u2500\u2500/u;

/** Lines at the start of an extent that stay where they are: empty lines and section lines up to the last section line. */
function bleibendeZeilen(text: string, bisKnoten: number): string {
  let p = 0;
  let bis = 0;
  for (;;) {
    const n = text.indexOf('\n', p);
    if (n < 0 || n >= bisKnoten) break;
    const zeile = text.slice(p, n).replace(/\r$/, '');
    if (zeile.trim() !== '' && !ABSCHNITT.test(zeile)) break;
    p = n + 1;
    if (ABSCHNITT.test(zeile)) bis = p;
  }
  return text.slice(0, bis);
}

function namenVon(st: ts.Node): string[] {
  if (ts.isVariableStatement(st)) return st.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
  if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) return [st.name.text];
  return [];
}

const hat = (n: ts.Node, art: ts.SyntaxKind): boolean => ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === art);
const nurTyp = (st: ts.Node): boolean => ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st);

/** Words of a text that can be names. Rough on purpose: a name too many imports too much, never too little. */
function woerter(text: string): Set<string> {
  return new Set(text.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []);
}

function relativ(von: string, nach: string): string {
  let r = posix.relative(posix.dirname(von), nach).replace(/\.(ts|tsx)$/, '');
  if (!r.startsWith('.')) r = `./${r}`;
  return r;
}

function verlegt(spec: string, von: string, nach: string): string {
  if (!spec.startsWith('.')) return spec;
  let r = posix.relative(posix.dirname(nach), posix.join(posix.dirname(von), spec));
  if (!r.startsWith('.')) r = `./${r}`;
  return r;
}

interface Einfuhr {
  knoten: ts.ImportDeclaration;
  spec: string;
  nurTyp: boolean;
  standard: string | null;
  namensraum: string | null;
  namen: { text: string; lokal: string }[];
}

function einfuhr(d: ts.ImportDeclaration, sf: ts.SourceFile): Einfuhr {
  const ic = d.importClause;
  const e: Einfuhr = { knoten: d, spec: (d.moduleSpecifier as ts.StringLiteral).text, nurTyp: !!ic?.isTypeOnly, standard: ic?.name?.text ?? null, namensraum: null, namen: [] };
  if (ic?.namedBindings) {
    if (ts.isNamespaceImport(ic.namedBindings)) e.namensraum = ic.namedBindings.name.text;
    else for (const x of ic.namedBindings.elements) e.namen.push({ text: x.getText(sf), lokal: x.name.text });
  }
  return e;
}

function importZeile(e: Einfuhr, spec: string, namen: readonly { text: string }[], mitStandard: boolean, mitNamensraum: boolean): string | null {
  const teile: string[] = [];
  if (mitStandard && e.standard) teile.push(e.standard);
  if (mitNamensraum && e.namensraum) teile.push(`* as ${e.namensraum}`);
  if (namen.length > 0) teile.push(`{ ${namen.map((n) => n.text).join(', ')} }`);
  if (teile.length === 0) return null;
  return `import ${e.nurTyp ? 'type ' : ''}${teile.join(', ')} from '${spec}';`;
}

/** Every `this` that belongs to the method, as ranges of the text. */
function thisDerMethode(m: ts.MethodDeclaration, sf: ts.SourceFile): { stellen: Bereich[]; glieder: Set<string>; nackt: boolean } {
  const stellen: Bereich[] = [];
  const glieder = new Set<string>();
  let nackt = false;
  const lauf = (n: ts.Node, tiefe: number): void => {
    const neuGebunden =
      tiefe > 0 &&
      (n.kind === K.FunctionExpression || n.kind === K.FunctionDeclaration || n.kind === K.MethodDeclaration || n.kind === K.GetAccessor || n.kind === K.SetAccessor || n.kind === K.Constructor || n.kind === K.ClassExpression || n.kind === K.ClassDeclaration || n.kind === K.ClassStaticBlockDeclaration);
    if (neuGebunden) return;
    if (n.kind === K.ThisKeyword || (ts.isIdentifier(n) && n.text === 'this')) {
      stellen.push({ von: n.getStart(sf), bis: n.end });
      const p = n.parent;
      if (ts.isPropertyAccessExpression(p) && p.expression === n) glieder.add(p.name.text);
      else if (ts.isQualifiedName(p) && p.left === n) glieder.add(p.right.text);
      else nackt = true;
    }
    ts.forEachChild(n, (k) => lauf(k, tiefe + 1));
  };
  m.typeParameters?.forEach((t) => lauf(t, 1));
  m.parameters.forEach((t) => lauf(t, 1));
  if (m.type) lauf(m.type, 1);
  if (m.body) lauf(m.body, 1);
  return { stellen, glieder, nackt };
}

/** Line starts inside a range that must keep their indentation: inside template texts, strings and stubborn comments. */
function festeZeilen(text: string, von: number, bis: number, sf: ts.SourceFile, wurzel: ts.Node, einzug: number): Set<number> {
  const fest = new Set<number>();
  const zeilenIn = (a: number, b: number): number[] => {
    const aus: number[] = [];
    for (let i = text.indexOf('\n', a); i >= 0 && i < b; i = text.indexOf('\n', i + 1)) aus.push(i + 1);
    return aus;
  };
  let ende = von;
  const blatt = (n: ts.Node): void => {
    if (n.kind >= K.FirstJSDocNode && n.kind <= K.LastJSDocNode) return; // a comment, judged with the comments
    const kinder = n.getChildren(sf);
    if (kinder.length > 0) {
      kinder.forEach(blatt);
      return;
    }
    if (n.end === n.pos) return;
    const start = n.getStart(sf);
    for (const m of text.slice(ende, start).matchAll(/\/\*[\s\S]*?\*\//g)) {
      const a = ende + m.index;
      const zeilen = zeilenIn(a, a + m[0].length);
      const stur = zeilen.some((z) => {
        const zeile = text.slice(z, text.indexOf('\n', z) < 0 ? text.length : text.indexOf('\n', z));
        return zeile.trim() !== '' && /^[ \t]*/.exec(zeile)![0].length < einzug;
      });
      if (stur) zeilen.forEach((z) => fest.add(z));
    }
    for (const z of zeilenIn(start, n.end)) fest.add(z);
    ende = Math.max(ende, n.end);
  };
  // The comments before the node are in the first gap: the walk starts at the start of the range.
  blatt(wurzel);
  void bis;
  return fest;
}

/** Takes `einzug` leading blanks from every line of the range that may lose them, after the replacements were made. */
function rueckeAus(text: string, von: number, bis: number, stellen: readonly Ersatz[], fest: ReadonlySet<number>, einzug: number): string {
  const zeilenStarts: number[] = [von];
  for (let i = text.indexOf('\n', von); i >= 0 && i + 1 < bis; i = text.indexOf('\n', i + 1)) zeilenStarts.push(i + 1);
  let aus = '';
  zeilenStarts.forEach((z, nr) => {
    const ende = nr + 1 < zeilenStarts.length ? zeilenStarts[nr + 1]! : bis;
    const hier = stellen.filter((s) => s.von >= z && s.bis <= ende).map((s) => ({ von: s.von - z, bis: s.bis - z, neu: s.neu }));
    let zeile = ersetze(text.slice(z, ende), hier);
    if (!fest.has(z)) {
      const rand = /^[ \t]*/.exec(zeile)![0].length;
      zeile = zeile.slice(Math.min(rand, einzug));
    }
    aus += zeile;
  });
  return aus;
}

export function verschiebe(altText: string, auftrag: Auftrag): Schnitt {
  const sf = ts.createSourceFile(auftrag.quelle, altText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const anweisungen = [...sf.statements];
  const ext = ausdehnungen(altText, anweisungen, 0, altText.length, sf);
  const importe = anweisungen.filter(ts.isImportDeclaration).map((d) => einfuhr(d, sf));
  const zielVon = new Map<string, ZielAuftrag>();
  for (const z of auftrag.ziele) for (const n of z.woertlich ?? []) zielVon.set(n, z);
  const methodeVon = new Map<string, ZielAuftrag>();
  for (const z of auftrag.ziele) for (const n of z.methoden ?? []) methodeVon.set(n, z);

  const restErsatz: Ersatz[] = [];
  const stuecke = new Map<string, { von: number; text: string; namen: string[]; typ: boolean; exportiert: boolean }[]>();
  const fuer = (z: ZielAuftrag): { von: number; text: string; namen: string[]; typ: boolean; exportiert: boolean }[] => {
    let l = stuecke.get(z.datei);
    if (!l) {
      l = [];
      stuecke.set(z.datei, l);
    }
    return l;
  };
  const woStehtEs = new Map<string, { ziel: ZielAuftrag; typ: boolean }>();
  const warExportiert: { name: string; ziel: ZielAuftrag; typ: boolean }[] = [];

  // ── form 0 ──
  anweisungen.forEach((st, i) => {
    const namen = namenVon(st);
    const z = namen.length > 0 ? zielVon.get(namen[0]!) : undefined;
    if (!z || !namen.every((n) => zielVon.get(n) === z)) return;
    const e = ext[i]!;
    const bleibt = bleibendeZeilen(altText.slice(e.von, e.bis), st.getStart(sf) - e.von);
    const text = altText.slice(e.von + bleibt.length, e.bis);
    // Where a section line stayed behind, the moved text no longer starts with its empty line.
    fuer(z).push({ von: e.von, text: bleibt !== '' && !/^[ \t]*\r?\n/.test(text) ? `\n${text}` : text, namen, typ: nurTyp(st), exportiert: hat(st, K.ExportKeyword) });
    restErsatz.push({ von: e.von + bleibt.length, bis: e.bis, neu: '' });
    for (const n of namen) {
      woStehtEs.set(n, { ziel: z, typ: nurTyp(st) });
      if (hat(st, K.ExportKeyword)) warExportiert.push({ name: n, ziel: z, typ: nurTyp(st) });
    }
  });

  // ── form k ──
  const weiterleitungen: Record<string, string> = {};
  const kontextGlieder = new Map<string, Set<string>>();
  const kontextNackt = new Map<string, boolean>();
  const klasse = auftrag.klasse === undefined ? undefined : anweisungen.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === auftrag.klasse);
  const funktionsNamen = new Map<string, ZielAuftrag>();
  if (klasse) {
    const glieder = [...klasse.members];
    const innen = ausdehnungen(altText, glieder, altText.indexOf('\n', klasse.members.pos) + 1, klasse.end - 1, sf);
    glieder.forEach((m, i) => {
      // An overload signature has no body: it stays in the class, the implementation moves.
      if (!ts.isMethodDeclaration(m) || !ts.isIdentifier(m.name) || !m.body) return;
      const z = methodeVon.get(m.name.text);
      if (!z) return;
      const name = m.name.text;
      const kontext = z.kontext?.parameter ?? 'k';
      const ktyp = z.kontext?.typ ?? 'Kontext';
      const e = innen[i]!;
      const start = m.getStart(sf);
      const zeilenStart = altText.lastIndexOf('\n', start - 1) + 1;
      const einzug = start - zeilenStart;
      const t = thisDerMethode(m, sf);
      const gl = kontextGlieder.get(z.datei) ?? new Set<string>();
      kontextGlieder.set(z.datei, gl);
      for (const g of t.glieder) gl.add(g);
      if (t.nackt) kontextNackt.set(z.datei, true);
      const stellen: Ersatz[] = t.stellen.map((s) => ({ ...s, neu: kontext }));
      const mods = ts.getModifiers(m) ?? [];
      for (const mod of mods) {
        if (mod.kind === K.PrivateKeyword || mod.kind === K.ProtectedKeyword || mod.kind === K.PublicKeyword) {
          let bis = mod.end;
          while (altText[bis] === ' ') bis++;
          stellen.push({ von: mod.getStart(sf), bis, neu: '' });
        }
      }
      const vorName = (m.asteriskToken ?? m.name).getStart(sf);
      stellen.push({ von: vorName, bis: vorName, neu: 'function ' });
      stellen.push({ von: m.parameters.pos, bis: m.parameters.pos, neu: `${kontext}: ${ktyp}${m.parameters.length > 0 ? ', ' : ''}` });
      const fest = festeZeilen(altText, e.von, e.bis, sf, m, einzug);
      const abschnitt = bleibendeZeilen(altText.slice(e.von, e.bis), start - e.von);
      const funktion = rueckeAus(altText, e.von + abschnitt.length, e.bis, stellen, fest, einzug);
      fuer(z).push({ von: e.von, text: abschnitt !== '' && !/^[ \t]*\r?\n/.test(funktion) ? `\n${funktion}` : funktion, namen: [name], typ: false, exportiert: false });
      funktionsNamen.set(name, z);

      // the forwarder: signature of the method without `async`, body with the one call
      const kopfEnde = m.body!.getStart(sf);
      const kopfStellen: Ersatz[] = [];
      for (const mod of mods) {
        if (mod.kind === K.AsyncKeyword) {
          let bis = mod.end;
          while (altText[bis] === ' ') bis++;
          kopfStellen.push({ von: mod.getStart(sf) - start, bis: bis - start, neu: '' });
        }
      }
      const kopf = ersetze(altText.slice(start, kopfEnde), kopfStellen);
      const argumente = ['this', ...m.parameters.map((p) => `${p.dotDotDotToken ? '...' : ''}${p.name.getText(sf)}`)];
      const rand = ' '.repeat(einzug);
      const weiter = `${kopf}{\n${rand}  return ${name}(${argumente.join(', ')});\n${rand}}`;
      weiterleitungen[name] = weiter;
      const nachlauf = altText.slice(m.end, e.bis);
      // Empty lines and section lines in front of the method stay in front of the forwarder; its comment moves with the method.
      const leerzeilen = abschnitt !== '' ? abschnitt : /^(?:[ \t]*\r?\n)*/.exec(altText.slice(e.von, start))![0];
      restErsatz.push({ von: e.von, bis: e.bis, neu: `${leerzeilen}${rand}${weiter}${nachlauf.includes('\n') ? '\n' : ''}` });
    });
  }

  // ── members that must become public: named by a context type ──
  const gelockert: string[] = [];
  if (klasse) {
    const alle = new Set<string>();
    for (const s of kontextGlieder.values()) for (const n of s) alle.add(n);
    for (const m of klasse.members) {
      const n = (m as ts.NamedDeclaration).name;
      if (!n || !ts.isIdentifier(n) || !alle.has(n.text)) continue;
      const mod = (ts.canHaveModifiers(m) ? (ts.getModifiers(m) ?? []) : []).find((x) => x.kind === K.PrivateKeyword || x.kind === K.ProtectedKeyword);
      if (!mod) continue;
      gelockert.push(n.text);
      let bis = mod.end;
      while (altText[bis] === ' ') bis++;
      const bereich = { von: mod.getStart(sf), bis, neu: '' };
      const inWeiterleitung = restErsatz.find((r) => r.von <= bereich.von && r.bis >= bereich.bis && r.neu !== '');
      if (inWeiterleitung) {
        const wort = mod.kind === K.PrivateKeyword ? 'private ' : 'protected ';
        inWeiterleitung.neu = inWeiterleitung.neu.replace(wort, '');
        weiterleitungen[n.text] = weiterleitungen[n.text]!.replace(wort, '');
      } else restErsatz.push(bereich);
    }
    // Parameter properties of the constructor are members too.
    for (const m of klasse.members) {
      if (!ts.isConstructorDeclaration(m)) continue;
      for (const par of m.parameters) {
        if (!ts.isIdentifier(par.name) || !alle.has(par.name.text)) continue;
        const mod = (ts.getModifiers(par) ?? []).find((x) => x.kind === K.PrivateKeyword || x.kind === K.ProtectedKeyword);
        if (!mod) continue;
        gelockert.push(par.name.text);
        let bis = mod.end;
        while (altText[bis] === ' ') bis++;
        restErsatz.push({ von: mod.getStart(sf), bis, neu: '' });
      }
    }
  }

  // ── the rest: text, imports, re-exports ──
  const importBereiche = importe.map((e) => ext[anweisungen.indexOf(e.knoten)]!);
  const restOhneImporte = ersetze(altText, [...restErsatz, ...importBereiche.map((b) => ({ ...b, neu: '' }))]);
  const restWoerter = woerter(restOhneImporte.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ''));
  const altOhneImporte = ersetze(altText, importBereiche.map((b) => ({ ...b, neu: '' })));
  const altWoerter = woerter(altOhneImporte.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ''));
  const importErsatz: Ersatz[] = [];
  importe.forEach((e, i) => {
    const b = importBereiche[i]!;
    const bleibt = (lokal: string): boolean => restWoerter.has(lokal) || !altWoerter.has(lokal);
    const namen = e.namen.filter((n) => bleibt(n.lokal));
    const std = e.standard === null || bleibt(e.standard);
    const ns = e.namensraum === null || bleibt(e.namensraum);
    if (namen.length === e.namen.length && std && ns) return;
    if (!e.knoten.importClause) return;
    const zeile = importZeile(e, e.spec, namen, std, ns);
    if (zeile === null) importErsatz.push({ von: b.von, bis: b.bis, neu: '' });
    else importErsatz.push({ von: e.knoten.getStart(sf), bis: e.knoten.end, neu: zeile });
  });
  const neueZeilen: string[] = [];
  for (const z of auftrag.ziele) {
    const spec = relativ(auftrag.quelle, z.datei);
    const werte: string[] = [];
    const typen: string[] = [];
    const zeilen: string[] = [];
    for (const s of stuecke.get(z.datei) ?? []) {
      for (const n of s.namen) {
        if (funktionsNamen.has(n) || restWoerter.has(n)) (s.typ ? typen : werte).push(n);
      }
    }
    if (werte.length > 0) zeilen.push(`import { ${werte.join(', ')} } from '${spec}';`);
    if (typen.length > 0) zeilen.push(`import type { ${typen.join(', ')} } from '${spec}';`);
    // The new import lines stand behind the last import line of the old state.
    neueZeilen.push(...zeilen);
  }
  for (const z of auftrag.ziele) {
    const spec = relativ(auftrag.quelle, z.datei);
    const werte = [...new Set(warExportiert.filter((w) => w.ziel === z && !w.typ).map((w) => w.name))];
    const typen = [...new Set(warExportiert.filter((w) => w.ziel === z && w.typ).map((w) => w.name))];
    if (werte.length > 0) neueZeilen.push(`export { ${werte.join(', ')} } from '${spec}';`);
    if (typen.length > 0) neueZeilen.push(`export type { ${typen.join(', ')} } from '${spec}';`);
  }
  const letzter = importe[importe.length - 1];
  const einfuegen: Ersatz[] = [];
  if (neueZeilen.length > 0) {
    if (letzter) {
      const b = importBereiche[importe.length - 1]!;
      einfuegen.push({ von: b.bis, bis: b.bis, neu: `${neueZeilen.join('\n')}\n` });
    } else {
      const erste = ext[0];
      const wo = erste ? anweisungen[0]!.getStart(sf) : 0;
      einfuegen.push({ von: wo, bis: wo, neu: `${neueZeilen.join('\n')}\n` });
    }
  }
  const rest = ersetze(altText, [...restErsatz, ...importErsatz, ...einfuegen]);

  // ── the target files ──
  const ziele: Record<string, string> = {};
  for (const z of auftrag.ziele) {
    const liste = [...(stuecke.get(z.datei) ?? [])].sort((a, b) => a.von - b.von);
    const rumpf = liste.map((s) => s.text).join('');
    const benutzt = woerter(rumpf.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ''));
    const zeilen: string[] = [];
    for (const e of importe) {
      const namen = e.namen.filter((n) => benutzt.has(n.lokal));
      const zeile = importZeile(e, verlegt(e.spec, auftrag.quelle, z.datei), namen, e.standard !== null && benutzt.has(e.standard), e.namensraum !== null && benutzt.has(e.namensraum));
      if (zeile !== null) zeilen.push(zeile);
    }
    for (const anderes of auftrag.ziele) {
      if (anderes === z) continue;
      const werte: string[] = [];
      const typen: string[] = [];
      for (const [n, w] of woStehtEs) if (w.ziel === anderes && benutzt.has(n)) (w.typ ? typen : werte).push(n);
      const spec = relativ(z.datei, anderes.datei);
      if (werte.length > 0) zeilen.push(`import { ${werte.join(', ')} } from '${spec}';`);
      if (typen.length > 0) zeilen.push(`import type { ${typen.join(', ')} } from '${spec}';`);
    }
    const ktyp = z.kontext?.typ ?? 'Kontext';
    const hatMethoden = (z.methoden ?? []).length > 0;
    const ueberDatei = auftrag.kontextDatei !== undefined && !kontextNackt.get(z.datei);
    if (hatMethoden && auftrag.klasse !== undefined) {
      if (ueberDatei) zeilen.push(`import type { ${auftrag.kontextDatei!.typ} } from '${relativ(z.datei, auftrag.kontextDatei!.datei)}';`);
      else zeilen.push(`import type { ${auftrag.klasse} } from '${relativ(z.datei, auftrag.quelle)}';`);
    }
    let text = `/**\n * ${(z.kopf ?? `Moved here unchanged from ${posix.basename(auftrag.quelle)}.`).split('\n').join('\n * ')}\n */\n`;
    if (zeilen.length > 0) text += `${zeilen.join('\n')}\n`;
    if (hatMethoden && auftrag.klasse !== undefined) {
      const glieder = [...(kontextGlieder.get(z.datei) ?? [])].sort();
      const schluessel = glieder.length > 0 ? glieder.map((g) => `'${g}'`).join(' | ') : 'never';
      const typ = kontextNackt.get(z.datei) ? auftrag.klasse : ueberDatei ? `${auftrag.kontextDatei!.typ}<${schluessel}>` : `Pick<${auftrag.klasse}, ${schluessel}>`;
      text += `\ntype ${ktyp} = ${typ};\n`;
    }
    text += rumpf;
    const andereWoerter = new Set<string>(restWoerter);
    for (const anderes of auftrag.ziele) {
      if (anderes === z) continue;
      for (const s of stuecke.get(anderes.datei) ?? []) for (const w of woerter(s.text)) andereWoerter.add(w);
    }
    const werte: string[] = [];
    const typen: string[] = [];
    for (const s of liste) {
      if (s.exportiert) continue;
      for (const n of s.namen) if (funktionsNamen.has(n) || andereWoerter.has(n)) (s.typ ? typen : werte).push(n);
    }
    if (werte.length + typen.length > 0) text += '\n';
    if (werte.length > 0) text += `export { ${werte.join(', ')} };\n`;
    if (typen.length > 0) text += `export type { ${typen.join(', ')} };\n`;
    ziele[z.datei] = text;
  }
  const weitere: Record<string, string> = {};
  if (auftrag.kontextDatei && auftrag.klasse !== undefined && funktionsNamen.size > 0) {
    const kd = auftrag.kontextDatei;
    weitere[kd.datei] =
      `/**\n * The view a module next to ${posix.basename(auftrag.quelle)} has of the class: the members it names, nothing else.\n */\n` +
      `import type { ${auftrag.klasse} } from '${relativ(kd.datei, auftrag.quelle)}';\n\n` +
      `export type ${kd.typ}<K extends keyof ${auftrag.klasse}> = Pick<${auftrag.klasse}, K>;\n`;
  }
  return { rest, ziele, weitere, weiterleitungen, gelockert };
}
