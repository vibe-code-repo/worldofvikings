/**
 * F3/F4 (Security-Review): reine Logik aus Identitaet.ts — Spieler-ID,
 * SessionToken (Ausstellen/Pruefen/Ablauf/Faelschung) und der Nonce/HMAC-
 * Passwort-Handshake. Kein Server/Socket noetig.
 *
 * Haelt insbesondere fest, was die Voruntersuchung als Luecke benennt:
 * ein gefaelschtes oder mit fremdem Geheimnis gebautes Token muss vom
 * echten Geheimnis abgelehnt werden, und der leere Serverpasswort-Fall
 * darf keine Attrappenpruefung sein (falsche Antwort wird trotzdem
 * abgelehnt, auch wenn das Passwort "" ist).
 *
 * Run: npx tsx server/test/f3-identitaet.ts
 */

import {
  spielerIdErzeugen,
  istSpielerId,
  tokenAusstellen,
  tokenPruefen,
  nonceErzeugen,
  antwortBerechnen,
  antwortPruefen,
  geheimnisErzeugen,
  geheimnisAusEnv,
  WOV_SESSION_SECRET_ENV,
} from '../src/net/Identitaet.js';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

// ── Spieler-ID ────────────────────────────────────────────────────────

const idA = spielerIdErzeugen();
const idB = spielerIdErzeugen();
check('spielerIdErzeugen liefert eine gueltige ID-Form', istSpielerId(idA), idA);
check('zwei ausgestellte IDs kollidieren nicht', idA !== idB, `${idA} vs ${idB}`);
check('istSpielerId lehnt fremde Zeichenketten ab', !istSpielerId('AxeFlint'));
check('istSpielerId lehnt leere Zeichenkette ab', !istSpielerId(''));

// ── SessionToken ─────────────────────────────────────────────────────

const GEHEIMNIS = Buffer.from(geheimnisErzeugen(), 'hex');
const FREMDES_GEHEIMNIS = Buffer.from(geheimnisErzeugen(), 'hex');
const ALTLAST_USER_ID = 123456789012345n;
const JETZT = 1_700_000_000_000;

