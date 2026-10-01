/** Was steht im HTML, bevor (oder ohne dass) JavaScript läuft? */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Reckenprofil from './Reckenprofil.svelte';

const recke = {
  id: 1,
  name: 'Probe',
  klasse: 'krieger',
  aussehen: { figur: 'wikinger', frisur: 'H_04', haarfarbe: 'x', augenfarbe: 'y' },
  erstellt: 1_700_000_000_000,
  zuletztGespielt: 1_750_000_000_000,
  werte: {
    damage: 0,
    armor: 0,
    strength: 0,
    vitality: 0,
    agility: 0,
    lebenMax: 100,
    nahkampfSchaden: 1,
  },
  waffe: null,
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
