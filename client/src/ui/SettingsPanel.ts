/**
 * Localized settings overlay with one general and two graphics tabs.
 *
 * The panel is rendered from translation ids instead of keeping translated
 * strings in its DOM. A runtime language change therefore rebuilds only this
 * small overlay while the world, renderer and all setting values stay alive.
 */
import {
  GAME_LOCALES,
  type GameI18n,
  type GameLocale,
  type TranslationKey,
} from '../i18n';
import type { SettingsStore } from './Settings';

type TabId = 'general' | 'graphics' | 'effects';

const TAB_LABELS: Record<TabId, TranslationKey> = {
  general: 'settings.tab.general',
  graphics: 'settings.tab.graphics',
  effects: 'settings.tab.effects',
};

const QUALITY_LEVELS: TranslationKey[] = [
  'quality.low',
  'quality.medium',
  'quality.high',
  'quality.very_high',
];

export class SettingsPanel {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly tabs: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private readonly closeButton: HTMLButtonElement;
  private visible = false;
  private activeTab: TabId = 'general';
  private readonly subscriptions: Array<() => void> = [];
  private settingSubscriptions: Array<() => void> = [];

  constructor(
    private readonly settings: SettingsStore,
    private readonly i18n: GameI18n,
  ) {
    const root = document.createElement('div');
    root.dataset.ui = 'settings';
    root.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:1000',
      'display:none', 'align-items:center', 'justify-content:center',
      'background:rgba(10,8,4,.55)', 'font-family:Georgia,"Times New Roman",serif',
    ].join(';');
    root.addEventListener('click', (event) => {
      if (event.target === root) this.hide();
    });

    const panel = document.createElement('div');
    panel.style.cssText = [
      'width:min(640px,92vw)', 'height:min(690px,90vh)',
      'display:grid', 'grid-template-rows:auto auto minmax(0,1fr) auto',
      'background:linear-gradient(180deg,#3a2f22,#241c14)',
      'border:2px solid #8a6a34', 'border-radius:6px',
      'box-shadow:0 12px 40px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,220,150,.08)',
      'padding:20px 24px 16px', 'color:#e8d9b8', 'box-sizing:border-box',
    ].join(';');
    root.appendChild(panel);

    this.title = document.createElement('div');
    this.title.style.cssText =
      'font-size:22px;letter-spacing:.06em;color:#f2c86a;text-align:center;' +
      'margin-bottom:14px;text-shadow:0 1px 2px #000';
    panel.appendChild(this.title);

    this.tabs = document.createElement('div');
    this.tabs.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px';
    panel.appendChild(this.tabs);

    this.content = document.createElement('div');
    this.content.style.cssText =
      'overflow-y:auto;overflow-x:hidden;padding:0 8px 8px 2px;scrollbar-color:#8a6a34 #241c14';
    panel.appendChild(this.content);

    this.closeButton = document.createElement('button');
    this.closeButton.style.cssText = [
      'display:block', 'margin:14px auto 0', 'padding:8px 28px',
      'background:linear-gradient(180deg,#5a4726,#3a2d16)', 'color:#f2c86a',
      'border:1px solid #8a6a34', 'border-radius:4px', 'font:inherit',
      'font-size:14px', 'letter-spacing:.05em', 'cursor:pointer',
    ].join(';');
    this.closeButton.addEventListener('click', () => this.hide());
    panel.appendChild(this.closeButton);

    document.body.appendChild(root);
    this.root = root;
    this.subscriptions.push(this.i18n.onChange(() => this.render()));

