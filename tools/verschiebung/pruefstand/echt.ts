/**
 * Probe on real files. Not in the CI: it needs the git history.
 *
 * Builds cuts with the mover of the test bench on real classes and files of one commit, lets the
 * proof judge them, and lays the forgeries of both attacks on the earlier proof tool on those cuts,
 * each as a text change of the rest or of the target file. Nothing is written to disk: the new
 * state is the old commit with the changed files laid over it.
 *
 *   node_modules/.bin/tsx tools/verschiebung/pruefstand/echt.ts [--ref <commit>] [--nur <id,id,...>] [--liste]
 *
 * Every case says what the attack expected (green or red). A real cut that is red here is not a
 * failure of the probe: its findings are printed and belong in the report.
 */
import ts from 'typescript';
import { beweise } from '../beweis';
import { pruefeManifest } from '../manifest';
import { GitStand, UeberlagerterStand, repoWurzel } from '../stand';
import type { Ergebnis, Manifest, RegelId } from '../typen';
import { verschiebe, type Auftrag, type Schnitt } from './verschieber';

const K = ts.SyntaxKind;
const argv = process.argv.slice(2);
const wert = (schalter: string): string | undefined => {
  const i = argv.indexOf(schalter);
  return i >= 0 ? argv[i + 1] : undefined;
};
const REF = wert('--ref') ?? '44b9ca3b';
const NUR = wert('--nur')?.split(',') ?? null;
const LISTE = argv.includes('--liste');
const WURZEL = repoWurzel(process.cwd());
const ALT = LISTE ? null : new GitStand(WURZEL, REF);

const WOV = 'server/src/WovServer.ts';
const ENT = 'client/src/entities/EntityManager.ts';
const KAT = 'client/src/editor/GegenstandsKatalog.ts';
const ADM = 'admin/src/main.ts';
const EDI = 'client/src/editor/editorMain.ts';

const parse = (t: string): ts.SourceFile => ts.createSourceFile('x.ts', t, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const muss = (alt: string, neu: string, was = ''): string => {
  if (alt === neu) throw new Error(`forgery changed nothing ${was}`);
  return neu;
};
const ersetze = (von: string | RegExp, nach: string) => (t: string): string => muss(t, t.replace(von, nach), String(von).slice(0, 40));

// -- the cut on a real file --------------------------------------------------------------------

interface Eingabe {
  manifest: Manifest;
  dateien: Map<string, string | null>;
  /** Files of the OLD state that differ from the commit: a probe that inserts code into the old method. */
  altDateien: Map<string, string>;
  schnitt: Schnitt;
  quelle: string;
  ziel: string;
}

function lies(pfad: string): string {
  const t = ALT!.lies(pfad);
  if (t === undefined) throw new Error(`${pfad} does not exist in ${REF}`);
  return t;
}

function schnitt(quelle: string, auftrag: Auftrag, freigaben: Manifest['freigaben'] = [], altText?: string): Eingabe {
  const original = lies(quelle);
  const text = altText ?? original;
  const altDateien = new Map<string, string>(text === original ? [] : [[quelle, text]]);
  const s = verschiebe(text, auftrag);
  const dateien = new Map<string, string | null>([[quelle, s.rest], ...Object.entries(s.ziele), ...Object.entries(s.weitere)]);
  const manifest = pruefeManifest({
    version: 1,
    alt: `git:${ALT!.commit}`,
    neu: 'probe:neu',
    quelle,
    ...(auftrag.klasse !== undefined && auftrag.ziele.some((z) => (z.methoden ?? []).length > 0) ? { klasse: auftrag.klasse } : {}),
    ziele: auftrag.ziele.map((z) => ({
      datei: z.datei,
      woertlich: z.woertlich ?? [],
      methoden: z.methoden ?? [],
      ...((z.methoden ?? []).length > 0 ? { kontext: { parameter: z.kontext?.parameter ?? 'k', typ: z.kontext?.typ ?? 'Kontext' } } : {}),
    })),
    einstiege: [quelle],
    freigaben,
  });
  return { manifest, dateien, altDateien, schnitt: s, quelle, ziel: auftrag.ziele[0]!.datei };
}

interface Aenderung {
  rest?: (t: string) => string;
  ziel?: (t: string) => string;
  datei?: Record<string, string | null>;
  manifest?: (m: Manifest) => Manifest;
  /** Replaces the old source file (the cut is then built from that text by the caller). */
}

function mit(e: Eingabe, a: Aenderung): Eingabe {
  const dateien = new Map(e.dateien);
  if (a.rest) dateien.set(e.quelle, muss(dateien.get(e.quelle)!, a.rest(dateien.get(e.quelle)!), 'rest'));
  if (a.ziel) dateien.set(e.ziel, muss(dateien.get(e.ziel)!, a.ziel(dateien.get(e.ziel)!), 'target'));
  for (const [p, t] of Object.entries(a.datei ?? {})) dateien.set(p, t);
  return { ...e, dateien, manifest: a.manifest ? a.manifest(e.manifest) : e.manifest };
}

function weiterleitung(e: Eingabe, name: string): string {
  const w = e.schnitt.weiterleitungen[name];
  if (w === undefined || !e.dateien.get(e.quelle)!.includes(w)) throw new Error(`no forwarder "${name}" in the rest`);
  return w;
}
const mitWeiterleitung = (e: Eingabe, name: string, f: (w: string) => string): Eingabe => mit(e, { rest: (t) => t.replace(weiterleitung(e, name), muss(weiterleitung(e, name), f(weiterleitung(e, name)), name)) });

/** Replaces the text of the function or class method `name`. */
function inFunktion(text: string, name: string, f: (t: string) => string, klasse?: string): string {
  const sf = parse(text);
  let knoten: ts.Node | undefined;
  if (klasse) {
    const kl = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === klasse);
    knoten = kl?.members.find((m) => (ts.isMethodDeclaration(m) || ts.isGetAccessor(m) || ts.isConstructorDeclaration(m)) && (ts.isConstructorDeclaration(m) ? name === 'constructor' : m.name.getText(sf) === name) && !!m.body);
  } else knoten = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === name && !!s.body);
  if (!knoten) throw new Error(`${name} not found`);
  const alt = knoten.getText(sf);
  return text.slice(0, knoten.getStart(sf)) + muss(alt, f(alt), name) + text.slice(knoten.end);
}

/** `return X;` becomes `return<newline>X;` in the first return with an expression of the function `name`. */
function asiReturn(text: string, name: string, klasse?: string): string {
  return inFunktion(text, name, (t) => {
    const sf = parse(`${klasse ? 'class X { ' : ''}${t}${klasse ? ' }' : ''}`);
    let st: ts.ReturnStatement | null = null;
    const g = (n: ts.Node): void => {
      if (st) return;
      if (ts.isReturnStatement(n) && n.expression) {
        st = n;
        return;
      }
      ts.forEachChild(n, g);
    };
    g(sf);
    if (!st) throw new Error(`no return with expression in ${name}`);
    const r = st as ts.ReturnStatement;
    const versatz = klasse ? 'class X { '.length : 0;
    return `${t.slice(0, r.getStart(sf) - versatz + 6)}\n${t.slice(r.expression!.getStart(sf) - versatz)}`;
  }, klasse);
}

const zahlPlusEins = (t: string): string => muss(t, t.replace(/([^.\w'"`])(\d+)([^.\w'"`])/, (_, a: string, d: string, c: string) => `${a}${Number(d) + 1}${c}`));

// -- choosing methods of a real class ----------------------------------------------------------

interface MethodenInfo {
  name: string;
  text: string;
  n: number;
  async: boolean;
  ret: string;
  vorgabe: boolean;
  zeilen: number;
  hatIf: boolean;
  hatZahl: boolean;
  hatReturnAusdruck: boolean;
  hatAwait: boolean;
  params: string[];
}

function modulNamen(sf: ts.SourceFile): Set<string> {
  const aus = new Set<string>();
  for (const s of sf.statements) {
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) aus.add(d.name.text);
    if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s) || ts.isModuleDeclaration(s)) && s.name && ts.isIdentifier(s.name)) aus.add(s.name.text);
  }
  return aus;
}

