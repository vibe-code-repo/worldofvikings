/**
 * T4a N2 (R3) — the REAL `SpawnPanel` in a DOM stand-in (no browser), wired exactly as `Testflug.ts` wires it
 * (`panelRueckrufe`, `speichernVerdrahtung`, `neustartSteuerung`, the real persistence), against a fake service.
 * It shows what source checks only claim: button → question → "Ja" → run, both save buttons locked from start to
 * end, the question closed after "Ja" and "Abbrechen", the status line, a second click in the run, the plain
 * save locked in the run and a restart run refused while a plain save is on its way (R5).
 *
 * Run: npx tsx test/gelaende-neustart-panel.ts   (from client/)
 */
let fehler = 0;
let fertig = false;
process.on('exit', () => {
  if (!fertig) {
    console.error('Test vorzeitig beendet (ein Versprechen wurde nie erfüllt)');
    process.exitCode = 1;
  }
});
function pruefe(ok: boolean, name: string, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}
const warte = (ms: number): Promise<void> => new Promise((f) => setTimeout(f, ms));

// ── DOM-Nachbau ───────────────────────────────────────────────────────
interface El {
  tag: string;
  style: Record<string, string>;
  children: El[];
  textContent: string;
  disabled: boolean;
  onclick: null | (() => void);
  [k: string]: unknown;
}
const alle: El[] = [];
function element(tag: string): El {
  const roh: El = {
    tag,
    style: { cssText: '' },
    children: [],
    textContent: '',
    disabled: false,
    onclick: null,
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c: El) {
      roh.children.push(c);
      return c;
    },
    append(...c: El[]) {
      roh.children.push(...c);
    },
    prepend(...c: El[]) {
      roh.children.unshift(...c);
    },
    insertBefore(c: El) {
      roh.children.push(c);
      return c;
    },
    replaceChildren(...c: El[]) {
      roh.children = c;
    },
    removeChild(c: El) {
      roh.children = roh.children.filter((x) => x !== c);
      return c;
    },
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    focus() {},
    blur() {},
    click() {
      roh.onclick?.();
    },
    scrollIntoView() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }),
  };
  alle.push(roh);
  return roh;
}
const g = globalThis as unknown as Record<string, unknown>;
const speicher = new Map<string, string>();
g.localStorage = { getItem: (k: string) => speicher.get(k) ?? null, setItem: (k: string, v: string) => void speicher.set(k, v), removeItem: (k: string) => void speicher.delete(k) };
g.document = { createElement: element, body: element('body'), addEventListener() {}, removeEventListener() {}, pointerLockElement: null, activeElement: null, exitPointerLock() {} };
g.window = { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 720 };
class Leer {}
for (const n of ['HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLDivElement', 'HTMLTextAreaElement']) if (!(n in g)) g[n] = Leer;
console.warn = (): void => {};

// ── Dienst-Nachbau ────────────────────────────────────────────────────
const hx = (n: number): string => String(n).padStart(64, '0');
const dienst = { hash: hx(1), schreibungen: 0, neustartPosts: 0, weltPosts: 0, neustart: 'ok' as 'ok' | 'wirft', zustaende: [{ aktiv: true, roh: 'active' }] as Array<{ aktiv: boolean; roh: string }>, gets: 0, spielerGets: 0 };
g.fetch = async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
  const methode = init?.method ?? 'GET';
  if (url === '/api/worldlayout' && methode === 'POST') {
    dienst.weltPosts++;
    await new Promise((f) => setTimeout(f, 15));
    if (init?.headers?.['If-Match'] !== `"${dienst.hash}"`) return new Response(JSON.stringify({ fehler: 'veraltet', aktuell: dienst.hash }), { status: 409 });
    dienst.schreibungen++;
    dienst.hash = hx(dienst.schreibungen + 1);
    return new Response(JSON.stringify({ ok: true, hash: dienst.hash, angewendet: false, grund: 'geo', message: 'Geschrieben, aber nicht angewendet (geo).' }), { status: 202 });
  }
  if (url === '/api/server' && methode === 'POST') {
    dienst.neustartPosts++;
    await new Promise((f) => setTimeout(f, 15));
    if (dienst.neustart === 'wirft') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify({ aktion: 'neustart' }), { status: 200 });
  }
  if (url === '/api/server') {
    const z = dienst.zustaende[Math.min(dienst.gets++, dienst.zustaende.length - 1)]!;
    return new Response(JSON.stringify({ dienst: 'wov-server', zustand: { seit: 'x', ...z }, spieler: 3 }), { status: 200 });
  }
  return new Response('nicht gefunden', { status: 404 });
};


