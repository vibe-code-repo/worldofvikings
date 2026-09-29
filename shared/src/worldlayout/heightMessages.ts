import de from '../../data/worldlayout/de.json';
import en from '../../data/worldlayout/en.json';

/** World-layout diagnostics only: no DOM, filesystem or application-wide i18n state. */
export function heightResponseMessage(data: Record<string, unknown>, locale = 'de'): string | null {
  const catalog: Record<keyof typeof de, string> = locale === 'en' ? en : de;
  const problem = data.heightProblem && typeof data.heightProblem === 'object'
    ? data.heightProblem as Record<string, unknown> : null;
  const heights = Array.isArray(data.fehlerhaftHoehe) ? data.fehlerhaftHoehe :
    problem && Array.isArray(problem.fehlerhaftHoehe) ? problem.fehlerhaftHoehe : [];
  const placements = Array.isArray(data.fehlerhaft) ? data.fehlerhaft : [];
  if (!problem && heights.length === 0) return null;
  const render = (key: keyof typeof de, vars: Record<string, unknown> = {}): string =>
    catalog[key].replace(/\{([^}]+)\}/g, (token, name: string) => Object.hasOwn(vars, name) ? String(vars[name]) : token);
  const list = (entries: unknown[], id: string): string => entries.slice(0, 40).map(entry => {
    if (!entry || typeof entry !== 'object') return JSON.stringify(entry);
    const e = entry as Record<string, unknown>;
    return `${String(e[id] ?? '?')} ${String(e.feld ?? '?')}=${JSON.stringify(e.wert)}`;
  }).join(', ');
  const parts: string[] = [];
  if (problem) {
    const key = problem.reason === 'inspection-limit' ? 'height.inspection-limit' : problem.reason === 'limit' ? 'height.limit' : 'height.invalid';
    parts.push(render(key, {
      errors: data.anzahlFehlerhaftHoehe ?? heights.length,
      zones: problem.zonen, points: problem.punkte,
      zoneLimit: problem.zoneLimit, pointLimit: problem.pointLimit,
      rawZones: problem.rawZones, inspectionLimit: problem.inspectionLimit,
    }));
  }
  if (heights.length) parts.push(render('height.errors', { errors: data.anzahlFehlerhaftHoehe ?? heights.length, list: list(heights, 'zone') }));
  if (placements.length) parts.push(render('height.placements', { errors: data.anzahlFehlerhaft ?? placements.length, list: list(placements, 'id') }));
  parts.push(render('height.repair'));
  return parts.join(' ');
}
