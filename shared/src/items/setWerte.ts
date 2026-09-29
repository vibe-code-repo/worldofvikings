/**
 * Attribute values of the armor sets, in ONE table (not in the set files, which belong to the
 * armor pipeline). Attributwerte der Rüstungssets in EINER Tabelle.
 *
 * Key: `<family>` + `<part key>`, the same scheme as the translation keys (`crowshade` + `hood`).
 * Male and female parts of a family share ONE row: `crowshade_male_hood` and `crowshade_female_hood`
 * both read `crowshade.hood`, so the two can never drift apart. Ironward, Wildwarden and Ashenveil
 * have no gender variants; there the key is the appearance `id` (`ironward_helm`).
 *
 * PROPOSED numbers (to be confirmed by the game designer), all in one place:
 *  - Armor: a full class set adds up to 40 = `REGLER.K`, so it halves incoming creature damage.
 *    Split by slot: chest 11, legs 8, head 6, shoulders 5, boots 4, gloves 3, bracers 3.
 *    Plainhide (starter set, five pieces) adds up to 8 and carries no primary attributes.
 *  - Primary attributes per full class set: 10 on the family's main attribute, 5 on a secondary one.
 *    Split by slot: main chest 3, legs 2, head 2, shoulders 1, boots 1, gloves 1; secondary
 *    chest/legs/head/shoulders/boots 1 each.
 *
 * Reading the set files is all this module does with them; it changes none of them.
 */
import type { ItemStats } from './stats.js';
import { IRONWARD_PARTS } from '../ironward.js';
import { WILDWARDEN_PARTS } from '../wildwarden.js';
import { ASHENVEIL_PARTS } from '../ashenveil.js';
import { SEIDRAVEN_PARTS } from '../seidraven.js';
import { EMBERRAGE_PARTS } from '../emberrage.js';
import { PLAINHIDE_PARTS } from '../plainhide.js';
import { GRAVETHORN_PARTS } from '../gravethorn.js';
import { CROWSHADE_PARTS } from '../crowshade.js';

export const SET_WERTE: Readonly<Record<string, Readonly<Record<string, Readonly<ItemStats>>>>> = {
  ironward: {
    ironward_helm: { armor: 6, strength: 2, vitality: 1 },
    ironward_brust: { armor: 11, strength: 3, vitality: 1 },
    ironward_hose: { armor: 8, strength: 2, vitality: 1 },
    ironward_schultern: { armor: 5, strength: 1, vitality: 1 },
    ironward_arme: { armor: 3 },
    ironward_handschuhe: { armor: 3, strength: 1 },
    ironward_stiefel: { armor: 4, strength: 1, vitality: 1 },
  },
  wildwarden: {
    wildwarden_crown: { armor: 6, vitality: 2, agility: 1 },
    wildwarden_vest: { armor: 11, vitality: 3, agility: 1 },
    wildwarden_robe: { armor: 8, vitality: 2, agility: 1 },
    wildwarden_mantle: { armor: 5, vitality: 1, agility: 1 },
    wildwarden_bracers: { armor: 3 },
    wildwarden_gloves: { armor: 3, vitality: 1 },
    wildwarden_boots: { armor: 4, vitality: 1, agility: 1 },
  },
  ashenveil: {
    ashenveil_hood: { armor: 6, vitality: 2, strength: 1 },
    ashenveil_vest: { armor: 11, vitality: 3, strength: 1 },
    ashenveil_robe: { armor: 8, vitality: 2, strength: 1 },
    ashenveil_shoulders: { armor: 5, vitality: 1, strength: 1 },
    ashenveil_bracers: { armor: 3 },
    ashenveil_gloves: { armor: 3, vitality: 1 },
    ashenveil_boots: { armor: 4, vitality: 1, strength: 1 },
  },
  seidraven: {
    hood: { armor: 6, vitality: 2, agility: 1 },
    vest: { armor: 11, vitality: 3, agility: 1 },
    robe: { armor: 8, vitality: 2, agility: 1 },
    shoulders: { armor: 5, vitality: 1, agility: 1 },
    bracers: { armor: 3 },
    gloves: { armor: 3, vitality: 1 },
    boots: { armor: 4, vitality: 1, agility: 1 },
  },
  emberrage: {
    hood: { armor: 6, vitality: 2, strength: 1 },
    vest: { armor: 11, vitality: 3, strength: 1 },
    robe: { armor: 8, vitality: 2, strength: 1 },
    shoulders: { armor: 5, vitality: 1, strength: 1 },
    bracers: { armor: 3 },
    gloves: { armor: 3, vitality: 1 },
    boots: { armor: 4, vitality: 1, strength: 1 },
  },
  gravethorn: {
    hood: { armor: 6, strength: 2, agility: 1 },
    vest: { armor: 11, strength: 3, agility: 1 },
    robe: { armor: 8, strength: 2, agility: 1 },
    shoulders: { armor: 5, strength: 1, agility: 1 },
    bracers: { armor: 3 },
    gloves: { armor: 3, strength: 1 },
    boots: { armor: 4, strength: 1, agility: 1 },
  },
  crowshade: {
    hood: { armor: 6, agility: 2, strength: 1 },
    vest: { armor: 11, agility: 3, strength: 1 },
    robe: { armor: 8, agility: 2, strength: 1 },
    shoulders: { armor: 5, agility: 1, strength: 1 },
    bracers: { armor: 3 },
    gloves: { armor: 3, agility: 1 },
    boots: { armor: 4, agility: 1, strength: 1 },
  },
  plainhide: {
    shoulders: { armor: 1 },
    vest: { armor: 3 },
    bracers: { armor: 1 },
    robe: { armor: 2 },
    boots: { armor: 1 },
  },
};

/** One equippable set part with the address of its row in `SET_WERTE`. */
export interface SetTeil {
  readonly familie: string;
  readonly key: string;
  /** Appearance id (`ruestungsteil`), what `peer.ruestung` holds. */
  readonly id: string;
  /** Item name. */
  readonly item: string;
}

const GESCHLECHT = /^(.+)_(?:male|female)_(.+)$/;

function adresse(id: string, item: string): SetTeil {
  const g = GESCHLECHT.exec(id);
  if (g) return { familie: g[1]!, key: g[2]!, id, item };
  return { familie: id.slice(0, id.indexOf('_')), key: id, id, item };
}

/** Every equippable part of every set, male and female. */
export const SET_TEILE: readonly SetTeil[] = [
  ...IRONWARD_PARTS, ...WILDWARDEN_PARTS, ...ASHENVEIL_PARTS, ...SEIDRAVEN_PARTS,
  ...EMBERRAGE_PARTS, ...PLAINHIDE_PARTS, ...GRAVETHORN_PARTS, ...CROWSHADE_PARTS,
].map((p) => adresse(p.id, p.item));

const WERTE_JE_ID: ReadonlyMap<string, Readonly<ItemStats>> = new Map(
  SET_TEILE.flatMap((t) => {
    const stats = SET_WERTE[t.familie]?.[t.key];
    return stats ? [[t.id, stats] as const] : [];
  })
);

/** Attribute values of a worn armor part by its appearance id; undefined for parts without values. */
export function werteFuerRuestungsteil(id: string): Readonly<ItemStats> | undefined {
  return WERTE_JE_ID.get(id);
}
