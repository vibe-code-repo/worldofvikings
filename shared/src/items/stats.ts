/**
 * Item attributes and the combat formulas that use them (stage 1).
 * Item-Attribute und die Kampfformeln dazu (Stufe 1).
 *
 * Pure module: no clock, no state, no random. Every function gets the values of ONE player
 * per call, so two players with different gear can never share a number. The tuning knobs are
 * collected in `REGLER`; a test (or a later balance pass) can hand in a different set.
 *
 * Rein: keine Uhr, kein Zustand. Jede Funktion bekommt die Werte EINES Spielers je Aufruf.
 * Die Regler stehen an einer Stelle (`REGLER`); ihre Zahlen sind Vorschläge, bis sie freigegeben sind.
 *
 * Display names are NOT stored here. They are translation keys (`stat.<id>`, `stat.<id>.desc`,
 * see `STAT_TEXT_KEYS`), so no fixed text lives in the code.
 */

/** Attributes that exist in stage 1 and that the server evaluates. */
export const STAT_IDS = ['damage', 'armor', 'strength', 'vitality', 'agility'] as const;
export type StatId = typeof STAT_IDS[number];

/** Reserved identifier, no effect yet (there are no spells and no mana). Not part of `StatId`. */
export const RESERVIERTE_STAT_IDS = ['intellect'] as const;

/** Attribute values of an item; a missing entry means 0. */
export type ItemStats = Partial<Record<StatId, number>>;

/** Summed attribute values of one player (all ids present). */
export type Werte = Readonly<Record<StatId, number>>;

/** Translation keys reserved for the display names (the texts themselves come with the text catalog). */
export const STAT_TEXT_KEYS: Readonly<Record<StatId | typeof RESERVIERTE_STAT_IDS[number], { name: string; desc: string }>> = {
  damage: { name: 'stat.damage', desc: 'stat.damage.desc' },
  armor: { name: 'stat.armor', desc: 'stat.armor.desc' },
  strength: { name: 'stat.strength', desc: 'stat.strength.desc' },
  vitality: { name: 'stat.vitality', desc: 'stat.vitality.desc' },
  agility: { name: 'stat.agility', desc: 'stat.agility.desc' },
  intellect: { name: 'stat.intellect', desc: 'stat.intellect.desc' },
};

/** Damage of a bare fist ('' = no weapon). `leben.ts` is calibrated against these numbers. */
export const FAUST_SCHADEN = 4;

/** Base stamina cost of one melee swing (was `SCHLAG_AUSDAUER` in the server). */
export const SCHLAG_AUSDAUER_BASIS = 8;

/** Base maximum health of a player. */
export const LEBEN_BASIS = 100;

/** The tuning knobs. PROPOSED numbers, to be confirmed by the game designer. */
export interface StatRegler {
  /** Armor calibration point: an armor SUM of K halves the incoming damage. */
  readonly K: number;
  /** Extra melee damage per strength point (0.01 = +1 %). */
  readonly s: number;
  /** Extra maximum health per vitality point. */
  readonly v: number;
  /** Swing cost reduction per agility point (0.02 = -2 %). */
  readonly a: number;
  /** Lower bound of the swing cost as a share of the base cost (0.5 = half). */
  readonly schlagkostenUntergrenze: number;
}

export const REGLER: StatRegler = {
  K: 40,
  s: 0.01,
  v: 2,
  a: 0.02,
  schlagkostenUntergrenze: 0.5,
};

/** All-zero values: a player without any gear. */
export const KEINE_WERTE: Werte = { damage: 0, armor: 0, strength: 0, vitality: 0, agility: 0 };

/** Base melee damage of a weapon: its `damage` attribute, the fist damage without one. */
export function waffenSchaden(stats: ItemStats | undefined): number {
  return stats?.damage ?? FAUST_SCHADEN;
}

/** Sums the attributes over the worn parts. Unknown / non-finite / negative entries count as 0. */
export function summiereWerte(teile: Iterable<ItemStats | undefined>): Werte {
  const summe: Record<StatId, number> = { ...KEINE_WERTE };
  for (const stats of teile) {
    if (!stats) continue;
    for (const id of STAT_IDS) {
      const wert = stats[id];
      if (typeof wert === 'number' && Number.isFinite(wert) && wert > 0) summe[id] += wert;
    }
  }
  return summe;
}

/**
 * Damage a creature/NPC blow does to a player after armor: `damage * K / (K + armor)`, at least 1.
 * Not rounded (player health is a float). Without armor the damage is returned UNCHANGED, bit for bit.
 * Apply it AFTER the parry check: a parried blow does nothing at all.
 */
export function eingehenderSchaden(schaden: number, armor: number, regler: StatRegler = REGLER): number {
  if (!(armor > 0)) return schaden;
  return Math.max(Math.min(1, schaden), (schaden * regler.K) / (regler.K + armor));
}

/**
 * Melee damage against creatures: `basis * (1 + strength * s)`, rounded to whole points (creature
 * health is an integer). Without strength the base damage is returned unchanged. NOT for harvesting.
 */
export function ausgehenderNahkampfSchaden(basis: number, strength: number, regler: StatRegler = REGLER): number {
  if (!(strength > 0)) return basis;
  return Math.round(basis * (1 + strength * regler.s));
}

/** Maximum health: `100 + food + vitality * v`. */
export function lebensmaximum(vitality: number, essensBonus: number, regler: StatRegler = REGLER): number {
  return LEBEN_BASIS + essensBonus + (vitality > 0 ? vitality * regler.v : 0);
}

/** Stamina cost of one swing: `8 * (1 - agility * a)`, never below the lower bound. */
export function schlagKosten(agility: number, regler: StatRegler = REGLER): number {
  if (!(agility > 0)) return SCHLAG_AUSDAUER_BASIS;
  const boden = SCHLAG_AUSDAUER_BASIS * regler.schlagkostenUntergrenze;
  return Math.max(boden, SCHLAG_AUSDAUER_BASIS * (1 - agility * regler.a));
}
