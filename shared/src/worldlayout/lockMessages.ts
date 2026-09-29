import de from '../../data/worldlayout/de.json';
import en from '../../data/worldlayout/en.json';

/** Deletion-lock texts (Z3): catalog lookup only, no DOM, filesystem or application-wide i18n state. */
export type LockMessageKey = Extract<keyof typeof de, `lock.${string}` | `confirm.${string}`>;

export function lockMessage(key: LockMessageKey, vars: Record<string, unknown> = {}, locale = 'de'): string {
  const catalog: Record<keyof typeof de, string> = locale === 'en' ? en : de;
  return catalog[key].replace(/\{([^}]+)\}/g, (token, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : token));
}

/** The count of locked objects in a response's `loeschsperre` field (0: none, or no such field). */
export function lockCount(data: Record<string, unknown>): number {
  const sperre = data.loeschsperre;
  if (!sperre || typeof sperre !== 'object') return 0;
  const count = Number((sperre as Record<string, unknown>).anzahl);
  return Number.isFinite(count) && count > 0 ? count : 0;
}
