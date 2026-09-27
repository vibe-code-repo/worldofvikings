/**
 * Prüfungen der Kontoverwaltung (W3), die der Browser VOR dem Absenden macht.
 *
 * Sie sparen eine Rückfrage und einen Fehlversuch (die Sperre zählt jede
 * Anfrage mit falschem Passwort mit), ersetzen aber nie die Prüfung des
 * Servers: Was hier durchgeht, kann dort noch scheitern. Nichts in dieser
 * Datei berührt DOM oder Netz, damit die Regeln in Vitest laufen.
 */
import type { MessageKey } from './i18n';

/** Länge des öffentlichen Profiltexts in Graphem-Clustern — wie der Server sie zählt. */
export const PROFILTEXT_MAX = 300;

/** Mindestlänge des Passworts (dieselbe Zahl wie `pruefePasswort` im Server). */
export const PASSWORT_MIN = 8;
export const PASSWORT_MAX = 200;

/**
 * Anzahl der Zeichen, die eine Person sieht (Graphem-Cluster).
 *
 * `Intl.Segmenter` gibt es ab Safari 14.1, Chrome 87 und Firefox 125; wo er
 * fehlt, zählt der Rückfall Codepunkte. Das ist nie mehr als der Server
 * zählt, der Zähler zeigt dann höchstens etwas zu viel an.
 */
export function profilLaenge(text: string): number {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    let n = 0;
    for (const _ of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)) {
      void _;
      n++;
    }
    return n;
  }
  return [...text].length;
}

/** Zu lang? (Nur die Länge; die Zeichenregeln kennt allein der Server.) */
export function profilZuLang(text: string): boolean {
  return profilLaenge(text) > PROFILTEXT_MAX;
}

export interface PasswortWechsel {
  current: string;
  next: string;
  repeat: string;
}

/**
 * Prüft das Formular „Passwort ändern“. Gibt den Katalogschlüssel der
 * ersten Beanstandung zurück oder null.
 */
export function passwortWechselPruefen(f: PasswortWechsel): MessageKey | null {
  if (f.current === '') return 'account.manage.error.current_required';
  if (f.next.length < PASSWORT_MIN || f.next.length > PASSWORT_MAX) {
    return 'account.error.password_too_short';
  }
  if (f.next !== f.repeat) return 'account.manage.error.password_mismatch';
  return null;
}

/** Loose wie beim Server: nicht leer, ein @, ein Punkt dahinter, höchstens 254 Zeichen. */
export function emailPruefen(email: string): MessageKey | null {
  const e = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) {
    return 'account.error.email_invalid';
  }
  return null;
}

/**
 * Darf „Konto löschen“ abgeschickt werden? Verlangt das Passwort und den
 * eigenen Benutzernamen (ohne Beachtung der Groß-/Kleinschreibung, wie der
 * Server). Der Knopf bleibt sonst gesperrt.
 */
export function loeschenBereit(username: string, password: string, confirm: string): boolean {
  return password !== '' && confirm.trim().toLowerCase() === username.toLowerCase();
}
