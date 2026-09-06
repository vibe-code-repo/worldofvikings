/**
 * How a node name inside a scene bundle is matched to a store model.
 *
 * The scene bundles name their nodes the way the authoring tool did, and that
 * is not the name the model file carries. Four things happen to a name on its
 * way into a scene:
 *
 * | In the scene           | In the model export | What happened            |
 * | ---------------------- | ------------------- | ------------------------ |
 * | `Tree_1A3 (2)`         | `Tree_1A3`          | duplicate, parenthesised |
 * | `SM_Prop_Barrel_01 3`  | `SM_Prop_Barrel_01` | duplicate, trailing count |
 * | `Rock_02_LOD0`         | `Rock_02`           | level-of-detail suffix   |
 * | `Wall wooden SM_Env_…` | `SM_Env_…`          | a renamed instance       |
 *
 * So one name yields a short list of *candidates*, tried in order of how
 * literal they are: the name itself first, the most aggressive rewrite last.
 * The first candidate that names a model in the store wins, which keeps the
 * literal reading in front of the speculative one.
 *
 * The candidate order is the one measured against the export in the mapping
 * study; changing it changes which models get bound, so it has a test per row
 * of the table above.
 */
import { toKebab } from './selection.js';

/** `Foo (3)` — a duplicate the authoring tool numbered in parentheses. */
const DUPLICATE_PARENTHESISED = /\s*\(\d+\)\s*$/;

/** `Foo 3` — a duplicate the authoring tool numbered with a trailing count. */
const DUPLICATE_TRAILING = /\s+\d+$/;

/** `Foo_LOD0`, `Foo lod 2` — a level-of-detail suffix. */
const LEVEL_OF_DETAIL = /[_ ]?lod[_ ]?\d+$/i;

/** The naming prefix every hand-modelled object in this export carries. */
const MODEL_PREFIX = /(SM_[A-Za-z0-9_]+)/;

/**
 * Every store id one scene node name could plausibly mean, most literal first.
 *
 * Kebab-cased, because that is the form the store uses: the candidates are
 * compared against file stems, not against the original names.
 */
export function sceneNameCandidates(name: string): string[] {
  const candidates: string[] = [];
  const add = (value: string): void => {
    const key = toKebab(value);
    if (key !== '' && !candidates.includes(key)) {
      candidates.push(key);
    }
  };

  add(name);
  const withoutParentheses = name.replace(DUPLICATE_PARENTHESISED, '');
  add(withoutParentheses);
  const withoutCount = withoutParentheses.replace(DUPLICATE_TRAILING, '');
  add(withoutCount);

  for (const value of [name, withoutParentheses, withoutCount]) {
    add(value.replace(LEVEL_OF_DETAIL, ''));
  }
  for (const value of [withoutCount, withoutParentheses]) {
    const embedded = MODEL_PREFIX.exec(value)?.[1];
    if (embedded !== undefined) {
      add(embedded);
      add(embedded.replace(DUPLICATE_TRAILING, ''));
    }
  }
  return candidates;
}

/**
 * The store model one scene node stands for, or `undefined` when the node is
 * something the store does not hold — a light, a spawn point, a character.
 */
export function matchStoreId(name: string, storeIds: ReadonlySet<string>): string | undefined {
  for (const candidate of sceneNameCandidates(name)) {
    if (storeIds.has(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
