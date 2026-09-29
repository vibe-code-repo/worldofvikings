/**
 * Sign-in dialog: the 409 `conflict` answer (a concurrent password change
 * bumped the token generation) has its own translated message instead of
 * the generic "unknown error".
 */
import assert from 'node:assert/strict';
import de from '../src/i18n/katalog/de.json';
import en from '../src/i18n/katalog/en.json';
import { ApiFehler, fehlerTextSchluessel, ruf } from '../src/ui/Anmeldung.js';

console.log('\nAnmeldung: 409 conflict');

const echtesFetch = globalThis.fetch;
try {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'conflict' }), { status: 409 })) as typeof fetch;
  let gefangen: unknown;
  try {
    await ruf('/accounts/login', { methode: 'POST', koerper: {} });
  } catch (e) {
    gefangen = e;
  }
  assert.ok(gefangen instanceof ApiFehler, 'the 409 answer is thrown as ApiFehler');
  assert.equal((gefangen as ApiFehler).schluessel, 'conflict');
  const key = fehlerTextSchluessel((gefangen as ApiFehler).schluessel);
  assert.equal(key, 'login.error.conflict', '409 conflict maps to its own key, not "unknown"');
  assert.ok(key in de && key in en, 'the key exists in both catalogues');
  assert.notEqual((de as Record<string, string>)[key], (de as Record<string, string>)['login.error.unknown']);
  assert.notEqual((en as Record<string, string>)[key], (en as Record<string, string>)['login.error.unknown']);
  assert.equal(fehlerTextSchluessel('gibt-es-nicht'), 'login.error.unknown', 'unknown keys still fall back');
} finally {
  globalThis.fetch = echtesFetch;
}
console.log('Anmeldung: 409 conflict -> login.error.conflict');