async function main(): Promise<void> {
  const { SpawnPanel } = await import('../src/editor/SpawnPanel');
  const { t } = await import('../src/editor/i18n');
  const { localStoragePersistenz, ENTWURF_SCHLUESSEL } = await import('../src/editor/testflug/LocalStoragePersistenz');
  const { neustartSteuerung } = await import('../src/editor/testflug/neustartSteuerung');
  const { echtesHolen, spielerLesen } = await import('../src/editor/testflug/neustart');
  const { speichernVerdrahtung, panelRueckrufe } = await import('../src/editor/testflug/speichernVerdrahtung');

  speicher.set(ENTWURF_SCHLUESSEL, JSON.stringify({ version: 1, name: 'Panel', detailSeed: 'wov', continents: [], regions: [{ id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 2000 }, edgeFalloff: 300 }], heightDeltas: [{ zx: 0, zz: 0, r: ['32|32|12'] }] }));
  speicher.set('wov-editor-entwurf-stand', JSON.stringify({ zeit: '2026-10-01T00:00:00.000Z', instanz: 'dev', quelle: 'server', tabId: 'a', basis: hx(1) }));

  const persistenz = localStoragePersistenz();
  const entwurf = { laden: () => persistenz.laden(), rohtext: () => persistenz.rohtext?.() ?? null, speichern: (d: object) => persistenz.speichern(d) };
  const hud: string[] = [];
  let uhr = 0;
  let neustart: ReturnType<typeof neustartSteuerung>;
  const verdrahtung = speichernVerdrahtung({ entwurf, hud: (x) => hud.push(x), neustart: () => neustart });
  // Wired like Testflug.ts: the panel gets `panelRueckrufe`, the control gets the panel as its surface.
  const panel = new SpawnPanel({ ...panelRueckrufe(() => ({ verdrahtung, neustart })) } as never);
  neustart = neustartSteuerung({
    entwurf,
    holen: echtesHolen,
    jetzt: () => uhr,
    schlafe: async (ms) => {
      uhr += ms;
      await warte(4);
    },
    spieler: () => spielerLesen(echtesHolen),
    oberflaeche: panel,
    hud: (x) => hud.push(x),
    belegt: () => verdrahtung.einfachLaeuft(),
  });

  const knoepfe = alle.filter((e) => e.tag === 'button');
  const finde = (text: string): El[] => knoepfe.filter((k) => k.textContent === text);
  const kNeustart = finde(t('testflug.gelaende.speichern_neustart'));
  const kSpeichern = finde(t('testflug.gelaende.speichern'));
  const kJa = finde(t('testflug.neustart.ja'));
  const kAb = finde(t('testflug.neustart.abbrechen'));
  pruefe(kNeustart.length === 1 && kSpeichern.length === 1 && kJa.length === 1 && kAb.length === 1, 'P0: die vier Knöpfe sind im Panel', `${kNeustart.length}/${kSpeichern.length}/${kJa.length}/${kAb.length}`);
  const frage = alle.find((e) => e.children.some((c) => c.textContent === t('testflug.neustart.titel')));
  const statusZeile = (): El | undefined => alle.find((e) => e.tag === 'div' && e !== frage && e.style.cssText.includes('font-size:11px;margin-top:6px;display:none'));
  if (!frage || !kNeustart[0] || !kSpeichern[0] || !kJa[0] || !kAb[0]) {
    pruefe(false, 'P0: Panel unvollständig');
    process.exit(1);
  }
  const sichtbar = (): boolean => frage.style.display === 'block';
  pruefe(!sichtbar(), 'P1: die Frage ist anfangs verborgen');

  kNeustart[0].onclick!();
  await warte(30);
  pruefe(sichtbar() && dienst.weltPosts === 0 && dienst.neustartPosts === 0, 'P2: Klick zeigt nur die Frage, kein POST');
  pruefe(frage.children[2]?.textContent === t('testflug.neustart.spieler', { count: 3 }), 'P2: die Frage nennt die Spielerzahl', String(frage.children[2]?.textContent));

  kAb[0].onclick!();
  pruefe(!sichtbar() && dienst.neustartPosts === 0, 'P3: „Abbrechen“ schließt die Frage, kein POST');

  kNeustart[0].onclick!();
  await warte(30);
  kJa[0].onclick!();
  pruefe(!sichtbar(), 'P4: „Ja“ schließt die Frage');
  pruefe(kSpeichern[0].disabled && kNeustart[0].disabled, 'P4: beide Speichern-Knöpfe sind sofort nach „Ja“ gesperrt');
  await warte(8);
  kSpeichern[0].onclick!();
  kNeustart[0].onclick!();
  kJa[0].onclick!();
  pruefe(knoepfe.filter((k) => k.disabled && k !== kSpeichern[0] && k !== kNeustart[0]).length === 0, 'P4: kein weiterer Knopf gesperrt');
  pruefe(kSpeichern[0].disabled && kNeustart[0].disabled, 'P4: ein zweites „Ja“ im Lauf hebt die Sperre nicht auf');
  const s = Date.now();
  while (neustart.laeuft() && Date.now() - s < 5000) await warte(10);
  await warte(20);
  pruefe(dienst.weltPosts === 1 && dienst.neustartPosts === 1, 'P5: Klicks auf alle Knöpfe im Lauf → 1 Welt-POST, 1 Neustart-POST', `${dienst.weltPosts}/${dienst.neustartPosts}`);
  pruefe(hud.some((x) => x === t('testflug.neustart.fehler.gesperrt')), 'P5: der einfache Speichern-Knopf wird im Lauf mit eigenem Text abgelehnt');
  pruefe(!kSpeichern[0].disabled && !kNeustart[0].disabled && kNeustart[0].style.opacity === '1', 'P6: nach dem Ende sind beide Knöpfe frei');
  pruefe(statusZeile()?.textContent?.includes('läuft wieder') === true && !(statusZeile()?.textContent ?? '').includes('Meldung beim Speichern'), 'P6: Statuszeile „läuft wieder“, ohne den überholten geo-Satz (R7)', String(statusZeile()?.textContent));

  // R5: einfaches Speichern unterwegs, dann Klick und „Ja“
  hud.length = 0;
  dienst.weltPosts = 0;
  dienst.neustartPosts = 0;
  speicher.set('wov-editor-entwurf-stand', JSON.stringify({ zeit: '2026-10-01T00:00:00.000Z', instanz: 'dev', quelle: 'server', tabId: 'a', basis: dienst.hash }));
  kSpeichern[0].onclick!();
  pruefe(verdrahtung.einfachLaeuft(), 'R5: das einfache Speichern läuft');
  kNeustart[0].onclick!();
  await warte(5);
  kJa[0].onclick!();
  kSpeichern[0].onclick!();
  await warte(60);
  pruefe(dienst.weltPosts === 1 && dienst.neustartPosts === 0, 'R5: während des einfachen Speicherns kein zweiter Welt-POST und kein Neustart', `${dienst.weltPosts}/${dienst.neustartPosts}`);
  pruefe(hud.filter((x) => x === t('testflug.neustart.fehler.speichert_noch')).length >= 2, 'R5: der Hinweis „Speichern läuft noch“ erscheint', hud.join(' | ').slice(0, 200));
  pruefe(!verdrahtung.einfachLaeuft() && !kNeustart[0].disabled, 'R5: danach ist alles wieder frei');

  // N5: der Neustart-POST wirft, der Dienst kommt nie hoch
  dienst.neustart = 'wirft';
  dienst.zustaende = [{ aktiv: false, roh: 'activating' }];
  speicher.set('wov-editor-entwurf-stand', JSON.stringify({ zeit: '2026-10-01T00:00:00.000Z', instanz: 'dev', quelle: 'server', tabId: 'a', basis: dienst.hash }));
  dienst.neustartPosts = 0;
  kNeustart[0].onclick!();
  await warte(30);
  kJa[0].onclick!();
  await warte(60);
  const vorher = dienst.neustartPosts;
  kNeustart[0].onclick!();
  kJa[0].onclick!();
  pruefe(dienst.neustartPosts === vorher && kSpeichern[0].disabled && kNeustart[0].disabled, 'N5: Antwort fehlt: Klick und „Ja“ senden nicht erneut, Knöpfe bleiben gesperrt', `${vorher}/${dienst.neustartPosts}`);
  const s2 = Date.now();
  while (neustart.laeuft() && Date.now() - s2 < 8000) await warte(10);
  await warte(20);
  pruefe(!kSpeichern[0].disabled && !kNeustart[0].disabled, 'N5: nach dem Zeitlimit wieder frei');
  pruefe(statusZeile()?.style.color === '#e08a7a', 'N5: Fehlerfarbe in der Statuszeile', String(statusZeile()?.style.color));

  console.log(fehler === 0 ? '\nalle Prüfungen bestanden' : `\n${fehler} Prüfung(en) FEHLGESCHLAGEN`);
  fertig = true;
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
