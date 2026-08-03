/**
 * GameAudio (Phase G) — schlankes WebAudio-Grundgerüst.
 *
 * Bewusst reine Web-Audio-API statt Babylons Audio-Engine: gebraucht wird
 * nur ein Wind-Loop mit stufenloser Lautstärke plus One-Shots (Schritte,
 * Schlag, Aufsammeln, Tür) — dafür lohnt kein Engine-Subsystem. Quellen
 * sind die Original-oggs aus dem Ripper-Export (assets/audio/).
 *
 * Browser-Regel: Ein AudioContext startet erst nach einer Nutzergeste —
 * start() hängt sich an den ersten Klick/Tastendruck.
 */

const BASIS = '/assets/audio/';

/**
 * Schrittgeräusche, getrennt nach Gehen und Rennen.
 *
 * Die Dateien kommen aus `tools/extract-audio.mjs`; dort steht auch,
 * welche Original-Aufnahmen dahinterstecken. Kurz: Es sind
 * `Player_Footstep_Grass_Walk/Run` — Gras ist der Untergrund, auf dem man
 * in Meadows und Black Forest praktisch immer läuft.
 *
 * Vorher lagen hier `schritt1..3`, und die waren
 * `Player_Footstep_Tar_Land` — TEER aus den Plains-Gruben, und dazu noch
 * die Lande- statt der Laufvariante. Das klang, wörtlich gemeldet, "als
 * würde man durch Wasser laufen".
 *
 * Vier Varianten je Gangart genügen, damit sich der Takt nicht hörbar
 * wiederholt; der Export hätte 16 bzw. 20.
 */
const SCHRITTE = {
  gehen: ['schritt_gehen1', 'schritt_gehen2', 'schritt_gehen3', 'schritt_gehen4'],
  rennen: ['schritt_rennen1', 'schritt_rennen2', 'schritt_rennen3', 'schritt_rennen4'],
} as const;

export class GameAudio {
  private ctx: AudioContext | null = null;
  private readonly puffer = new Map<string, AudioBuffer>();
  private windGain: GainNode | null = null;
  private musikGain: GainNode | null = null;
  private musikQuelle: AudioBufferSourceNode | null = null;
  private musikName: string | null = null;
  private master: GainNode | null = null;
  private schrittAkku = 0;

  /** Beim ersten Nutzer-Input aufrufen (Pointer-Lock-Klick reicht). */
  start(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);

    // Wind-Loop sofort anwerfen (Lautstärke regelt update()).
    void this.lade('wind_loop').then((buf) => {
      if (!buf || !this.ctx || !this.master) return;
      const quelle = this.ctx.createBufferSource();
      quelle.buffer = buf;
      quelle.loop = true;
      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0;
      quelle.connect(this.windGain);
      this.windGain.connect(this.master);
      quelle.start();
    });
    // Restliche Sounds vorladen.
    for (const n of [...SCHRITTE.gehen, ...SCHRITTE.rennen, 'schwung', 'pickup', 'tuer']) {
      void this.lade(n);
    }
  }

  private async lade(name: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const cached = this.puffer.get(name);
    if (cached) return cached;
    try {
      const resp = await fetch(`${BASIS}${name}.ogg`);
      const buf = await this.ctx.decodeAudioData(await resp.arrayBuffer());
      this.puffer.set(name, buf);
      return buf;
    } catch {
      return null;
    }
  }

  /** One-Shot abspielen (leise Zufalls-Tonhöhe gegen Maschinengewehr-Effekt). */
  play(name: string, lautstaerke = 1): void {
    if (!this.ctx || !this.master) return;
    const buf = this.puffer.get(name);
    if (!buf) return;
    const quelle = this.ctx.createBufferSource();
    quelle.buffer = buf;
    quelle.playbackRate.value = 0.94 + Math.random() * 0.12;
    const gain = this.ctx.createGain();
    gain.gain.value = lautstaerke;
    quelle.connect(gain);
    gain.connect(this.master);
    quelle.start();
  }

  /**
   * Biom-Musik: leiser Loop mit weichem Wechsel. null stoppt (Fade-out).
   */
  musikSetzen(name: string | null): void {
    if (!this.ctx || !this.master || name === this.musikName) return;
    this.musikName = name;
    // Alte Quelle ausblenden und stoppen.
    if (this.musikQuelle && this.musikGain) {
      const alteQuelle = this.musikQuelle;
      const alterGain = this.musikGain;
      alterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 1.2);
      setTimeout(() => alteQuelle.stop(), 4000);
      this.musikQuelle = null;
      this.musikGain = null;
    }
    if (!name) return;
    void this.lade(name).then((buf) => {
      // Zwischenzeitlicher Wechsel? Dann verfällt dieser Ladevorgang.
      if (!buf || !this.ctx || !this.master || this.musikName !== name) return;
      const quelle = this.ctx.createBufferSource();
      quelle.buffer = buf;
      quelle.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.16, this.ctx.currentTime, 2);
      quelle.connect(gain);
      gain.connect(this.master);
      quelle.start();
      this.musikQuelle = quelle;
      this.musikGain = gain;
    });
  }

  /**
   * Pro Frame: Wind-Lautstärke der Wetterlage nachführen und Schritte im
   * Bewegungstakt spielen (Gehen 0,5 s, Rennen 0,35 s Schrittabstand).
   */
  update(dt: number, windIntensity: number, bewegt: boolean, rennt: boolean, imDungeon: boolean): void {
    if (this.windGain && this.ctx) {
      const ziel = imDungeon ? 0.02 : 0.05 + windIntensity * 0.35;
      this.windGain.gain.setTargetAtTime(ziel, this.ctx.currentTime, 0.5);
    }
    if (bewegt) {
      this.schrittAkku += dt;
      const intervall = rennt ? 0.35 : 0.5;
      if (this.schrittAkku >= intervall) {
        this.schrittAkku = 0;
        // Eigene Aufnahmen fürs Rennen statt nur schnellerer Wiedergabe —
        // das Original hat dafür getrennte Sätze (Grass_Walk / Grass_Run),
        // und der Laufschritt ist dort hörbar härter angesetzt.
        const satz = rennt ? SCHRITTE.rennen : SCHRITTE.gehen;
        this.play(satz[(Math.random() * satz.length) | 0]!, rennt ? 0.42 : 0.35);
      }
    } else {
      this.schrittAkku = 0.2; // erster Schritt kommt prompt
    }
  }
}
