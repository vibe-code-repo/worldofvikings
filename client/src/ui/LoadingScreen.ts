/**
 * LoadingScreen — überbrückt die Aufbauphase nach dem Einloggen.
 *
 * Ohne diese Blende sieht man beim Betreten der Welt für einige Sekunden
 * einen halbfertigen Zustand: Geländestücke ploppen einzeln auf, das Gras
 * lädt noch, und die Wasserfläche liegt über noch ungebautem Gelände
 * (siehe `Terrain.initialReady` — das Wasser bleibt deshalb bis zur
 * Freigabe komplett ausgeblendet). Die Framerate steigt erst, wenn der
 * Nah-Ring steht.
 *
 * Die Blende bleibt sichtbar, bis `TerrainManager.ready` meldet, dass der
 * volle Nah-Ring gebaut und die Ufer-Nähe gebacken ist, und fadet dann
 * weich aus.
 *
 * Optik bewusst wie das Einstellungsmenü (dunkles Leder, Bronze) — reines
 * CSS, keine Assets: die UI-Sprites des Originals liegen nur unter
 * undurchsichtigen Hash-IDs ohne Namenszuordnung vor.
 */
import type { GameI18n } from '../i18n';

export class LoadingScreen {
  private readonly root: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly unsubscribe: () => void;
  private done = false;

  constructor(private readonly i18n: GameI18n) {
    const root = document.createElement('div');
    // Eine Kennung, damit man den Vorhang von aussen SEHEN kann.
    //
    // Der Ende-zu-Ende-Lauf des Dungeon-Generators 2.0 muss belegen, dass der
    // Ladebildschirm ueber einer Instanz faellt — in einer Instanz gibt es
    // kein `terrain.ready`, und genau daran hing er bis zum 31.08.2026. Ohne
    // Kennung bliebe nur, den Vorhang an seinem Text zu erkennen; der ist
    // uebersetzt, und die Messung haenge damit an der Sprache.
    // An id so the curtain can be SEEN from outside: the dungeon 2.0
    // end-to-end run must show that the loading screen drops over an
    // instance. Without an id one would have to recognise it by its text —
    // which is translated, tying the measurement to the language.
    root.id = 'loading-screen';
    root.lang = i18n.language;
    root.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:900',
      'display:flex', 'align-items:center', 'justify-content:center',
      'flex-direction:column', 'gap:18px',
      'background:radial-gradient(ellipse at center,#241c14 0%,#0d0a06 100%)',
      'font-family:Georgia,"Times New Roman",serif', 'color:#e8d9b8',
      'transition:opacity .6s ease', 'opacity:1',
    ].join(';');

    const title = document.createElement('div');
    title.style.cssText =
      'font-size:26px;letter-spacing:.08em;color:#f2c86a;text-shadow:0 2px 6px #000';
    root.appendChild(title);

    // Fortschrittsbalken
    const track = document.createElement('div');
    track.style.cssText = [
      'width:min(360px,70vw)', 'height:10px', 'border:1px solid #8a6a34',
      'border-radius:5px', 'background:#1a140d', 'overflow:hidden',
    ].join(';');
    const bar = document.createElement('div');
    bar.style.cssText = [
      'height:100%', 'width:0%',
      'background:linear-gradient(90deg,#8a6a34,#f2c86a)',
      'transition:width .25s ease',
    ].join(';');
    track.appendChild(bar);
    root.appendChild(track);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:13px;color:#a8916a;letter-spacing:.04em';
    root.appendChild(hint);

    document.body.appendChild(root);
    this.root = root;
    this.bar = bar;
    this.hint = hint;
    this.unsubscribe = this.i18n.onChange(() => {
      root.lang = this.i18n.language;
      title.textContent = this.i18n.t('loading.title');
      hint.textContent = this.i18n.t('loading.building');
    });
  }

  /**
   * @param progress 0..1 — Anteil der gebauten Nah-Chunks
   * @param ready    true, sobald der Nah-Ring steht (Terrain.ready)
   */
  update(progress: number, ready: boolean): void {
    if (this.done) return;
    // Der Balken darf nicht auf 100 % stehen bleiben, während noch das
    // Ufer-Backen läuft — deshalb bis zur Freigabe auf 96 % deckeln.
    const shown = ready ? 1 : Math.min(0.96, progress);
    this.bar.style.width = `${(shown * 100).toFixed(0)}%`;
    if (ready) {
      this.hint.textContent = this.i18n.t('loading.ready');
      this.finish();
    }
  }

  private finish(): void {
    this.done = true;
    this.unsubscribe();
    this.root.style.opacity = '0';
    // Erst nach dem Ausfaden aus dem Layout nehmen, sonst springt das Bild
    window.setTimeout(() => this.root.remove(), 700);
  }
}
