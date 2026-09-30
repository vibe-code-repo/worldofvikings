/**
 * Move proof: the output as text.
 *
 * Everything that influenced the proof stands in the output: the version of the tool, the two
 * states with their full hashes, the whole manifest, every release with its reason, the settings,
 * and what exit 0 does not prove. The text is meant to be pasted into the pull request.
 */
import { REGELN, REGEL_TITEL, ortText, type Befund, type Ergebnis } from './typen';

function zeileVon(b: Befund): string {
  return `  [${b.regel} ${b.teil}] ${ortText(b.ort)}\n      ${b.text}${b.freigabe ? `\n      can be released with the key "${b.freigabe}" and a reason` : ''}`;
}

export function alsText(e: Ergebnis): string {
  const z: string[] = [];
  z.push(`MOVE PROOF  ${e.werkzeug}`);
  z.push(`old state:  ${e.staende.alt}`);
  z.push(`new state:  ${e.staende.neu}`);
  z.push('');
  z.push('Manifest:');
  z.push(...JSON.stringify(e.manifest, null, 2).split('\n').map((l) => `  ${l}`));
  z.push('');
  z.push('Rules (checked places, open findings, released findings):');
  for (const r of REGELN) {
    const offen = e.befunde.filter((b) => b.regel === r).length;
    const frei = e.freigegeben.filter((f) => f.befund.regel === r).length;
    z.push(`  ${r.padEnd(4)} ${String(e.zaehler[r]).padStart(7)} ${String(offen).padStart(4)} ${String(frei).padStart(4)}   ${REGEL_TITEL[r]}${e.zaehler[r] === 0 ? '   [0 places checked: this rule did not apply to this step]' : ''}`);
  }
  if (e.gelockert.length > 0) {
    z.push('');
    z.push(`Members of the class that lost their visibility (${e.gelockert.length}):`);
    for (const g of e.gelockert) z.push(`  ${g}`);
  }
  if (e.reihenfolge.length > 0) {
    z.push('');
    z.push('Order of evaluation (rule B10):');
    for (const r of e.reihenfolge) {
      z.push(`  from ${r.einstieg}: ${r.moduleAlt} modules in the old state, ${r.moduleNeu} in the new one; order of the modules that existed before: ${r.gleich ? 'the same' : 'DIFFERENT'}`);
      for (const n of r.neueModule) z.push(`    new module at place ${n.platz}: ${n.modul} (after ${n.davor ?? '(start)'}, before ${n.danach ?? '(end)'})`);
    }
  }
  if (e.fremdGeaendert.length > 0) {
    z.push('');
    z.push(`Files outside the step that differ between the two states and are touched by a binding or by the order (${e.fremdGeaendert.length}):`);
    for (const f of e.fremdGeaendert) z.push(`  ${f}`);
    z.push('  Declarations in these files are compared by name, not by place. The proof says nothing about their content.');
  }
  if (e.hinweise.length > 0) {
    z.push('');
    z.push('Notes:');
    for (const h of e.hinweise) z.push(`  [${h.regel}] ${h.text}`);
  }
  z.push('');
  z.push(`Releases used (${e.freigegeben.length}):`);
  if (e.freigegeben.length === 0) z.push('  none');
  for (const f of e.freigegeben) {
    z.push(`  RELEASED "${f.freigabe.schluessel}"`);
    z.push(`      reason: ${f.freigabe.begruendung}`);
    z.push(`      finding: [${f.befund.regel} ${f.befund.teil}] ${ortText(f.befund.ort)}: ${f.befund.text}`);
  }
  z.push('');
  z.push(`Findings (${e.befunde.length}):`);
  if (e.befunde.length === 0) z.push('  none');
  for (const b of e.befunde) z.push(zeileVon(b));
  z.push('');
  z.push('What exit 0 does not prove:');
  for (const g of e.grenzen) z.push(`  - ${g}`);
  z.push('');
  z.push(e.exit === 0 ? `PROOF GIVEN: moved, nothing else changed${e.freigegeben.length > 0 ? ` (with ${e.freigegeben.length} release(s), see above)` : ''}. Exit 0.` : `NO PROOF: ${e.befunde.length} finding(s). Exit 1.`);
  return `${z.join('\n')}\n`;
}

export function alsJson(e: Ergebnis): string {
  return `${JSON.stringify(e, null, 2)}\n`;
}