const gueltigesToken = tokenAusstellen(idA, ALTLAST_USER_ID, GEHEIMNIS, 1000 * 60 * 60, JETZT);
const ergebnisGueltig = tokenPruefen(gueltigesToken, GEHEIMNIS, JETZT + 1000);
check(
  'gueltiges Token wird angenommen',
  ergebnisGueltig.status === 'gueltig' &&
    ergebnisGueltig.spielerId === idA &&
    ergebnisGueltig.altlastUserId === ALTLAST_USER_ID,
  JSON.stringify(ergebnisGueltig, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
);

const ergebnisAbgelaufen = tokenPruefen(gueltigesToken, GEHEIMNIS, JETZT + 1000 * 60 * 60 + 1);
check('abgelaufenes Token wird abgelehnt', ergebnisAbgelaufen.status === 'abgelaufen');

// Manipuliertes Token: ein Byte im Payload-Teil gekippt (Spieler-ID gefaelscht).
const [payloadB64, sigB64] = gueltigesToken.split('.');
const manipuliertesPayload =
  payloadB64.slice(0, -1) + (payloadB64.at(-1) === 'A' ? 'B' : 'A');
const manipuliertesToken = `${manipuliertesPayload}.${sigB64}`;
const ergebnisManipuliert = tokenPruefen(manipuliertesToken, GEHEIMNIS, JETZT + 1000);
check('manipuliertes Token wird abgelehnt', ergebnisManipuliert.status === 'gefaelscht');

// Strukturell kaputtes Token (kein Punkt, falsches Format).
check(
  'strukturell kaputtes Token wird abgelehnt',
  tokenPruefen('nicht-einmal-ein-token', GEHEIMNIS, JETZT).status === 'gefaelscht',
);

// Mit fremdem Geheimnis gebautes Token wird vom echten Geheimnis abgelehnt.
const fremdesToken = tokenAusstellen(idA, ALTLAST_USER_ID, FREMDES_GEHEIMNIS, 1000 * 60 * 60, JETZT);
const ergebnisFremd = tokenPruefen(fremdesToken, GEHEIMNIS, JETZT + 1000);
check('mit fremdem Geheimnis gebautes Token wird abgelehnt', ergebnisFremd.status === 'gefaelscht');

// Token, das mit dem echten Geheimnis ausgestellt wurde, bleibt unter dem
// fremden Geheimnis ebenfalls ungueltig (Symmetriecheck).
const ergebnisEchtesTokenFremdesGeheimnis = tokenPruefen(gueltigesToken, FREMDES_GEHEIMNIS, JETZT + 1000);
check(
  'echtes Token unter fremdem Geheimnis geprueft wird abgelehnt',
  ergebnisEchtesTokenFremdesGeheimnis.status === 'gefaelscht',
);

// Zu kurzes Geheimnis muss auffliegen statt still ein schwaches Token zu bauen.
let zuKurzGeheimnisWurdeAbgelehnt = false;
try {
  tokenAusstellen(idA, ALTLAST_USER_ID, Buffer.from('kurz'), 1000, JETZT);
} catch {
  zuKurzGeheimnisWurdeAbgelehnt = true;
}
check('zu kurzes Servergeheimnis wird beim Ausstellen abgelehnt', zuKurzGeheimnisWurdeAbgelehnt);

// ── Nonce/HMAC-Passwort-Handshake (F4) ──────────────────────────────────

const PASSWORT = 'geheimesPasswort123';
const nonce1 = nonceErzeugen();
const nonce2 = nonceErzeugen();
check('nonceErzeugen liefert unterschiedliche Nonces', nonce1 !== nonce2, `${nonce1} vs ${nonce2}`);

const richtigeAntwort = antwortBerechnen(nonce1, PASSWORT);
check('richtige Nonce-Antwort wird angenommen', antwortPruefen(nonce1, PASSWORT, richtigeAntwort));
check(
  'Antwort mit falschem Passwort wird abgelehnt',
  !antwortPruefen(nonce1, PASSWORT, antwortBerechnen(nonce1, 'falschesPasswort')),
);
check(
  'Antwort fuer einen anderen Nonce wird abgelehnt (kein Replay)',
  !antwortPruefen(nonce2, PASSWORT, richtigeAntwort),
);
check(
  'voellig verzerrte Antwort wird abgelehnt, nicht abgestuerzt',
  !antwortPruefen(nonce1, PASSWORT, 'kein-hex-und-falsche-laenge'),
);

// Leeres Serverpasswort: derselbe Ablauf, kein Attrappen-Bypass — falsche
// Antworten fallen weiterhin durch, nur die richtige (mit leerem Schluessel
// berechnete) Antwort kommt durch.
const LEERES_PASSWORT = '';
const nonce3 = nonceErzeugen();
const richtigeAntwortLeer = antwortBerechnen(nonce3, LEERES_PASSWORT);
check(
  'leeres Serverpasswort: korrekt gebildete Antwort wird angenommen',
  antwortPruefen(nonce3, LEERES_PASSWORT, richtigeAntwortLeer),
);
check(
  'leeres Serverpasswort: falsch gebildete Antwort wird TROTZDEM abgelehnt (keine Attrappe)',
  !antwortPruefen(nonce3, LEERES_PASSWORT, 'irgendwas'),
);
check(
  'leeres Serverpasswort: Antwort, die fuer ein GESETZTES Passwort berechnet wurde, wird abgelehnt',
  !antwortPruefen(nonce3, LEERES_PASSWORT, antwortBerechnen(nonce3, PASSWORT)),
);

// ── Servergeheimnis aus der Umgebung ────────────────────────────────────

const hex = geheimnisErzeugen();
check('geheimnisErzeugen liefert 64 Hex-Zeichen (32 Byte)', /^[0-9a-f]{64}$/.test(hex), hex);

const geladen = geheimnisAusEnv({ [WOV_SESSION_SECRET_ENV]: hex });
check('geheimnisAusEnv laedt ein gueltiges Geheimnis', geladen !== undefined && geladen.length === 32);

check('geheimnisAusEnv liefert undefined, wenn die Variable fehlt', geheimnisAusEnv({}) === undefined);
check(
  'geheimnisAusEnv liefert undefined bei zu kurzem Wert',
  geheimnisAusEnv({ [WOV_SESSION_SECRET_ENV]: 'ab12' }) === undefined,
);
check(
  'geheimnisAusEnv liefert undefined bei Nicht-Hex-Muell',
  geheimnisAusEnv({ [WOV_SESSION_SECRET_ENV]: 'x'.repeat(64) }) === undefined,
);

console.log(
  failures === 0 ? '\n=== F3/F4 Identitaet: ALL PASSED ===' : `\n=== F3/F4 Identitaet: ${failures} FAILED ===`,
);
process.exit(failures === 0 ? 0 : 1);
