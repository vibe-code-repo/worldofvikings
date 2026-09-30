/**
 * Move proof, rule B13: section lines stay.
 *
 * The lines before a declaration move with it. One kind of line is excepted: a section line of
 * the form `// -- title --` (written with the box drawing dash U+2500), with the empty line before it, may stay where it stood, in the rest
 * or in the class. Tests use these lines as marks to find their way in the large files.
 *
 * Only whole lines at the START of the lines before a declaration can stay, and only empty lines
 * and section lines. Everything after them moves.
 */

/** A line comment that starts with two or more box drawing dashes, carries a title and ends with a dash. */
const ABSCHNITTSZEILE = /^[ \t]*\/\/ \u2500{2,} ?\S.*\u2500[ \t]*$/u;

export function istAbschnittszeile(zeile: string): boolean {
  return ABSCHNITTSZEILE.test(zeile.replace(/\r$/, ''));
}

function istLeer(zeile: string): boolean {
  return zeile.trim() === '';
}

/** Whole lines of a text, each with its line break. A last part without line break is left out. */
function ganzeZeilen(text: string): string[] {
  const aus: string[] = [];
  let p = 0;
  for (;;) {
    const n = text.indexOf('\n', p);
    if (n < 0) return aus;
    aus.push(text.slice(p, n + 1));
    p = n + 1;
  }
}

/**
 * The part of the lines before a declaration that may stay: the longest run of empty lines and
 * section lines at the start that ends with a section line. Empty if there is no section line.
 * `vorlauf` is the text of the extent up to the start of the declaration.
 */
export function abschnittsVorspann(vorlauf: string): string {
  let laenge = 0;
  let bis = 0;
  for (const z of ganzeZeilen(vorlauf)) {
    const ohne = z.replace(/\r?\n$/, '');
    if (!istLeer(ohne) && !istAbschnittszeile(ohne)) break;
    laenge += z.length;
    if (istAbschnittszeile(ohne)) bis = laenge;
  }
  return vorlauf.slice(0, bis);
}

/** True if a text consists of whole lines that are empty or section lines. */
export function nurLeerUndAbschnitt(text: string): boolean {
  if (text !== '' && !text.endsWith('\n')) return false;
  return ganzeZeilen(text).every((z) => {
    const ohne = z.replace(/\r?\n$/, '');
    return istLeer(ohne) || istAbschnittszeile(ohne);
  });
}

/** True if a text consists of empty lines only. */
export function nurLeerzeilen(text: string): boolean {
  return /^(?:[ \t]*\r?\n)*$/.test(text);
}

/** Section lines of a text, trimmed, for the output. */
export function abschnittszeilenIn(text: string): string[] {
  return ganzeZeilen(text)
    .map((z) => z.replace(/\r?\n$/, ''))
    .filter(istAbschnittszeile)
    .map((z) => z.trim());
}

/**
 * Explains the text that stands in front of a statement of the rest in addition to its old lines:
 * it must be the section lines that some of the declarations moved away from this place left
 * behind, in their order. Returns for each candidate whether its section lines stayed, or `null`
 * if the text is not explained.
 */
export function erklaereVorspann(zusatz: string, kandidaten: readonly string[]): boolean[] | null {
  let rest = zusatz;
  const blieb = kandidaten.map((k) => {
    if (k !== '' && rest.startsWith(k)) {
      rest = rest.slice(k.length);
      return true;
    }
    return false;
  });
  return rest === '' ? blieb : null;
}
