import { CharakterVorschau } from '../src/ui/CharakterVorschau';
import { IRONWARD_PARTS } from '@wov/shared';
const preview = new CharakterVorschau(document.querySelector('canvas')!);
const selected = new Set<string>();
const status = document.querySelector('#status')!;
const buttons = new Map<string, HTMLButtonElement>();
let revision = 0;
async function update() {
  const current = ++revision;
  for (const [id, button] of buttons) button.setAttribute('aria-pressed', String(selected.has(id)));
  status.textContent = 'Lädt …';
  try {
    await Promise.all(IRONWARD_PARTS.map(p => preview.setze(p.slot, selected.has(p.id) ? `ironward/${p.item}` : null)));
    if (current !== revision) return;
    status.textContent = `${selected.size} von 7 Teilen angelegt`;
    document.querySelector('#report')!.textContent = JSON.stringify(preview.bericht(), null, 2);
  } catch (error) { status.textContent = `FEHLER: ${error}`; }
}
await preview.ladeKoerper('wikinger/WikingerKoerper.glb');
for (const p of IRONWARD_PARTS) {
  const button = document.createElement('button');
  const icon = document.createElement('img'); icon.src = `/assets/sprites/${p.id}.png`; icon.alt = '';
  button.append(icon, p.name); button.onclick = () => { selected.has(p.id) ? selected.delete(p.id) : selected.add(p.id); void update(); };
  buttons.set(p.id, button); document.querySelector('#controls')!.insertBefore(button, status);
}
document.querySelector<HTMLButtonElement>('#all')!.onclick = () => { IRONWARD_PARTS.forEach(p => selected.add(p.id)); void update(); };
document.querySelector<HTMLButtonElement>('#none')!.onclick = () => { selected.clear(); void update(); };
await update();
