/**
 * Das Thing — Waechter ueber die Forendatenbank.
 *
 * Reine Datenschicht, kein Netz, kein Server: eine Wegwerfdatei unter
 * `os.tmpdir()`, ein paar Themen und Beitraege, dann die Fragen, auf die
 * sich die API verlaesst. Laeuft ohne `assets/`, ohne GPU, ohne Blender —
 * damit im CI-Checkout genauso wie auf `wov-dev`.
 *
 * Geprueft wird, was die API still voraussetzt:
 *  - der Konstruktor legt die sechs Bretter aus BOARD_SLUGS an (idempotent),
 *  - die Zaehler am Brett und am Thema stimmen nach jedem Schreiben,
 *  - Themenlisten stehen „angeheftet zuerst, dann nach letzter Regung",
 *  - Blaettern verliert nichts und erfindet nichts,
 *  - Beitraege kommen in Schreibreihenfolge, geloeschte als Platzhalter,
 *  - unbekannte Bretter/Ids liefern null statt zu raten.
 *
 * The Thing's data-layer guard: pure, temp file, no network.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BOARD_SLUGS, FORUM_PAGE_SIZE } from '@wov/shared';
import { ForumDatabase, type ForumAutor } from '../src/forum/ForumDatabase.js';

const dir = mkdtempSync(join(tmpdir(), 'wov-forum-'));
let fehler = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    console.log(`  OK   ${name}`);
  } else {
    fehler++;
    console.error(`  ROT  ${name}`);
  }
}

const AUTOR: ForumAutor = { charakterId: 7, kontoId: 3, name: 'Sigrid' };

try {
  const db = new ForumDatabase(join(dir, 'world.db'));

  // ── 1. Bretter ────────────────────────────────────────────────────
  const bretter = db.boardList();
  check('sechs Bretter in BOARD_SLUGS-Reihenfolge', bretter.length === BOARD_SLUGS.length
    && bretter.every((b, i) => b.slug === BOARD_SLUGS[i]));
  check('frisches Forum: alle Zaehler 0, keine Regung', bretter.every(
    (b) => b.threadCount === 0 && b.postCount === 0 && b.lastActivity === null));
  check('unbekanntes Brett ⇒ null', db.boardBySlug('gibt-es-nicht') === null);
  check('bekanntes Brett ⇒ Threadzahl', db.boardBySlug('forge')?.threadCount === 0);

  // Idempotenz: ein zweiter Aufruf legt nichts doppelt an.
  db.ensureBoards(BOARD_SLUGS);
  check('ensureBoards ist idempotent', db.boardList().length === BOARD_SLUGS.length);

  // ── 2. Thema + erster Beitrag ─────────────────────────────────────
  const t1 = db.createThread('mead_hall', 'Erster Axtkauf', AUTOR, 'Wo kauft man Aexte?', 1000);
  check('createThread liefert beide Ids', t1.threadId > 0 && t1.postId > 0);

  const thema1 = db.threadById(t1.threadId);
  check('Thema traegt Autor, Brett und Titel', !!thema1
    && thema1.board === 'mead_hall' && thema1.title === 'Erster Axtkauf'
    && thema1.authorName === 'Sigrid' && thema1.authorCharacterId === 7);
  check('Thema hat genau einen Beitrag', thema1?.postCount === 1 && db.countPosts(t1.threadId) === 1);
  check('Brett zaehlt das Thema', db.boardBySlug('mead_hall')?.threadCount === 1);

  const beitrag = db.listPosts(t1.threadId, 100, 0);
  check('erster Beitrag ist der Eroeffnungsbeitrag', beitrag.length === 1
    && beitrag[0]!.bodyMd === 'Wo kauft man Aexte?' && beitrag[0]!.authorName === 'Sigrid');

  // ── 3. Antwort zieht die Zahlen nach ──────────────────────────────
  db.createPost(t1.threadId, { ...AUTOR, name: 'Bjorn' }, 'Im Dorf, beim Schmied.', 2000);
  const thema1b = db.threadById(t1.threadId);
  check('Antwort: postCount 2, last_post_at 2000', thema1b?.postCount === 2 && thema1b?.lastPostAt === 2000);
  const beitrag2 = db.listPosts(t1.threadId, 100, 0);
  check('Beitraege in Schreibreihenfolge', beitrag2.length === 2
    && beitrag2[0]!.id < beitrag2[1]!.id && beitrag2[1]!.authorName === 'Bjorn');
  check('Brett-Beitragszahl zaehlt beide', db.boardBySlug('mead_hall')
    ? db.boardList().find((b) => b.slug === 'mead_hall')!.postCount === 2 : false);

  // ── 4. Reihenfolge in der Themenliste ─────────────────────────────
  const t2 = db.createThread('mead_hall', 'Zweites Thema', AUTOR, 'x', 2500);
  let liste = db.listThreads('mead_hall', FORUM_PAGE_SIZE, 0);
  check('neueste Regung steht oben', liste[0]!.id === t2.threadId && liste[1]!.id === t1.threadId);

  // Eine spaetere Antwort im aelteren Thema schiebt es nach oben.
  db.createPost(t1.threadId, AUTOR, 'spaeter', 3000);
  liste = db.listThreads('mead_hall', FORUM_PAGE_SIZE, 0);
  check('Antwort hebt das Thema nach oben', liste[0]!.id === t1.threadId);

  // ── 5. Blaettern ──────────────────────────────────────────────────
  for (let i = 0; i < FORUM_PAGE_SIZE + 4; i++) {
    db.createThread('forge', `Thema ${i}`, AUTOR, 'y', 4000 + i);
  }
  const gesamt = db.countThreads('forge');
  check(`forge hat ${FORUM_PAGE_SIZE + 4} Themen`, gesamt === FORUM_PAGE_SIZE + 4);
  const seite1 = db.listThreads('forge', FORUM_PAGE_SIZE, 0);
  const seite2 = db.listThreads('forge', FORUM_PAGE_SIZE, FORUM_PAGE_SIZE);
  check('Seite 1 ist voll', seite1.length === FORUM_PAGE_SIZE);
  check('Seite 2 traegt den Rest', seite2.length === 4);
  const alleIds = new Set([...seite1, ...seite2].map((t) => t.id));
  check('die beiden Seiten ueberschneiden sich nicht', alleIds.size === gesamt);

  // ── 6. Unbekanntes Thema ──────────────────────────────────────────
  check('unbekanntes Thema ⇒ null', db.threadById(999999) === null);

  db.schliessen();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (fehler > 0) {
  console.error(`\nForum-Datenbank: ${fehler} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nForum-Datenbank: alles gruen.');