/** Methods a form k cut can take as they are: no local `k`, no free name of the source file, no unsupported construct. */
function kandidaten(datei: string, klasse: string, hoechstens = 80): MethodenInfo[] {
  const text = lies(datei);
  const sf = parse(text);
  const kl = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === klasse);
  if (!kl) throw new Error(`class ${klasse} not in ${datei}`);
  const frei = modulNamen(sf);
  const namen = new Map<string, number>();
  for (const m of kl.members) {
    const n = (m as ts.NamedDeclaration).name?.getText(sf);
    if (n) namen.set(n, (namen.get(n) ?? 0) + 1);
  }
  const aus: MethodenInfo[] = [];
  for (const m of kl.members) {
    if (!ts.isMethodDeclaration(m) || !m.body || !ts.isIdentifier(m.name)) continue;
    if (namen.get(m.name.text)! > 1) continue;
    if (ts.getDecorators(m)?.length) continue;
    const mods = (ts.getModifiers(m) ?? []).map((x) => x.kind);
    if (mods.some((k) => k === K.StaticKeyword || k === K.AbstractKeyword || k === K.OverrideKeyword || k === K.DeclareKeyword)) continue;
    if (m.asteriskToken || m.questionToken) continue;
    if (!m.parameters.every((p) => ts.isIdentifier(p.name) && p.name.text !== 'this' && (!p.initializer || ts.isLiteralExpression(p.initializer) || p.initializer.kind === K.TrueKeyword || p.initializer.kind === K.FalseKeyword || p.initializer.kind === K.NullKeyword))) continue;
    const t = m.getText(sf);
    let schlecht = false;
    const g = (n: ts.Node): void => {
      if (schlecht) return;
      if (ts.isIdentifier(n) && (n.text === 'k' || n.text === 'arguments' || frei.has(n.text))) schlecht = true;
      if (n.kind === K.SuperKeyword || ts.isMetaProperty(n)) schlecht = true;
      if (ts.isCallExpression(n) && (n.expression.kind === K.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) schlecht = true;
      ts.forEachChild(n, g);
    };
    g(m);
    if (schlecht) continue;
    const zeilen = t.split('\n').length;
    if (zeilen > hoechstens) continue;
    aus.push({
      name: m.name.text,
      text: t,
      n: m.parameters.length,
      async: mods.includes(K.AsyncKeyword),
      ret: m.type ? m.type.getText(sf) : '',
      vorgabe: m.parameters.some((p) => p.initializer),
      zeilen,
      hatIf: /\bif \(/.test(t),
      hatZahl: /[^.\w'"`](\d+)[^.\w'"`]/.test(t),
      hatReturnAusdruck: /\breturn [^;\n]/.test(m.body.getText(sf)),
      hatAwait: /\bawait\b/.test(t),
      params: m.parameters.map((p) => p.name.getText(sf)),
    });
  }
  return aus;
}

// -- the run -----------------------------------------------------------------------------------

interface Fall {
  id: string;
  name: string;
  soll: 'gruen' | 'rot';
  /** Expectation of the attack, if the case comes from one. */
  angriff?: 'gruen' | 'rot' | 'offen';
  eingabe: () => Eingabe;
}
interface Ausgang {
  id: string;
  name: string;
  soll: string;
  ist: string;
  regeln: RegelId[];
  ok: boolean;
  sekunden: number;
  befunde: string[];
}
const ausgaenge: Ausgang[] = [];
let uebersprungen = 0;

function fall(f: Fall): void {
  if (NUR && !NUR.includes(f.id)) return;
  if (LISTE) {
    console.log(`${f.id.padEnd(6)} ${f.soll.padEnd(5)} ${f.name}`);
    return;
  }
  const t0 = Date.now();
  let erg: Ergebnis | null = null;
  let fehler = '';
  try {
    const e = f.eingabe();
    const alt = e.altDateien.size > 0 ? new UeberlagerterStand(ALT!, e.altDateien, 'alt') : ALT!;
    const neu = new UeberlagerterStand(alt, e.dateien, 'probe');
    erg = beweise({ manifest: e.manifest, alt, neu, wurzel: WURZEL });
  } catch (x) {
    fehler = (x as Error).message.split('\n')[0]!;
  }
  const sekunden = Math.round((Date.now() - t0) / 100) / 10;
  if (!erg) {
    uebersprungen++;
    console.log(`----  ${f.id.padEnd(6)} NOT BUILT (${sekunden} s): ${f.name}: ${fehler}`);
    ausgaenge.push({ id: f.id, name: f.name, soll: f.soll, ist: 'not built', regeln: [], ok: false, sekunden, befunde: [fehler] });
    return;
  }
  const ist = erg.exit === 0 ? 'gruen' : 'rot';
  const regeln = [...new Set(erg.befunde.map((b) => b.regel))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const ok = ist === f.soll;
  const befunde = erg.befunde.slice(0, 4).map((b) => `[${b.regel} ${b.teil}] ${b.ort.datei}:${b.ort.zeile}: ${b.text.slice(0, 200)}`);
  ausgaenge.push({ id: f.id, name: f.name, soll: f.soll, ist, regeln, ok, sekunden, befunde });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${f.id.padEnd(6)} soll ${f.soll.padEnd(5)} ist ${ist.padEnd(5)} [${regeln.join(',')}] ${sekunden} s | ${f.name}`);
  if (!ok || ist === 'rot') for (const b of befunde.slice(0, ok ? 1 : 4)) console.log(`        ${b}`);
}

function ende(): never {
  if (LISTE) process.exit(0);
  console.log('\nTABLE id | soll | ist | regeln | s | name');
  for (const a of ausgaenge) console.log(`TABLE ${a.id} | ${a.soll} | ${a.ist} | ${a.regeln.join(' ')} | ${a.sekunden} | ${a.name}`);
  const falsch = ausgaenge.filter((a) => !a.ok);
  const durch = falsch.filter((a) => a.soll === 'rot' && a.ist === 'gruen');
  const falschRot = falsch.filter((a) => a.soll === 'gruen' && a.ist === 'rot');
  console.log(`\nTABLE total ${ausgaenge.length}: as expected ${ausgaenge.length - falsch.length}, red forgeries green ${durch.length}, green cuts red ${falschRot.length}, not built ${uebersprungen}`);
  for (const a of durch) console.log(`  GREEN FORGERY ${a.id} ${a.name}`);
  for (const a of falschRot) console.log(`  RED CUT ${a.id} ${a.name}: ${a.befunde[0] ?? ''}`);
  process.exit(durch.length === 0 && uebersprungen === 0 ? 0 : 1);
}

// ==============================================================================================
console.log(`probe on real files, commit ${REF}${LISTE ? ' (list only)' : ''}`);

// -- G: real cuts of form k on three classes ---------------------------------------------------
const KW = { datei: 'server/src/spiel/WovServerKontext.ts', typ: 'WovServerKontext' };
const KE = { datei: 'client/src/entities/EntityManagerKontext.ts', typ: 'EntityManagerKontext' };
const KK = { datei: 'client/src/editor/GegenstandsKatalogKontext.ts', typ: 'GegenstandsKatalogKontext' };
const ZW = 'server/src/spiel/ZielProbe.ts';
const ZE = 'client/src/entities/ZielProbe.ts';
const ZK = 'client/src/editor/ZielProbe.ts';
const auftragK = (klasse: string, kontextDatei: { datei: string; typ: string }, ziel: string, methoden: string[]): Auftrag => ({ quelle: '', klasse, kontextDatei, ziele: [{ datei: ziel, methoden, kontext: { typ: 'ZielKontext' } }] });
const formK = (quelle: string, klasse: string, kontextDatei: { datei: string; typ: string }, ziel: string, methoden: string[], altText?: string): Eingabe => schnitt(quelle, { ...auftragK(klasse, kontextDatei, ziel, methoden), quelle }, [], altText);

const kW = LISTE ? [] : kandidaten(WOV, 'WovServer', 60);
const kE = LISTE ? [] : kandidaten(ENT, 'EntityManager', 60);
const kK = LISTE ? [] : kandidaten(KAT, 'GegenstandsKatalog', 60);
const nimm = (liste: MethodenInfo[], wunsch: string[], n: number): string[] => {
  const aus = wunsch.filter((w) => liste.some((i) => i.name === w));
  for (const i of liste) if (aus.length < n && !aus.includes(i.name) && /\bthis\./.test(i.text)) aus.push(i.name);
  return aus.slice(0, n);
};
const wNamen = nimm(kW, ['instanzWeltAnlegen', 'instanzWeltEntfernen', 'welt', 'zdosVon', 'geklemmteEintraege'], 5);
const eNamen = nimm(kE, ['indexEntfernen', 'colliderPositions', 'setzeNpcQuelle', 'npcEinordnung', 'removeZDO'], 5);
const kNamen = nimm(kK, ['umschalten', 'oeffne', 'schliesse', 'rasterBauen', 'drehSetzen'], 5);
if (!LISTE) {
  console.log(`candidates: WovServer ${kW.length}, EntityManager ${kE.length}, GegenstandsKatalog ${kK.length}`);
  console.log(`chosen: WovServer ${wNamen.join(', ')} | EntityManager ${eNamen.join(', ')} | GegenstandsKatalog ${kNamen.join(', ')}`);
}
const sW = (): Eingabe => formK(WOV, 'WovServer', KW, ZW, wNamen);
fall({ id: 'G1', name: `WovServer: ${wNamen.join(', ')}`, soll: 'gruen', angriff: 'gruen', eingabe: sW });
const G1B = ['handleSetTimeOfDay', 'maxHealth', 'handleChatMessage'];
fall({ id: 'G1b', name: `WovServer: ${G1B.join(', ')} (fixed names of the earlier probe): red, the target moves the import of ChatReichweite.ts behind two other modules`, soll: 'rot', angriff: 'gruen', eingabe: () => formK(WOV, 'WovServer', KW, ZW, G1B) });
fall({
  id: 'G1c',
  name: `WovServer: ${G1B.join(', ')} with the release of that order`,
  soll: 'gruen',
  angriff: 'gruen',
  eingabe: () => schnitt(WOV, { ...auftragK('WovServer', KW, ZW, G1B), quelle: WOV }, [{ schluessel: `reihenfolge:${WOV}:server/src/spiel/ChatReichweite.ts`, begruendung: 'ChatReichweite.ts declares constants from literals and ZONE_SIZE only and acts on nothing while it loads; that it is evaluated two places later changes nothing' }]),
});
fall({ id: 'G2', name: `EntityManager: ${eNamen.join(', ')}`, soll: 'gruen', angriff: 'gruen', eingabe: () => formK(ENT, 'EntityManager', KE, ZE, eNamen) });
fall({ id: 'G3', name: `GegenstandsKatalog: ${kNamen.join(', ')}`, soll: 'gruen', angriff: 'gruen', eingabe: () => formK(KAT, 'GegenstandsKatalog', KK, ZK, kNamen) });

// Methods with certain shapes, for the forgeries of the first attack.
const waehle = (p: (i: MethodenInfo) => boolean): MethodenInfo | undefined => kW.find(p);
const M2 = waehle((i) => i.n >= 2 && !i.async && i.hatIf && i.hatZahl && i.ret === 'void' && /\bthis\./.test(i.text));
const MA = waehle((i) => i.async && /Promise<void>/.test(i.ret) && i.hatAwait && /\bthis\./.test(i.text));
const MR = waehle((i) => !i.async && i.ret !== '' && i.ret !== 'void' && i.n >= 1 && i.hatReturnAusdruck && /\bthis\./.test(i.text));
const M0 = waehle((i) => i.n === 0 && !i.async && i.ret !== 'void' && i.hatReturnAusdruck && /\bthis\./.test(i.text));
const MD = waehle((i) => i.vorgabe && /\bthis\./.test(i.text));
const MOR = waehle((i) => !i.async && i.ret === '' && i.hatReturnAusdruck && i.n >= 1 && /\bthis\./.test(i.text));
const AN = [...new Set([M2, MA, MR, M0, MD, MOR].filter((x): x is MethodenInfo => !!x).map((i) => i.name))];
if (!LISTE) console.log(`shapes: M2=${M2?.name} MA=${MA?.name} MR=${MR?.name}: ${MR?.ret} M0=${M0?.name} MD=${MD?.name} MOR=${MOR?.name}`);
const sA = (): Eingabe => formK(WOV, 'WovServer', KW, ZW, AN);
const zielFn = (name: string, f: (t: string) => string) => (t: string): string => inFunktion(t, name, f);
const restM = (name: string, f: (t: string) => string) => (t: string): string => inFunktion(t, name, f, 'WovServer');

console.log('\n-- A: forgeries in the moved body (first attack) --');
fall({ id: 'A0', name: `WovServer: ${AN.join(', ')} (shapes for the forgeries)`, soll: 'gruen', eingabe: sA });
if (M2) {
  fall({ id: 'A1', name: `number in the body of ${M2.name} raised by 1`, soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: zielFn(M2.name, zahlPlusEins) }) });
  fall({ id: 'A2', name: `condition in ${M2.name} negated`, soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: zielFn(M2.name, (t) => { const sf = parse(t); let w: ts.IfStatement | null = null; const g = (n: ts.Node): void => { if (w) return; if (ts.isIfStatement(n)) { w = n; return; } ts.forEachChild(n, g); }; g(sf); if (!w) throw new Error('no if'); const x = (w as ts.IfStatement).expression; return `${t.slice(0, x.getStart(sf))}!(${x.getText(sf)})${t.slice(x.end)}`; }) }) });
}
if (MA) {
  fall({ id: 'A3', name: `await in ${MA.name} removed`, soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: zielFn(MA.name, ersetze(/\bawait /, '')) }) });
  fall({ id: 'A4', name: `async removed at the target function ${MA.name}`, soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: zielFn(MA.name, ersetze(/^async function/, 'function')) }) });
}
if (MD) {
  fall({ id: 'A5', name: `default value of a parameter of ${MD.name} removed in the target`, soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: zielFn(MD.name, ersetze(/ = [^,)]+([,)])/, '$1')) }) });
  fall({ id: 'A6', name: `default value of a parameter of ${MD.name} removed in the forwarder`, soll: 'rot', angriff: 'rot', eingabe: () => mitWeiterleitung(sA(), MD.name, ersetze(/ = [^,)]+([,)])/, '$1')) });
}
// A7: a method that reads exactly one numeric module constant, and nothing else of the module level
if (!LISTE) {
  const text = lies(WOV);
  const sf = parse(text);
  const konst = new Map<string, string>();
  for (const s of sf.statements) if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && ts.isNumericLiteral(d.initializer)) konst.set(d.name.text, d.initializer.text);
  const frei = modulNamen(sf);
  const kl = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'WovServer')!;
  let treffer: { name: string; konst: string } | null = null;
  for (const m of kl.members) {
    if (treffer || !ts.isMethodDeclaration(m) || !m.body || !ts.isIdentifier(m.name) || !m.parameters.every((p) => ts.isIdentifier(p.name) && !p.initializer)) continue;
    const benutzt = new Set<string>();
    let schlecht = false;
    const g = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) {
        if (frei.has(n.text) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) benutzt.add(n.text);
        if (n.text === 'k' || n.text === 'arguments') schlecht = true;
      }
      if (n.kind === K.SuperKeyword) schlecht = true;
      ts.forEachChild(n, g);
    };
    g(m);
    const nurKonst = [...benutzt].filter((b) => konst.has(b));
    if (!schlecht && benutzt.size === 1 && nurKonst.length === 1 && m.getText(sf).split('\n').length < 80 && /\bthis\./.test(m.getText(sf))) treffer = { name: m.name.text, konst: nurKonst[0]! };
  }
  if (treffer) {
    const tr = treffer;
    const wertAlt = konst.get(tr.konst)!;
    console.log(`A7: method ${tr.name} reads the module constant ${tr.konst} = ${wertAlt}`);
    const mitKonst = (): Eingabe => schnitt(WOV, { quelle: WOV, klasse: 'WovServer', kontextDatei: KW, ziele: [{ datei: ZW, methoden: [tr.name], woertlich: [tr.konst], kontext: { typ: 'ZielKontext' } }] });
    fall({ id: 'A7v', name: `${tr.name} moves with the constant ${tr.konst} verbatim`, soll: 'gruen', eingabe: mitKonst });
    fall({ id: 'A7', name: `the constant ${tr.konst} moves along, with another value in the target`, soll: 'rot', angriff: 'rot', eingabe: () => mit(mitKonst(), { ziel: ersetze(new RegExp(`(${tr.konst}\\s*=\\s*)${wertAlt}\\b`), `$1${Number(wertAlt) * 10 + 1}`) }) });
    fall({ id: 'A7c', name: `${tr.name} moves without the constant ${tr.konst} (free name of the source)`, soll: 'rot', angriff: 'rot', eingabe: () => formK(WOV, 'WovServer', KW, ZW, [tr.name]) });
    fall({ id: 'A7b', name: `${tr.name} moves without the constant, the target imports ${tr.konst} from another file`, soll: 'rot', angriff: 'rot', eingabe: () => mit(formK(WOV, 'WovServer', KW, ZW, [tr.name]), { ziel: (t) => `import { ${tr.konst} } from './GanzAndereWerte';\n${t}` }) });
  } else console.log('A7: no method reads exactly one numeric module constant: not built');
  // A8: real methods with a local `k`
  const mitK: string[] = [];
  for (const m of kl.members) {
    if (!ts.isMethodDeclaration(m) || !m.body || !ts.isIdentifier(m.name) || !m.parameters.every((p) => ts.isIdentifier(p.name))) continue;
    let h = false;
    const g = (n: ts.Node): void => {
      if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) && ts.isIdentifier(n.name) && n.name.text === 'k') h = true;
      ts.forEachChild(n, g);
    };
    g(m);
    if (h) mitK.push(m.name.text);
  }
  console.log(`A8: methods of WovServer with a local "k": ${mitK.length} (${mitK.slice(0, 5).join(', ')})`);
  for (const [i, nm] of mitK.slice(0, 2).entries()) fall({ id: `A8${i === 0 ? '' : 'b'}`, name: `REAL: ${nm} has a local "k" and moves with the context name k`, soll: 'rot', angriff: 'rot', eingabe: () => formK(WOV, 'WovServer', KW, ZW, [nm]) });
}
if (M2) {
  const amAnfang = (code: string): string => inFunktion(lies(WOV), M2.name, (t) => t.replace(/\{/, `{ ${code}`), 'WovServer');
  const einer = (code: string): Eingabe => formK(WOV, 'WovServer', KW, ZW, [M2.name], amAnfang(code));
  fall({ id: 'A9', name: `synthetic: [this.config].forEach((k) => …) in ${M2.name}`, soll: 'rot', angriff: 'rot', eingabe: () => einer('[this.running].forEach((k) => { void this.running; void k; });') });
  fall({ id: 'A10', name: 'this. in an inner function: kept by the mover, right cut', soll: 'gruen', angriff: 'rot', eingabe: () => einer('[1].map(function (this: unknown) { return this; });') });
  fall({ id: 'A11', name: 'this. in getter/method of an object literal: kept, right cut', soll: 'gruen', angriff: 'rot', eingabe: () => einer('const o = { get a() { return this; }, b() { return this; } }; void o;') });
  fall({ id: 'A12', name: 'this. in field/static block of an inner class: kept, right cut', soll: 'gruen', angriff: 'rot', eingabe: () => einer('const C = class { x = this; static { void this.name; } }; void C;') });
  fall({ id: 'A13', name: 'this. in an arrow function (same this)', soll: 'gruen', angriff: 'gruen', eingabe: () => einer('[1].map((x) => this.running && x);') });
  fall({ id: 'A14', name: 'arrow function made a function in the target', soll: 'rot', angriff: 'rot', eingabe: () => mit(einer('[1].map((x) => this.running && x);'), { ziel: ersetze('[1].map((x) => k.running && x);', '[1].map(function (x) { return k.running && x; });') }) });
  fall({ id: 'A15', name: 'arguments in the body', soll: 'rot', angriff: 'rot', eingabe: () => einer('if (arguments.length > 2) return; void arguments[0];') });
  const mitVorgabe = (): Eingabe => formK(WOV, 'WovServer', KW, ZW, [M2.name], inFunktion(lies(WOV), M2.name, (t) => t.replace(/\(([a-zA-Z_]+): /, '(extra = this.running, $1: '), 'WovServer'));
  fall({ id: 'A16', name: 'default value with this. made k. correctly', soll: 'gruen', angriff: 'gruen', eingabe: mitVorgabe });
  fall({ id: 'A16b', name: 'default value with this. left in the target', soll: 'rot', angriff: 'rot', eingabe: () => mit(mitVorgabe(), { ziel: ersetze('extra = k.running', 'extra = this.running') }) });
  fall({ id: 'A17', name: 'target: context as "k: any"', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: (t) => muss(t, t.replaceAll('(k: ZielKontext', '(k: any')) }) });
  fall({ id: 'A18', name: 'target: statement on module level with an effect', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: (t) => `setInterval(() => process.exit(1), 1000);\n${t}` }) });
  fall({ id: 'A19', name: 'target: a function twice on module level', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: (t) => { const f = new RegExp(`\\n(?:async )?function ${M2.name}\\([\\s\\S]*?\\n\\}\\n`).exec(t); if (!f) throw new Error('function not found'); return `${t}${f[0]}`; } }) });
  fall({ id: 'A20', name: 'target: function taken out of the export list', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: (t) => muss(t, t.replace(new RegExp(`(export \\{[^}]*?)\\b${M2.name}\\b,? ?`), '$1')) }) });
  const mitKommentar = (): Eingabe => einer('\n    // @ts-expect-error absichtlich\n    // eslint-disable-next-line no-console\n    void this.running;');
  fall({ id: 'A21v', name: 'directive comments of the method moved along', soll: 'gruen', eingabe: mitKommentar });
  fall({ id: 'A21', name: 'directive comments of the method lost in the target', soll: 'rot', angriff: 'rot', eingabe: () => mit(mitKommentar(), { ziel: (t) => muss(t, t.replace(/ *\/\/ @ts-expect-error absichtlich\n *\/\/ eslint-disable-next-line no-console\n/, '')) }) });

  console.log('\n-- W: forgeries in the forwarder (both attacks) --');
  const w = (id: string, name: string, methode: string, f: (t: string) => string, angriff: 'gruen' | 'rot' = 'rot', soll: 'gruen' | 'rot' = 'rot'): void => fall({ id, name, soll, angriff, eingabe: () => mitWeiterleitung(sA(), methode, f) });
  const aufruf = (name: string): RegExp => new RegExp(`return ${name}\\(this(, [^)]*)?\\);`);
  w('W1', `arguments swapped (${M2.name})`, M2.name, (t) => t.replace(aufruf(M2.name), (g, a: string | undefined) => { const p = (a ?? '').split(', ').filter(Boolean); if (p.length < 2) throw new Error('needs two parameters'); [p[0], p[1]] = [p[1]!, p[0]!]; return `return ${M2.name}(this, ${p.join(', ')});`; }));
  if (MR) w('W2', `return missing, method with return type ${MR.ret} (${MR.name})`, MR.name, ersetze(`return ${MR.name}(`, `${MR.name}(`));
  if (MOR) w('W3', `return missing, return type not declared (${MOR.name})`, MOR.name, ersetze(`return ${MOR.name}(`, `${MOR.name}(`));
  if (MA) w('W4', `return missing at async Promise<void> (${MA.name})`, MA.name, ersetze(`return ${MA.name}(`, `${MA.name}(`));
  if (MA) w('W5', `async added to the forwarder (${MA.name})`, MA.name, (t) => `async ${t}`);
  w('W6', 'effect in the context expression', M2.name, ersetze(`${M2.name}(this`, `${M2.name}((this.running = false, this)`));
  w('W7', 'context is a copy: {...this}', M2.name, ersetze(`${M2.name}(this`, `${M2.name}({ ...this }`));
  w('W8', 'context is another object', M2.name, ersetze(`${M2.name}(this`, `${M2.name}(this.zdos`));
  w('W9', 'call to another module of the same function name', M2.name, ersetze(`return ${M2.name}(this`, `return falschesModul.${M2.name}(this`));
  if (M0) w('W10', `self call: ${M0.name}() { return this.${M0.name}(); }`, M0.name, ersetze(`return ${M0.name}(this)`, `return this.${M0.name}()`));
  w('W11', 'second statement in the forwarder', M2.name, ersetze('return ', 'this.running = false;\n    return '));
  w('W12', 'effect as default value of an additional parameter', M2.name, ersetze(/\)(: void)? \{/, ', _x = (this.running = false))$1 {'));
  w('W13', 'forwarder made static', M2.name, (t) => `static ${t}`);
  w('W14', 'call wrapped in a condition', M2.name, ersetze(`return ${M2.name}(`, `return this.running && ${M2.name}(`));
  w('W15', 'call with ?.', M2.name, ersetze(`return ${M2.name}(`, `return ${M2.name}?.(`));
  if (MR) w('W16', 'result changed (|| undefined)', MR.name, ersetze(/\);\n/, ') || undefined;\n'));
  w('W17', 'forwarder twice in the class', M2.name, (t) => `${t}\n  ${t}`);
  if (M0) w('W18', 'forwarder as a class field with an arrow function', M0.name, () => `${M0.name} = ()${M0.ret ? `: ${M0.ret}` : ''} => ${M0.name}(this);`);
  w('W19', 'decorator in front of the forwarder', M2.name, (t) => `@((_m: unknown, _c: unknown) => function (this: unknown) { return undefined as never; })\n  ${t}`);
  w('W20', 'forwarder as optional method `name?()`', M2.name, ersetze(`${M2.name}(`, `${M2.name}?(`));
  w('W21', 'overload signature in front of the forwarder', M2.name, (t) => `${t.slice(0, t.indexOf('{')).trimEnd()};\n  ${t}`);
  w('W22', 'forwarder gets a `this: WovServer` parameter', M2.name, ersetze(`${M2.name}(`, `${M2.name}(this: WovServer, `));
  fall({ id: 'W23', name: 'rest: static block in the class', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: ersetze(/(export class WovServer[^{]*\{)/, '$1\n  static {\n    process.exitCode = 3;\n  }') }) });
  fall({ id: 'W24', name: 'rest: setter next to the getter', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: ersetze(/(\n {2})(get geo\()/, '$1set geo(_v: unknown) {\n    process.exitCode = 3;\n  }$1$2') }) });

  console.log('\n-- R: silent changes in the rest --');
  const andere = kW.find((i) => !AN.includes(i.name) && i.hatZahl);
  if (andere) fall({ id: 'R1', name: `unnamed method ${andere.name} changed (number +1)`, soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: restM(andere.name, zahlPlusEins) }) });
  fall({ id: 'R2', name: 'constructor: statement inserted at the start', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: restM('constructor', ersetze(/\)\s*\{/, ') {\n    process.exitCode = 3;')) }) });
  fall({ id: 'R3', name: 'constructor: the last two statements swapped', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: (t) => { const sf = parse(t); const kl = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'WovServer')!; const c = kl.members.find(ts.isConstructorDeclaration)!; const st = c.body!.statements; const a = st[st.length - 1]!; const b = st[st.length - 2]!; return `${t.slice(0, b.getStart(sf))}${a.getText(sf)}\n    ${b.getText(sf)}${t.slice(a.end)}`; } }) });
  fall({ id: 'R4', name: 'a field of the class: initial value changed', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: (t) => { const sf = parse(t); const kl = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'WovServer')!; const f = kl.members.find((m): m is ts.PropertyDeclaration => ts.isPropertyDeclaration(m) && !!m.initializer && ts.isNumericLiteral(m.initializer))!; return `${t.slice(0, f.initializer!.getStart(sf))}${Number(f.initializer!.getText(sf)) + 1}${t.slice(f.initializer!.end)}`; } }) });
  fall({ id: 'R5', name: 'accessor changed', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: (t) => { const sf = parse(t); const kl = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'WovServer')!; const a = kl.members.find((m) => ts.isGetAccessor(m) && !!m.body)!; return `${t.slice(0, a.getStart(sf))}${a.getText(sf).replace(/\{/, '{\n    process.exitCode = 3;')}${t.slice(a.end)}`; } }) });
  fall({ id: 'R6', name: 'a numeric module constant changed in the rest', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: (t) => { const sf = parse(t); const s = sf.statements.find((x): x is ts.VariableStatement => ts.isVariableStatement(x) && !!x.declarationList.declarations[0]?.initializer && ts.isNumericLiteral(x.declarationList.declarations[0].initializer))!; const i = s.declarationList.declarations[0]!.initializer!; return `${t.slice(0, i.getStart(sf))}${Number(i.getText(sf)) + 1}${t.slice(i.end)}`; } }) });
  fall({ id: 'R7', name: 'an import of the rest redirected to another file', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: (t) => { const sf = parse(t); const im = sf.statements.find((s): s is ts.ImportDeclaration => ts.isImportDeclaration(s) && /^\.\.?\//.test((s.moduleSpecifier as ts.StringLiteral).text) && !!s.importClause && !s.importClause.isTypeOnly)!; return `${t.slice(0, im.moduleSpecifier.getStart(sf))}'./boese'${t.slice(im.moduleSpecifier.end)}`; } }) });
  fall({ id: 'R8', name: 'statement on module level appended to the rest', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: (t) => `${t}\nprocess.on('exit', () => {});\n` }) });
  const privat = kW.find((i) => !AN.includes(i.name) && /^private /.test(i.text));
  if (privat) fall({ id: 'R9', name: `unnamed method ${privat.name} loses private (no context type names it)`, soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: restM(privat.name, ersetze(/^private /, '')) }) });
  if (andere) fall({ id: 'R9b', name: `unnamed method ${andere.name} made static`, soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: restM(andere.name, (t) => `static ${t}`) }) });
  if (andere) fall({ id: 'R10', name: `unnamed method ${andere.name} a second time with another body`, soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: restM(andere.name, (t) => `${t}\n  ${andere.name}(): void {\n    process.exitCode = 3;\n  }`) }) });

  console.log('\n-- T: same tokens, another program (second attack) --');
  if (MR) fall({ id: 'T1', name: `target: return<newline>X in ${MR.name} (returns undefined)`, soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: (t) => asiReturn(t, MR.name) }) });
  const boolM = kW.find((i) => !AN.includes(i.name) && i.hatReturnAusdruck && i.ret === 'boolean');
  if (boolM) fall({ id: 'T2', name: `rest: return<newline>X in the unnamed method ${boolM.name} (boolean)`, soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: (t) => asiReturn(t, boolM.name, 'WovServer') }) });
  fall({ id: 'T3', name: 'rest: `get geo()` becomes `get<newline>geo()` (same tree, text differs)', soll: 'rot', angriff: 'offen', eingabe: () => mit(sA(), { rest: ersetze(/\bget geo\(/, 'get\n  geo(') }) });
  const asyncM = kW.find((i) => !AN.includes(i.name) && i.async);
  if (asyncM) fall({ id: 'T4', name: `rest: async<newline>${asyncM.name}() (a field async and a method without async)`, soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: ersetze(new RegExp(`\\basync ${asyncM.name}\\(`), `async\n  ${asyncM.name}(`) }) });
  fall({ id: 'T5', name: 'rest: static<newline>NAME (same tree, text differs)', soll: 'rot', angriff: 'offen', eingabe: () => mit(sA(), { rest: (t) => { const m = /\n {2}((?:private |public |protected )?static (?:readonly )?)([A-Za-z_]+)( ?[=:(])/.exec(t); if (!m) throw new Error('no static member'); return muss(t, t.replace(m[0], `\n  ${m[1]!.replace('static ', 'static\n  ')}${m[2]}${m[3]}`)); } }) });
  fall({ id: 'T6', name: 'target: a number written differently (same value: hex for an integer, a trailing zero for a decimal)', soll: 'rot', angriff: 'offen', eingabe: () => mit(sA(), { ziel: (t) => { const sf = parse(t); let z: ts.NumericLiteral | null = null; const g = (n: ts.Node): void => { if (z) return; if (ts.isNumericLiteral(n) && /^\d+(\.\d+)?$/.test(n.text)) { z = n; return; } ts.forEachChild(n, g); }; g(sf); if (!z) throw new Error('no numeric literal in the target'); const lit = z as ts.NumericLiteral; const neu = lit.text.includes('.') ? `${lit.text}0` : `0x${Number(lit.text).toString(16)}`; return `${t.slice(0, lit.getStart(sf))}${neu}${t.slice(lit.end)}`; } }) });
  fall({ id: 'T7', name: 'target: string with a unicode escape (same value)', soll: 'rot', angriff: 'offen', eingabe: () => mit(sA(), { ziel: (t) => { const von = t.indexOf('\nfunction'); const m = /'([a-zA-Z])([a-zA-Z_ .:-]*)'/.exec(t.slice(von)); if (!m) throw new Error('no string'); return muss(t, t.slice(0, von) + t.slice(von).replace(m[0], `'\\u00${m[1]!.charCodeAt(0).toString(16)}${m[2]}'`)); } }) });
  fall({ id: 'T8', name: 'target: member name with a unicode escape (same name)', soll: 'rot', angriff: 'offen', eingabe: () => mit(sA(), { ziel: (t) => muss(t, t.replace(/\bk\.([a-z])/, (_, c: string) => `k.\\u00${c.charCodeAt(0).toString(16)}`)) }) });

  console.log('\n-- K: directive comments (second attack) --');
  fall({ id: 'K1', name: 'target: `// @ts-nocheck` in the first line', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: (t) => `// @ts-nocheck\n${t}` }) });
  fall({ id: 'K2', name: 'target: `/* eslint-disable */` in the first line', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: (t) => `/* eslint-disable */\n${t}` }) });
  fall({ id: 'K3', name: 'target: `// @ts-nocheck` between the imports and the first function', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: ersetze(/\n(type ZielKontext = )/, '\n// @ts-nocheck\n$1') }) });
  fall({ id: 'K4', name: `rest: // @ts-ignore in the forwarder ${M2.name}`, soll: 'rot', angriff: 'rot', eingabe: () => mitWeiterleitung(sA(), M2.name, ersetze('    return ', '    // @ts-ignore\n    return ')) });
  fall({ id: 'K5', name: `rest: /* eslint-disable */ in the forwarder ${M2.name}`, soll: 'rot', angriff: 'rot', eingabe: () => mitWeiterleitung(sA(), M2.name, ersetze('    return ', '    /* eslint-disable */ return ')) });
  fall({ id: 'K6', name: 'rest: `// @ts-nocheck` in the first line of the rest', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: (t) => `// @ts-nocheck\n${t}` }) });

  console.log('\n-- N: context type without the word any (second attack) --');
  const ktyp = (typ: string) => (t: string): string => muss(t, t.replace(/type ZielKontext = [^;]+;/, `type ZielKontext = ${typ};`));
  fall({ id: 'N1', name: 'target: `ReturnType<typeof JSON.parse>`', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: ktyp('ReturnType<typeof JSON.parse>') }) });
  fall({ id: 'N2', name: 'target: `{ [x: string]: any }`', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: ktyp('{ [x: string]: any }') }) });
  fall({ id: 'N4', name: 'target: `Record<string, (...a: never[]) => never> & Record<string, never>`', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: ktyp('Record<string, (...a: never[]) => never> & Record<string, never>') }) });
  fall({ id: 'N5', name: 'target: the context type comes from a FOREIGN file named like the context file', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: ersetze("from './WovServerKontext';", "from '../boese/WovServerKontext';"), datei: { 'server/src/boese/WovServerKontext.ts': 'export type WovServerKontext<K extends string> = Record<K, any>;\n' } }) });

  console.log('\n-- I: imports (second attack) --');
  fall({ id: 'I2', name: 'rest: first and last import swapped', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: (t) => { const sf = parse(t); const imps = sf.statements.filter(ts.isImportDeclaration); const a = imps[0]!; const b = imps[imps.length - 2]!; const ta = a.getText(sf); const tb = b.getText(sf); return t.slice(0, a.getStart(sf)) + tb + t.slice(a.end, b.getStart(sf)) + ta + t.slice(b.end); } }) });
  fall({ id: 'I3', name: "rest: `import './boese';` appended to the imports", soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: (t) => { const sf = parse(t); const imps = sf.statements.filter(ts.isImportDeclaration); const l = imps[imps.length - 1]!; return `${t.slice(0, l.end)}\nimport './boese';${t.slice(l.end)}`; } }) });
  fall({ id: 'I4', name: 'rest: first `import type {` made `import {`', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: ersetze(/\nimport type \{/, '\nimport {') }) });
  fall({ id: 'I6', name: "rest: `import * as Math` from the target (shadows the global Math)", soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: ersetze(/(\nimport \{[^}]*\} from '\.\/spiel\/ZielProbe';)/, "$1\nimport * as Math from './spiel/ZielProbe';") }) });
  fall({ id: 'I7', name: `rest: \`import { ${M2.name} as structuredClone }\` from the target`, soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { rest: ersetze(/(\nimport \{[^}]*\} from '\.\/spiel\/ZielProbe';)/, `$1\nimport { ${M2.name} as structuredClone } from './spiel/ZielProbe';`) }) });
  fall({ id: 'I8', name: 'target: an `import type` of the old state written as a value import', soll: 'rot', angriff: 'rot', eingabe: () => mit(sA(), { ziel: (t) => { const m = /(^|\n)import type \{(?! ZielKontext| WovServerKontext)/.exec(t); if (!m) throw new Error('no import type in the target'); return muss(t, t.replace(m[0], `${m[1]}import {`)); } }) });

  console.log('\n-- Z: what may stand in a target file (second attack) --');
  const zz = (id: string, was: string, zusatz: string, vorn = false, angriff: 'gruen' | 'rot' | 'offen' = 'rot'): void => fall({ id, name: `target: ${was}`, soll: id === 'Z10' ? 'gruen' : 'rot', angriff, eingabe: () => mit(sA(), { ziel: (t) => (vorn ? `${zusatz}\n${t}` : `${t}\n${zusatz}\n`) }) });
  zz('Z1', 'namespace with an effect', 'namespace N {\n  export const x = process.exit(3);\n}');
  zz('Z2', '`export default 5;`', 'export default 5;');
  zz('Z3', '`declare global { … }`', 'declare global {\n  interface Array<T> {\n    boese: T;\n  }\n}');
  zz('Z4', '`enum E { A = 1 }`', 'enum E {\n  A = 1,\n}');
  zz('Z5', 'class with a static block', 'class C {\n  static {\n    process.exitCode = 3;\n  }\n}');
  zz('Z6', "`import boese = require('./boese');`", "import boese = require('./boese');", true);
  zz('Z7', "`export * from './boese';`", "export * from './boese';");
  zz('Z8', '`declare function boese(): void;`', 'declare function boese(): void;');
  zz('Z9', 'immediately called function with an effect', '(() => {\n  process.exitCode = 3;\n})();');
  zz('Z10', '`export {};` (harmless)', 'export {};', false, 'offen');
  zz('Z11', 'an unused interface', 'interface UnbenutzterTyp {\n  a: number;\n}', false, 'offen');

  console.log('\n-- S: scopes, inserted into the real body (second attack) --');
  fall({ id: 'S1', name: '`catch (k)` in the method', soll: 'rot', angriff: 'rot', eingabe: () => einer('try { void 0; } catch (k) { void k; }') });
  fall({ id: 'S2', name: 'destructuring to `k`', soll: 'rot', angriff: 'rot', eingabe: () => einer('const { k } = { k: 1 }; void k;') });
  fall({ id: 'S3', name: 'a label `k:` (forbidden by the rules of form k)', soll: 'rot', angriff: 'gruen', eingabe: () => einer('k: for (let i = 0; i < 1; i++) { break k; }') });
  fall({ id: 'S4', name: 'a field `k` of an inner class (forbidden by the rules of form k)', soll: 'rot', angriff: 'gruen', eingabe: () => einer('const C = class { k = 1; }; void C;') });
  fall({ id: 'S7', name: 'a local type', soll: 'gruen', angriff: 'gruen', eingabe: () => einer('type T = number; const t: T = 1; void t;') });
  fall({ id: 'S8', name: 'an inner function declaration with `this`: kept', soll: 'gruen', angriff: 'rot', eingabe: () => einer('function f(this: { n: number }): number { return this.n; } void f;') });
  fall({ id: 'S13', name: 'super. in the body', soll: 'rot', angriff: 'rot', eingabe: () => einer('void super.toString();') });
  fall({ id: 'S15', name: '`typeof this.running` in a type position', soll: 'gruen', angriff: 'gruen', eingabe: () => einer('const r: typeof this.running = true; void r;') });
}

console.log('\n-- F: form 0 of the real declarations at the end of WovServer.ts (both attacks) --');
const FNAMEN = ['pickableItem', 'gepruefteWaffe', 'waffeTragbar', 'wirksameWaffe', 'WAFFE_PAKETNAME_OHNE_EQUIP', 'EIKTHYR_HASH', 'BOSS_ENTRY', 'NPC_ENTRY', 'KREATUR_DROPS', 'ZWEIT_DROPS', 'wuerfleDrop', 'TRUHEN', 'wuerfleTruhe'];
const ZB = 'server/src/spiel/BeuteProbe.ts';
const FREI_HASH = { schluessel: 'laden:EIKTHYR_HASH', begruendung: "getStableHash('Eikthyr') is a pure hash of a literal; the two statements of the rest that ran before it do not feed it" };
const sF = (namen = FNAMEN): Eingabe => schnitt(WOV, { quelle: WOV, ziele: [{ datei: ZB, woertlich: namen }] }, namen.includes('EIKTHYR_HASH') ? [FREI_HASH] : []);
fall({ id: 'F0', name: '13 real names verbatim', soll: 'gruen', angriff: 'gruen', eingabe: () => sF() });
fall({ id: 'F1', name: 'rest imports NPC_ENTRY and BOSS_ENTRY with swapped aliases', soll: 'rot', angriff: 'rot', eingabe: () => mit(sF(), { rest: (t) => muss(t, t.replace(/import \{([^}]*)\} from '\.\/spiel\/BeuteProbe';/, (g, n: string) => `import {${n.replace(/\bNPC_ENTRY\b/, 'NPC_ENTRY as BOSS_ENTRY').replace(/\bBOSS_ENTRY\b(?! as)/, 'BOSS_ENTRY as NPC_ENTRY')}} from './spiel/BeuteProbe';`)) }) });
fall({ id: 'F2', name: 'rest: `export type { … } from` instead of `export { … } from`', soll: 'rot', angriff: 'rot', eingabe: () => mit(sF(), { rest: ersetze(/\nexport \{/, '\nexport type {') }) });
fall({ id: 'F3', name: 'form 0 only for wuerfleTruhe; the table TRUHEN stays in the source', soll: 'rot', angriff: 'rot', eingabe: () => sF(['wuerfleTruhe']) });
fall({ id: 'F5', name: 'target: return<newline>X in the verbatim function wuerfleDrop', soll: 'rot', angriff: 'rot', eingabe: () => mit(sF(), { ziel: (t) => asiReturn(t, 'wuerfleDrop') }) });
fall({ id: 'F6', name: 'target: an import replaced by `type X = never`', soll: 'rot', angriff: 'rot', eingabe: () => mit(sF(), { ziel: (t) => { const sf = parse(t); const im = sf.statements.find((s): s is ts.ImportDeclaration => ts.isImportDeclaration(s) && !!s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings) && s.importClause.namedBindings.elements.length === 1 && s.importClause.isTypeOnly); if (!im) throw new Error('no single type import in the target'); const n = (im.importClause!.namedBindings as ts.NamedImports).elements[0]!.name.text; return `${t.slice(0, im.getStart(sf))}type ${n} = never;${t.slice(im.end)}`; } }) });
fall({ id: 'F7', name: 'target: an import of a used value removed', soll: 'rot', angriff: 'rot', eingabe: () => mit(sF(), { ziel: (t) => { const sf = parse(t); const im = sf.statements.find((s): s is ts.ImportDeclaration => ts.isImportDeclaration(s) && !!s.importClause && !s.importClause.isTypeOnly); if (!im) throw new Error('no value import in the target'); return t.slice(0, im.getFullStart()) + t.slice(im.end); } }) });
fall({ id: 'N0-1', name: 're-export points to another file', soll: 'rot', angriff: 'rot', eingabe: () => mit(sF(), { rest: ersetze(/(\nexport \{[^}]*\} from ')\.\/spiel\/BeuteProbe'/, "$1./spiel/GanzAnders'") }) });
fall({ id: 'N0-2', name: 're-export with alias', soll: 'rot', angriff: 'rot', eingabe: () => mit(sF(), { rest: ersetze(/\nexport \{ gepruefteWaffe,/, '\nexport { waffeTragbar as gepruefteWaffe,') }) });
fall({ id: 'N0-3', name: 'import of the unexported names from another file', soll: 'rot', angriff: 'rot', eingabe: () => mit(sF(), { rest: ersetze(/(\nimport \{[^}]*\} from ')\.\/spiel\/BeuteProbe'/, "$1./spiel/GanzAnders'") }) });
fall({ id: 'N0-5', name: 'statement on module level appended to the rest', soll: 'rot', angriff: 'rot', eingabe: () => mit(sF(), { rest: (t) => `${t}\nprocess.exitCode = 3;\n` }) });
fall({ id: 'N0-6', name: 'target: additional statement with an effect', soll: 'rot', angriff: 'rot', eingabe: () => mit(sF(), { ziel: (t) => `${t}\nKREATUR_DROPS['x' as never] = [] as never;\n` }) });
fall({ id: 'N0-7', name: 'target: const made let', soll: 'rot', angriff: 'rot', eingabe: () => mit(sF(), { ziel: ersetze(/\bconst TRUHEN\b/, 'let TRUHEN') }) });

console.log('\n-- P, Y: admin/src/main.ts and editorMain.ts (second attack) --');
fall({ id: 'P1', name: 'admin/src/main.ts: HIER and WURZEL (built from import.meta.url) verbatim into spiel/pfade.ts', soll: 'rot', angriff: 'rot', eingabe: () => schnitt(ADM, { quelle: ADM, ziele: [{ datei: 'admin/src/spiel/pfade.ts', woertlich: ['HIER', 'WURZEL'] }] }) });
fall({ id: 'P2a', name: 'editorMain.ts: vorschauRechnen (new URL(…, import.meta.url)) verbatim into seite/vorschau.ts', soll: 'rot', angriff: 'rot', eingabe: () => schnitt(EDI, { quelle: EDI, ziele: [{ datei: 'client/src/editor/seite/vorschau.ts', woertlich: ['vorschauRechnen'] }] }) });
const YN = 'BetriebsAdminEintrag';
const sY = (): Eingabe => schnitt(ADM, { quelle: ADM, ziele: [{ datei: 'admin/src/spiel/typen.ts', woertlich: [YN] }] });
fall({ id: 'Y0', name: `admin/src/main.ts: interface ${YN} verbatim`, soll: 'gruen', angriff: 'gruen', eingabe: sY });
fall({ id: 'Y1', name: 'target: a member of the interface becomes optional', soll: 'rot', angriff: 'rot', eingabe: () => mit(sY(), { ziel: (t) => { const sf = parse(t); const i = sf.statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === YN); const m = i?.members.find((x): x is ts.PropertySignature => ts.isPropertySignature(x) && !x.questionToken); if (!m) throw new Error('no required member'); return `${t.slice(0, m.name.end)}?${t.slice(m.name.end)}`; } }) });
fall({ id: 'Y2', name: 'target: a second interface of the same name (declaration merging)', soll: 'rot', angriff: 'rot', eingabe: () => mit(sY(), { ziel: (t) => `${t}\nexport interface ${YN} {\n  zusatz?: string;\n}\n` }) });
fall({ id: 'Y3', name: 'target: an additional interface under another name', soll: 'rot', angriff: 'gruen', eingabe: () => mit(sY(), { ziel: (t) => `${t}\nexport interface Zusatz extends ${YN} {\n  zusatz?: string;\n}\n` }) });
fall({ id: 'Y5', name: 'target: interface made a type alias', soll: 'rot', angriff: 'rot', eingabe: () => mit(sY(), { ziel: ersetze(`interface ${YN} {`, `type ${YN} = {`) }) });
fall({ id: 'Y6', name: 'target: interface gets `extends Record<string, unknown>`', soll: 'rot', angriff: 'rot', eingabe: () => mit(sY(), { ziel: ersetze(`interface ${YN} {`, `interface ${YN} extends Record<string, unknown> {`) }) });
fall({ id: 'Y7', name: 'rest: a new interface', soll: 'rot', angriff: 'rot', eingabe: () => mit(sY(), { rest: (t) => `${t}\ninterface Neu {\n  a: number;\n}\n` }) });

console.log('\n-- I (catalogue): the import for its effect (second attack) --');
const sK = (): Eingabe => formK(KAT, 'GegenstandsKatalog', KK, ZK, kNamen);
const GLTF = "import '@babylonjs/loaders/glTF/2.0';";
fall({ id: 'I1', name: 'rest (catalogue): the import for its effect pulled to the top of the imports', soll: 'rot', angriff: 'rot', eingabe: () => mit(sK(), { rest: (t) => { if (!t.includes(GLTF)) throw new Error('no glTF import'); const ohne = t.replace(`\n${GLTF}`, ''); const sf = parse(ohne); const e = sf.statements.find(ts.isImportDeclaration)!; return muss(t, `${ohne.slice(0, e.getStart(sf))}${GLTF}\n${ohne.slice(e.getStart(sf))}`); } }) });
fall({ id: 'I10', name: 'rest (catalogue): the import for its effect a second time at the end of the imports', soll: 'rot', angriff: 'offen', eingabe: () => mit(sK(), { rest: (t) => { const sf = parse(t); const imps = sf.statements.filter(ts.isImportDeclaration); const l = imps[imps.length - 1]!; return `${t.slice(0, l.end)}\n${GLTF}${t.slice(l.end)}`; } }) });
fall({ id: 'I11', name: 'rest (catalogue): the import for its effect removed', soll: 'rot', angriff: 'rot', eingabe: () => mit(sK(), { rest: ersetze(`\n${GLTF}`, '') }) });
fall({ id: 'I12', name: 'rest (catalogue): the import for its effect made `import type {}`', soll: 'rot', angriff: 'rot', eingabe: () => mit(sK(), { rest: ersetze(GLTF, "import type {} from '@babylonjs/loaders/glTF/2.0';") }) });

console.log('\n-- form a (stage 2): the nearest cut is refused --');
fall({ id: 'FA1', name: 'admin/src/main.ts: adminsLesen and adminsSchreiben as form a (context from a factory in the rest)', soll: 'rot', angriff: 'gruen', eingabe: () => {
  const text = lies(ADM);
  const e = schnitt(ADM, { quelle: ADM, ziele: [{ datei: 'admin/src/konten.ts', woertlich: ['adminsLesen', 'adminsSchreiben'] }] }, [], text);
  const sf = parse(text);
  const ersatz: { von: number; bis: number; neu: string }[] = [];
  const fns: string[] = [];
  for (const s of sf.statements) {
    if (!ts.isFunctionDeclaration(s) || !s.name || !['adminsLesen', 'adminsSchreiben'].includes(s.name.text) || !s.body) continue;
    const params = s.parameters.map((p) => p.getText(sf));
    const args = s.parameters.map((p) => p.name.getText(sf));
    const ret = s.type ? `: ${s.type.getText(sf)}` : '';
    const rumpf = s.body.getText(sf).replace(/\bADMINS_DATEI\b/g, 'k.ADMINS_DATEI').replace(/\bsichern\(/g, 'k.sichern(').replace(/\bspielerIdGueltig\b/g, 'k.spielerIdGueltig');
    fns.push(`export function ${s.name.text}(${['k: Umgebung', ...params].join(', ')})${ret} ${rumpf}`);
    ersatz.push({ von: s.getStart(sf), bis: s.end, neu: `function ${s.name.text}(${params.join(', ')})${ret} {\n  return konten.${s.name.text}(${['kontenUmgebung()', ...args].join(', ')});\n}` });
  }
  let rest = text;
  for (const r of [...ersatz].sort((a, b) => b.von - a.von)) rest = rest.slice(0, r.von) + r.neu + rest.slice(r.bis);
  const imps = sf.statements.filter(ts.isImportDeclaration);
  const l = imps[imps.length - 1]!;
  rest = `${rest.slice(0, l.end)}\nimport * as konten from './konten';${rest.slice(l.end)}\nfunction kontenUmgebung() {\n  return { ADMINS_DATEI, sichern, spielerIdGueltig };\n}\n`;
  const ziel = `type Umgebung = { ADMINS_DATEI: string; sichern: (datei: string) => void; spielerIdGueltig: (w: unknown) => w is string };\n\n${fns.join('\n\n')}\n`;
  return mit(e, { datei: { [ADM]: rest, 'admin/src/konten.ts': ziel } });
} });

ende();
