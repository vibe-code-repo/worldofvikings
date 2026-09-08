/**
 * Lab ticket: sign a session ticket for an existing character and print the
 * play link. Only for wov-lab, where the world is reached without the
 * public website (whose login page only knows the dev and live shores).
 *
 * Reads WOV_SESSION_SECRET_HEX from /etc/wov.env (the same value the game
 * server signs with, see WovServer.ts), looks the character up in the
 * account database and signs with tokenAusstellen — exactly the token the
 * website would hand out. The client stores it from `#ticket=` and stops
 * redirecting to the website.
 *
 *   node_modules/.bin/tsx tools/lab-ticket.ts <character name> [days=30] [host]
 *
 * --- Deutsche Übersetzung ---
 * Labor-Ticket: signiert ein Sitzungs-Ticket für einen vorhandenen Charakter
 * und gibt den Spiel-Link aus. Nur für wov-lab, das ohne die öffentliche
 * Webseite erreicht wird (deren Anmeldeseite kennt nur dev und live).
 * Liest WOV_SESSION_SECRET_HEX aus /etc/wov.env, sucht den Charakter in der
 * Kontenbank und signiert mit tokenAusstellen — dasselbe Token, das die
 * Webseite ausgeben würde. Der Client übernimmt es aus `#ticket=`.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { geheimnisAusEnv, tokenAusstellen, WOV_SESSION_SECRET_ENV } from '../server/src/net/Identitaet.js';

const [, , name, tageArg = '30', host = 'https://lab.staging.world-of-vikings.com'] = process.argv;
if (!name) {
  console.error('Aufruf: tsx tools/lab-ticket.ts <Charaktername> [Tage=30] [Host]');
  process.exit(1);
}

const env: Record<string, string> = {};
for (const zeile of readFileSync('/etc/wov.env', 'utf8').split('\n')) {
  const m = /^([A-Z_]+)=(.*)$/.exec(zeile.trim());
  if (m) env[m[1]] = m[2];
}
const geheimnis = geheimnisAusEnv(env);
if (!geheimnis) {
  console.error(`${WOV_SESSION_SECRET_ENV} fehlt oder ist ungültig in /etc/wov.env (64 Hex-Zeichen).`);
  process.exit(2);
}
const instanz = env.WOV_INSTANZ ?? 'dev';

const db = new DatabaseSync(`server/data/konten/${instanz}.db`, { readOnly: true });
const zeile = db
  .prepare(
    `select ch.name, ch.spieler_id, ch.altlast_user_id, k.benutzername
       from charaktere ch join konten k on k.id = ch.konto_id
      where ch.name = ? collate nocase`,
  )
  .get(name) as { name: string; spieler_id: string; altlast_user_id: string; benutzername: string } | undefined;
if (!zeile) {
  console.error(`Kein Charakter „${name}" in server/data/konten/${instanz}.db.`);
  const alle = db.prepare('select name from charaktere order by zuletzt_gespielt desc limit 15').all() as { name: string }[];
  console.error('Vorhanden: ' + alle.map((a) => a.name).join(', '));
  process.exit(3);
}

const tage = Number(tageArg);
const ticket = tokenAusstellen(zeile.spieler_id, BigInt(`0x${zeile.altlast_user_id || '0'}`), geheimnis, tage * 24 * 60 * 60 * 1000);
console.log(`Charakter ${zeile.name} (Konto ${zeile.benutzername}, ${zeile.spieler_id}), gültig ${tage} Tage`);
console.log(`${host}/?name=${encodeURIComponent(zeile.name)}#ticket=${ticket}`);
