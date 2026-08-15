/**
 * GameAudio — Hintergrundmusik über die reine Web-Audio-API.
 *
 * Gebraucht wird genau ein Loop mit weichem Ein- und Ausblenden; dafür
 * lohnt kein Engine-Subsystem. Die Quelle ist eine eigene MP3 unter
 * `assets/audio/` — die früheren Original-oggs aus dem Ripper-Export
 * (Biom-Musik, Wind, Schritte, One-Shots) sind entfernt, das Projekt
 * verwendet keine Valheim-Aufnahmen mehr.
 *
 * Browser-Regel: Ein AudioContext startet erst nach einer Nutzergeste —
 * start() hängt sich an den ersten Klick/Tastendruck.
 */

const BASIS = '/assets/audio/';

/** Der eine Hintergrund-Track (Dateiname unter BASIS, ohne Endung nicht nötig). */
const MUSIK_DATEI = 'hintergrundmusik.mp3';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private musikGain: GainNode | null = null;
  private musikQuelle: AudioBufferSourceNode | null = null;
  private master: GainNode | null = null;

  /** Beim ersten Nutzer-Input aufrufen (Pointer-Lock-Klick reicht). */
  start(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);

    void this.lade(MUSIK_DATEI).then((buf) => {
      if (!buf || !this.ctx || !this.master) return;
      const quelle = this.ctx.createBufferSource();
      quelle.buffer = buf;
      quelle.loop = true;
      const gain = this.ctx.createGain();
      // Von null hochziehen, damit der Track nicht in die Szene knallt.
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.16, this.ctx.currentTime, 2);
      quelle.connect(gain);
      gain.connect(this.master);
      quelle.start();
      this.musikQuelle = quelle;
      this.musikGain = gain;
    });
  }

  private async lade(datei: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    try {
      const resp = await fetch(`${BASIS}${datei}`);
      return await this.ctx.decodeAudioData(await resp.arrayBuffer());
    } catch {
      return null;
    }
  }

  /** Musik ausblenden und stoppen (z. B. beim Verlassen der Welt). */
  stopp(): void {
    if (!this.ctx || !this.musikQuelle || !this.musikGain) return;
    const quelle = this.musikQuelle;
    this.musikGain.gain.setTargetAtTime(0, this.ctx.currentTime, 1.2);
    setTimeout(() => quelle.stop(), 4000);
    this.musikQuelle = null;
    this.musikGain = null;
  }
}
