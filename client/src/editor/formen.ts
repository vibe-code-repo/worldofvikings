/**
 * Predefined island shapes of the map editor: `FORMEN` and the two generators its
 * entries use.
 *
 * Load order: `editorMain.ts` imports this module, so it is evaluated BEFORE the two
 * registry awaits at the top of `editorMain.ts`. Nothing here may read a registry
 * while the module loads; this module imports types only.
 */
import type { RegionDef } from '@wov/shared';

/**
 * Vordefinierte Inselformen — jede erzeugt eine Region-Form um den
 * Klickpunkt. Polygon-Generatoren streuen die Radien leicht, damit Küsten
 * organisch wirken (das Layout speichert die fertigen Punkte, nicht das
 * Rezept). Erweiterbar: neuer Eintrag hier genügt, das Menü baut sich
 * daraus auf.
 */
interface FormDef {
  id: string;
  name: string;
  erzeuge: (x: number, z: number, groesse: number) => RegionDef['shape'];
}
const rundPoly = (
  x: number,
  z: number,
  n: number,
  radius: (winkel: number, i: number) => number,
  drehung = Math.random() * Math.PI * 2
): RegionDef['shape'] => ({
  kind: 'polygon',
  points: Array.from({ length: n }, (_, i) => {
    const w = drehung + (i / n) * Math.PI * 2;
    const r = radius(w, i);
    return [Math.round(x + Math.cos(w) * r), Math.round(z + Math.sin(w) * r)] as [number, number];
  }),
});
const zufall = (basis: number, streuung: number): number => basis * (1 - streuung + Math.random() * streuung * 2);
const FORMEN: readonly FormDef[] = [
  { id: 'kreis', name: '● Kreis', erzeuge: (x, z, g) => ({ kind: 'circle', x: Math.round(x), z: Math.round(z), radius: Math.round(g) }) },
  {
    id: 'oval',
    name: '⬭ Oval',
    erzeuge: (x, z, g) => {
      const dreh = Math.random() * Math.PI;
      return rundPoly(x, z, 24, (w) => {
        const rx = g;
        const rz = g * 0.62;
        const c = Math.cos(w - dreh);
        const s2 = Math.sin(w - dreh);
        return zufall((rx * rz) / Math.hypot(rz * c, rx * s2), 0.05);
      }, 0);
    },
  },
  {
    id: 'langinsel',
    name: '⟟ Langinsel',
    erzeuge: (x, z, g) => {
      const dreh = Math.random() * Math.PI;
      return rundPoly(x, z, 28, (w) => {
        const rx = g * 1.7;
        const rz = g * 0.45;
        const c = Math.cos(w - dreh);
        const s2 = Math.sin(w - dreh);
        return zufall((rx * rz) / Math.hypot(rz * c, rx * s2), 0.09);
      }, 0);
    },
  },
  {
    id: 'halbmond',
    name: '☾ Halbmond',
    erzeuge: (x, z, g) => {
      // Außenbogen + eingerückter Innenbogen — eine Bucht-Insel.
      const dreh = Math.random() * Math.PI * 2;
      const punkte: [number, number][] = [];
      const n = 14;
      for (let i = 0; i <= n; i++) {
        const w = dreh + (i / n) * Math.PI * 1.35 - Math.PI * 0.675;
        const r = zufall(g, 0.06);
        punkte.push([Math.round(x + Math.cos(w) * r), Math.round(z + Math.sin(w) * r)]);
      }
      for (let i = n; i >= 0; i--) {
        const w = dreh + (i / n) * Math.PI * 1.35 - Math.PI * 0.675;
        const r = zufall(g * 0.55, 0.08);
        const vx = x + Math.cos(dreh) * g * 0.28;
        const vz = z + Math.sin(dreh) * g * 0.28;
        punkte.push([Math.round(vx + Math.cos(w) * r), Math.round(vz + Math.sin(w) * r)]);
      }
      return { kind: 'polygon', points: punkte };
    },
  },
  {
    id: 'zacken',
    name: '✶ Zackenküste',
    erzeuge: (x, z, g) => rundPoly(x, z, 26, () => zufall(g, 0.32)),
  },
  {
    id: 'plateau',
    name: '▭ Plateau',
    erzeuge: (x, z, g) =>
      rundPoly(x, z, 20, (w) => {
        const c = Math.abs(Math.cos(w));
        const s2 = Math.abs(Math.sin(w));
        return zufall(Math.min(g / Math.max(c, 0.0001), (g * 0.7) / Math.max(s2, 0.0001)), 0.04);
      }),
  },
];

export { FORMEN };
