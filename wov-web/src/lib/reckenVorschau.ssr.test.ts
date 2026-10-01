/** Was steht im HTML, bevor (oder ohne dass) JavaScript läuft? */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Reckenprofil from './Reckenprofil.svelte';

const recke = {
  id: 'r1',
  name: 'Probe',
  beiname: 'b',
  sippe: 's',
  welt: 'w',
  stufe: 1,
  tode: 0,
  spielzeit_stunden: 1,
  zuletzt_gesehen: '2026-09-30T10:00:00Z',
  erschaffen: '2026-09-01T10:00:00Z',
  werte: { leben: 1, ausdauer: 1, eitr: 1, traglast: 1 },
  fertigkeiten: [],
  bosse: [],
  biome: [],
  trophaeen: [],
  ausruestung: {},
};
const aussehen = {
  klasse: 'krieger',
  figur: 'wikinger',
  frisur: 'H_04',
  haarfarbe: 'x',
  augenfarbe: 'y',
};
const buehne = (html: string) =>
  html.slice(html.indexOf('class="stage'), html.indexOf('profile-name'));

describe('Profil ohne JavaScript', () => {
  it('ohne aussehen: nur die Silhouette, keine Leinwand, keine Knöpfe', () => {
    const b = buehne(render(Reckenprofil, { props: { recke } }).body);
    expect(b).toContain('role="img"');
    expect(b).not.toContain('<canvas');
    expect(b).not.toContain('<button');
  });

  it('mit aussehen: Silhouette, keine Knöpfe ohne Wirkung, kein Dauer-Ladehinweis, Leinwand für Vorleser verborgen', () => {
    const b = buehne(render(Reckenprofil, { props: { recke, aussehen } }).body);
    expect(b).toContain('role="img"'); // die Silhouette
    expect(b).not.toContain('<button');
    expect(b).not.toContain('Figur wird geladen');
    expect(b).toMatch(/<canvas[^>]*aria-hidden="true"/);
  });
});
