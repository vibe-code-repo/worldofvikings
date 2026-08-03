/**
 * Shared look for the DOM overlays (settings, hotbar, inventory).
 *
 * Extracted from SettingsPanel so the new panels do not re-invent the palette.
 * As noted there: this approximates Valheim's dark-leather/bronze UI with CSS
 * only — the extracted Sprite assets are keyed by opaque PathIDs with no
 * recovered name mapping, so the real panel textures are not usable yet.
 */

export const UI = {
  /** Headings, highlights. */
  gold: '#f2c86a',
  /** Body text. */
  text: '#e8d9b8',
  /** Secondary/labels. */
  muted: '#a8916a',
  /** Panel border. */
  border: '#8a6a34',
  /** Inner/slot border. */
  borderDim: '#5a4726',
  /** Panel background gradient. */
  panelBg: 'linear-gradient(180deg,#3a2f22,#241c14)',
  /** Slot background. */
  slotBg: 'rgba(20,15,9,.72)',
  /** Backdrop behind modal panels. */
  backdrop: 'rgba(10,8,4,.55)',
  font: 'Georgia,"Times New Roman",serif',
} as const;

/** Standard panel chrome (border, background, shadow, padding). */
export function panelStyle(width: string): string {
  return [
    `width:${width}`,
    `background:${UI.panelBg}`,
    `border:2px solid ${UI.border}`,
    'border-radius:6px',
    'box-shadow:0 12px 40px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,220,150,.08)',
    'padding:20px 24px 16px',
    `color:${UI.text}`,
  ].join(';');
}

/** Full-screen modal backdrop, hidden by default. */
export function overlayStyle(): string {
  return [
    'position:fixed', 'inset:0', 'z-index:1000',
    'display:none', 'align-items:center', 'justify-content:center',
    `background:${UI.backdrop}`, `font-family:${UI.font}`,
  ].join(';');
}

/** One inventory/hotbar cell. `active` draws the selected-slot highlight. */
export function slotStyle(size: number, active: boolean): string {
  return [
    `width:${size}px`, `height:${size}px`,
    'position:relative',
    'box-sizing:border-box',
    `background:${UI.slotBg}`,
    `border:2px solid ${active ? UI.gold : UI.borderDim}`,
    'border-radius:4px',
    active ? 'box-shadow:0 0 8px rgba(242,200,106,.45)' : '',
    'display:flex', 'align-items:center', 'justify-content:center',
    'user-select:none',
  ].filter(Boolean).join(';');
}

/** Panel title line. */
export function titleStyle(): string {
  return `font-size:22px;letter-spacing:.06em;color:${UI.gold};text-align:center;margin-bottom:12px;text-shadow:0 1px 2px #000`;
}
