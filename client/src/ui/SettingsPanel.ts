/**
 * SettingsPanel — DOM options overlay for the two render-quality settings
 * in Settings.ts, using the same labels/levels as real Valheim's graphics
 * menu (Valheim.SettingsGui.GraphicsSettings, localization strings from
 * /root/Valheim_Client/extracted_assets/TextAsset — see field comments).
 *
 * This is a plain styled DOM overlay, not a pixel-accurate reproduction of
 * Valheim's actual UI sprites: the extracted Sprite assets are keyed by
 * opaque PathID hashes with no name mapping recovered, so lifting the real
 * panel/button textures would need substantial additional reverse-
 * engineering. The styling below (dark leather panel, bronze border, serif
 * type) approximates the game's look with CSS only; swap in real texture
 * assets later if a name mapping turns up.
 *
 * Toggle: Escape key (also releases pointer lock so the mouse is usable).
 */
import type { SettingsStore } from './Settings';

const LEVELS = ['Niedrig', 'Mittel', 'Hoch', 'Sehr hoch']; // settings_low/medium/high/veryhigh (German)

export class SettingsPanel {
  private readonly root: HTMLDivElement;
  private visible = false;

  constructor(private readonly settings: SettingsStore) {
    const root = document.createElement('div');
    root.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:1000',
      'display:none', 'align-items:center', 'justify-content:center',
      'background:rgba(10,8,4,.55)', 'font-family:Georgia,"Times New Roman",serif',
    ].join(';');
    root.addEventListener('click', (e) => {
      if (e.target === root) this.hide();
    });

    const panel = document.createElement('div');
    panel.style.cssText = [
      'width:min(420px,90vw)',
      'background:linear-gradient(180deg,#3a2f22,#241c14)',
      'border:2px solid #8a6a34', 'border-radius:6px',
      'box-shadow:0 12px 40px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,220,150,.08)',
      'padding:20px 24px 16px', 'color:#e8d9b8',
    ].join(';');
    root.appendChild(panel);

    const title = document.createElement('div');
    title.textContent = 'Einstellungen'; // menu_settings
    title.style.cssText = 'font-size:22px;letter-spacing:.06em;color:#f2c86a;text-align:center;margin-bottom:4px;text-shadow:0 1px 2px #000';
    panel.appendChild(title);

    const section = document.createElement('div');
    section.textContent = 'Grafikeinstellungen'; // settings_graphics
    section.style.cssText = 'font-size:13px;letter-spacing:.08em;color:#a8916a;text-align:center;margin-bottom:16px;text-transform:uppercase';
    panel.appendChild(section);

    panel.appendChild(
      this.buildRow(
        'Renderauflösung',
        (s) => s.renderScale,
        (v) => this.settings.set({ renderScale: v }),
        ['50 %', '75 %', '85 %', '100 %']
      )
    );
    panel.appendChild(
      this.buildRow(
        'Schattenqualität', // settings_shadowquality
        (s) => s.shadowQuality,
        (v) => this.settings.set({ shadowQuality: v }),
        ['Aus', 'Niedrig', 'Mittel', 'Hoch']
      )
    );
    panel.appendChild(
      this.buildToggle('Ferne Schatten', (s) => s.distantShadows, (v) =>
        this.settings.set({ distantShadows: v })
      )
    );
    // Kein Original-Setting: die Brechung ist im Spiel Teil des
    // Wassershaders, bei uns ein eigener Szenenpass — siehe Settings.ts.
    panel.appendChild(
      this.buildRow(
        'Wasserqualität',
        (s) => s.waterQuality,
        (v) => this.settings.set({ waterQuality: v }),
        ['Aus', 'Niedrig', 'Mittel', 'Hoch']
      )
    );
    panel.appendChild(
      this.buildRow(
        'Grasdichte',
        (s) => s.grassDensity,
        (v) => this.settings.set({ grassDensity: v }),
        ['Aus', 'Wenig', 'Mittel', 'Voll']
      )
    );
    panel.appendChild(
      this.buildRow(
        'Vegetationsqualität', // settings_vegetation
        (s) => s.vegetationQuality,
        (v) => this.settings.set({ vegetationQuality: v })
      )
    );
    panel.appendChild(
      this.buildRow(
        'Detailgrad', // settings_lod
        (s) => s.detailQuality,
        (v) => this.settings.set({ detailQuality: v })
      )
    );

    // Post-Process-Schalter — dieselben Optionen wie im Original
    // (GraphicsSettingBool), Werte siehe engine/PostProcessing.ts.
    panel.appendChild(this.buildToggle('Bloom', (s) => s.bloom, (v) => this.settings.set({ bloom: v })));
    panel.appendChild(
      this.buildToggle('Bewegungsunschärfe', (s) => s.motionBlur, (v) => this.settings.set({ motionBlur: v }))
    );
    panel.appendChild(
      this.buildToggle(
        'Chromatische Aberration',
        (s) => s.chromaticAberration,
        (v) => this.settings.set({ chromaticAberration: v })
      )
    );
    panel.appendChild(
      this.buildToggle('Tiefenunschärfe', (s) => s.depthOfField, (v) => this.settings.set({ depthOfField: v }))
    );
    panel.appendChild(
      this.buildToggle('Sonnenstrahlen', (s) => s.sunShafts, (v) => this.settings.set({ sunShafts: v }))
    );
    panel.appendChild(
      this.buildToggle('Umgebungsverdeckung', (s) => s.ambientOcclusion, (v) =>
        this.settings.set({ ambientOcclusion: v })
      )
    );
    panel.appendChild(
      this.buildToggle('Kantenglättung', (s) => s.antiAliasing, (v) => this.settings.set({ antiAliasing: v }))
    );
    // Steuerung: kein Original-Setting, siehe GameSettings.pointerLock.
    panel.appendChild(
      this.buildToggle('Maus fangen (Pointer-Lock)', (s) => s.pointerLock, (v) =>
        this.settings.set({ pointerLock: v })
      )
    );