    window.addEventListener('keydown', this.onEscape);
  }

  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.code !== 'Escape') return;
    event.preventDefault();
    this.toggle();
  };

  private render(): void {
    for (const unsubscribe of this.settingSubscriptions) unsubscribe();
    this.settingSubscriptions = [];

    this.title.textContent = this.i18n.t('settings.title');
    this.closeButton.textContent = this.i18n.t('common.back');
    this.renderTabs();
    this.content.replaceChildren();

    if (this.activeTab === 'general') this.renderGeneral();
    else if (this.activeTab === 'graphics') this.renderGraphics();
    else this.renderEffects();
  }

  private renderTabs(): void {
    this.tabs.replaceChildren();
    for (const tab of Object.keys(TAB_LABELS) as TabId[]) {
      const button = document.createElement('button');
      button.dataset.settingsTab = tab;
      button.textContent = this.i18n.t(TAB_LABELS[tab]);
      button.style.cssText = [
        'padding:9px 6px', 'font:inherit', 'font-size:13px', 'cursor:pointer',
        'border-radius:4px', 'border:1px solid',
        tab === this.activeTab
          ? 'background:linear-gradient(180deg,#7a5f2e,#4a3a1c);color:#ffe9b0;border-color:#f2c86a'
          : 'background:linear-gradient(180deg,#332818,#241b10);color:#a8916a;border-color:#5a4726',
      ].join(';');
      button.addEventListener('click', () => {
        this.activeTab = tab;
        this.render();
      });
      this.tabs.appendChild(button);
    }
  }

  private renderGeneral(): void {
    this.content.appendChild(this.buildSection('settings.section.language'));
    this.content.appendChild(this.buildLanguageRow());

    this.content.appendChild(this.buildSection('settings.section.controls'));
    this.content.appendChild(
      this.buildToggle('settings.pointer_lock', (s) => s.pointerLock, (value) =>
        this.settings.set({ pointerLock: value }))
    );

    this.content.appendChild(this.buildSection('settings.section.display'));
    this.content.appendChild(
      this.buildToggle('settings.nameplates', (s) => s.nameplates, (value) =>
        this.settings.set({ nameplates: value }))
    );
    this.content.appendChild(
      this.buildToggle('settings.own_nameplate', (s) => s.eigenesNameplate, (value) =>
        this.settings.set({ eigenesNameplate: value }))
    );
    this.content.appendChild(
      this.buildToggle('settings.object_names', (s) => s.showObjectNames, (value) =>
        this.settings.set({ showObjectNames: value }))
    );
    this.content.appendChild(
      this.buildToggle('settings.world_time', (s) => s.weltzeit, (value) =>
        this.settings.set({ weltzeit: value }))
    );
  }

  private renderGraphics(): void {
    this.content.appendChild(this.buildSection('settings.section.image'));
    this.content.appendChild(
      this.buildRow('settings.render_scale', (s) => s.renderScale,
        (value) => this.settings.set({ renderScale: value }), ['50 %', '75 %', '85 %', '100 %'])
    );
    this.content.appendChild(
      this.buildRow('settings.detail', (s) => s.detailQuality,
        (value) => this.settings.set({ detailQuality: value }))
    );
    this.content.appendChild(
      this.buildRow('settings.vegetation_quality', (s) => s.vegetationQuality,
        (value) => this.settings.set({ vegetationQuality: value }))
    );
    this.content.appendChild(
      this.buildRow('settings.vegetation_range', (s) => s.vegetationRange,
        (value) => this.settings.set({ vegetationRange: value }),
        ['160 m', '200 m', '240 m', this.i18n.t('common.unlimited')])
    );
    this.content.appendChild(
      this.buildRow('settings.grass_density', (s) => s.grassDensity,
        (value) => this.settings.set({ grassDensity: value }), [
          this.i18n.t('settings.grass.none'), this.i18n.t('settings.grass.low'),
          this.i18n.t('settings.grass.medium'), this.i18n.t('settings.grass.full'),
        ])
    );
    this.content.appendChild(
      this.buildRow('settings.shadow_quality', (s) => s.shadowQuality,
        (value) => this.settings.set({ shadowQuality: value }), [
          this.i18n.t('common.off'), this.i18n.t('quality.low'),
          this.i18n.t('quality.medium'), this.i18n.t('quality.high'),
        ])
    );
    this.content.appendChild(
      this.buildToggle('settings.distant_shadows', (s) => s.distantShadows,
        (value) => this.settings.set({ distantShadows: value }))
    );
    this.content.appendChild(
      this.buildRow('settings.water_quality', (s) => s.waterQuality,
        (value) => this.settings.set({ waterQuality: value }), [
          this.i18n.t('common.off'), this.i18n.t('quality.low'),
          this.i18n.t('quality.medium'), this.i18n.t('quality.high'),
        ])
    );
    this.content.appendChild(
      this.buildToggle('settings.anti_aliasing', (s) => s.antiAliasing,
        (value) => this.settings.set({ antiAliasing: value }))
    );
    this.content.appendChild(
      this.buildToggle('settings.performance_profile', (s) => s.hundertFpsProfil,
        (value) => this.settings.set({ hundertFpsProfil: value }))
    );
  }

  private renderEffects(): void {
    this.content.appendChild(this.buildSection('settings.section.effects'));
    for (const [key, get, set] of [
      ['settings.temporal_aa', (s) => s.temporalAA, (value) => this.settings.set({ temporalAA: value })],
      ['settings.bloom', (s) => s.bloom, (value) => this.settings.set({ bloom: value })],
      ['settings.motion_blur', (s) => s.motionBlur, (value) => this.settings.set({ motionBlur: value })],
      ['settings.chromatic_aberration', (s) => s.chromaticAberration, (value) => this.settings.set({ chromaticAberration: value })],
      ['settings.depth_of_field', (s) => s.depthOfField, (value) => this.settings.set({ depthOfField: value })],
      ['settings.sun_shafts', (s) => s.sunShafts, (value) => this.settings.set({ sunShafts: value })],
      ['settings.ambient_occlusion', (s) => s.ambientOcclusion, (value) => this.settings.set({ ambientOcclusion: value })],
    ] as Array<[
      TranslationKey,
      (settings: ReturnType<SettingsStore['get']>) => boolean,
      (value: boolean) => void,
    ]>) {
      this.content.appendChild(this.buildToggle(key, get, set));
    }
  }

  private buildSection(key: TranslationKey): HTMLDivElement {
    const element = document.createElement('div');
    element.textContent = this.i18n.t(key);
    element.style.cssText =
      'font-size:13px;letter-spacing:.08em;color:#a8916a;text-align:center;' +
      'margin:14px 0 10px;text-transform:uppercase;border-top:1px solid rgba(138,106,52,.35);padding-top:12px';
    return element;
  }

  private buildLanguageRow(): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:16px';
    const label = document.createElement('label');
    label.htmlFor = 'game-language';
    label.textContent = this.i18n.t('settings.language');
    label.style.cssText = 'font-size:14px;color:#e8d9b8';
    const select = document.createElement('select');
    select.id = 'game-language';
    select.style.cssText =
      'min-width:180px;padding:7px 10px;background:#241b10;color:#ffe9b0;' +
      'border:1px solid #8a6a34;border-radius:4px;font:inherit;font-size:13px';
    for (const locale of GAME_LOCALES) {
      const option = document.createElement('option');
      option.value = locale;
      option.textContent = this.i18n.languageName(locale);
      option.selected = locale === this.i18n.language;
      select.appendChild(option);
    }
    select.addEventListener('change', () => this.i18n.setLanguage(select.value as GameLocale));
    row.append(label, select);
    return row;
  }

  private buildRow(
    key: TranslationKey,
    get: (settings: ReturnType<SettingsStore['get']>) => number,
    set: (value: number) => void,
    labels: readonly string[] = QUALITY_LEVELS.map((level) => this.i18n.t(level)),
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:14px';
    const label = document.createElement('div');
    label.textContent = this.i18n.t(key);
    label.style.cssText = 'font-size:14px;margin-bottom:6px;color:#e8d9b8';
    row.appendChild(label);
    const segments = document.createElement('div');
    segments.style.cssText = 'display:flex;gap:4px';
    row.appendChild(segments);
    const buttons: HTMLButtonElement[] = [];
    const paint = (active: number) => buttons.forEach((button, index) => {
      button.style.background = index === active
        ? 'linear-gradient(180deg,#7a5f2e,#4a3a1c)'
        : 'linear-gradient(180deg,#332818,#241b10)';
      button.style.color = index === active ? '#ffe9b0' : '#a8916a';
      button.style.borderColor = index === active ? '#f2c86a' : '#5a4726';
    });
    labels.forEach((text, index) => {
      const button = document.createElement('button');
      button.textContent = text;
      button.style.cssText =
        'flex:1;padding:6px 2px;font:inherit;font-size:12px;border:1px solid #5a4726;' +
        'border-radius:3px;cursor:pointer;min-width:0';
      button.addEventListener('click', () => set(index));
      buttons.push(button);
      segments.appendChild(button);
    });
    this.settingSubscriptions.push(this.settings.onChange((state) => paint(get(state))));
    return row;
  }

  private buildToggle(
    key: TranslationKey,
    get: (settings: ReturnType<SettingsStore['get']>) => boolean,
    set: (value: boolean) => void,
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:12px';
    const label = document.createElement('div');
    label.textContent = this.i18n.t(key);
    label.style.cssText = 'font-size:14px;color:#e8d9b8';
    const button = document.createElement('button');
    button.style.cssText =
      'min-width:74px;padding:5px 0;font:inherit;font-size:12px;border:1px solid #5a4726;' +
      'border-radius:3px;cursor:pointer';
    const paint = (on: boolean) => {
      button.textContent = this.i18n.t(on ? 'common.on' : 'common.off');
      button.style.background = on
        ? 'linear-gradient(180deg,#7a5f2e,#4a3a1c)'
        : 'linear-gradient(180deg,#332818,#241b10)';
      button.style.color = on ? '#ffe9b0' : '#a8916a';
      button.style.borderColor = on ? '#f2c86a' : '#5a4726';
    };
    button.addEventListener('click', () => set(!get(this.settings.get())));
    row.append(label, button);
    this.settingSubscriptions.push(this.settings.onChange((state) => paint(get(state))));
    return row;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onEscape);
    for (const unsubscribe of [...this.settingSubscriptions, ...this.subscriptions]) unsubscribe();
    this.root.remove();
  }
}