    // Namensschilder über Figuren — Spielelement, s. GameSettings.nameplates.
    panel.appendChild(
      this.buildToggle('Namensschilder', (s) => s.nameplates, (v) =>
        this.settings.set({ nameplates: v })
      )
    );
    panel.appendChild(
      this.buildToggle('Eigenes Namensschild', (s) => s.eigenesNameplate, (v) =>
        this.settings.set({ eigenesNameplate: v })
      )
    );

    // Diagnose: Prefab-Namen über den Objekten einblenden.
    panel.appendChild(
      this.buildToggle('Objektnamen anzeigen', (s) => s.showObjectNames, (v) =>
        this.settings.set({ showObjectNames: v })
      )
    );

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Zurück'; // menu_back
    closeBtn.style.cssText = [
      'display:block', 'margin:16px auto 0', 'padding:8px 28px',
      'background:linear-gradient(180deg,#5a4726,#3a2d16)', 'color:#f2c86a',
      'border:1px solid #8a6a34', 'border-radius:4px', 'font:inherit', 'font-size:14px',
      'letter-spacing:.05em', 'cursor:pointer',
    ].join(';');
    closeBtn.addEventListener('mouseenter', () => (closeBtn.style.background = 'linear-gradient(180deg,#6d5a34,#463620)'));
    closeBtn.addEventListener('mouseleave', () => (closeBtn.style.background = 'linear-gradient(180deg,#5a4726,#3a2d16)'));
    closeBtn.addEventListener('click', () => this.hide());
    panel.appendChild(closeBtn);

    document.body.appendChild(root);
    this.root = root;

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      e.preventDefault();
      this.toggle();
    });
  }

  private buildRow(
    label: string,
    get: (s: ReturnType<SettingsStore['get']>) => number,
    set: (v: number) => void,
    /** Eigene Stufenbeschriftungen; ohne das die vier Qualitätsstufen. */
    stufen: readonly string[] = LEVELS
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:14px';

    const lbl = document.createElement('div');
    lbl.textContent = label;
    lbl.style.cssText = 'font-size:14px;margin-bottom:6px;color:#e8d9b8';
    row.appendChild(lbl);

    const seg = document.createElement('div');
    seg.style.cssText = 'display:flex;gap:4px';
    row.appendChild(seg);

    const buttons: HTMLButtonElement[] = [];
    const paint = (active: number) => {
      buttons.forEach((b, i) => {
        b.style.background = i === active ? 'linear-gradient(180deg,#7a5f2e,#4a3a1c)' : 'linear-gradient(180deg,#332818,#241b10)';
        b.style.color = i === active ? '#ffe9b0' : '#a8916a';
        b.style.borderColor = i === active ? '#f2c86a' : '#5a4726';
      });
    };

    stufen.forEach((levelLabel, i) => {
      const b = document.createElement('button');
      b.textContent = levelLabel;
      b.style.cssText = [
        'flex:1', 'padding:6px 0', 'font:inherit', 'font-size:12px',
        'border:1px solid #5a4726', 'border-radius:3px', 'cursor:pointer',
      ].join(';');
      b.addEventListener('click', () => {
        set(i);
        paint(i);
      });
      buttons.push(b);
      seg.appendChild(b);
    });

    this.settings.onChange((s) => paint(get(s)));
    return row;
  }

  /** An/Aus-Zeile (settings_on/settings_off) für die Post-Process-Optionen. */
  private buildToggle(
    label: string,
    get: (s: ReturnType<SettingsStore['get']>) => boolean,
    set: (v: boolean) => void
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:12px';

    const lbl = document.createElement('div');
    lbl.textContent = label;
    lbl.style.cssText = 'font-size:14px;color:#e8d9b8';
    row.appendChild(lbl);

    const btn = document.createElement('button');
    btn.style.cssText = [
      'min-width:74px', 'padding:5px 0', 'font:inherit', 'font-size:12px',
      'border:1px solid #5a4726', 'border-radius:3px', 'cursor:pointer',
    ].join(';');
    const paint = (on: boolean) => {
      btn.textContent = on ? 'An' : 'Aus';
      btn.style.background = on ? 'linear-gradient(180deg,#7a5f2e,#4a3a1c)' : 'linear-gradient(180deg,#332818,#241b10)';
      btn.style.color = on ? '#ffe9b0' : '#a8916a';
      btn.style.borderColor = on ? '#f2c86a' : '#5a4726';
    };
    btn.addEventListener('click', () => set(!get(this.settings.get())));
    row.appendChild(btn);

    this.settings.onChange((s) => paint(get(s)));
    return row;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.root.style.display = 'flex';
    // Lock release goes through the InputManager (main.ts reports open menus) —
    // dropping it directly reads as a browser-forced unlock and starts Gecko's
    // cooldown, which then blocks taking it back.
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }
}
