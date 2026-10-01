// Attrappe für /assets/js/vorschau.js in den DOM-Tests (siehe vitest.config.ts).
// Attrappe für /assets/js/vorschau.js. Zustand an globalThis, weil die Seite das
// Bündel mit `?v=…` lädt und Vite das als eigenes Modul führt.
interface Fake {
  instanzen: Vorschau[];
  importe: number;
  wirftBei: Set<string>;
  verzoegerung: number;
}
const g = globalThis as unknown as { __fake: Fake };
g.__fake ??= { instanzen: [], importe: 0, wirftBei: new Set(), verzoegerung: 0 };
g.__fake.importe += 1;
const warte = () => new Promise<void>((r) => setTimeout(r, g.__fake.verzoegerung));

export class Vorschau {
  rufe: string[] = [];
  entsorgt = 0;
  nachEntsorgen: string[] = [];
  beiKopfZustand: unknown = null;
  constructor(
    public leinwand: HTMLCanvasElement,
    public wurzel: string,
  ) {
    if ((globalThis as { __fakeWirft?: boolean }).__fakeWirft)
      throw new Error('WebGL not supported (Probe)');
    g.__fake.instanzen.push(this);
  }
  private merke(r: string) {
    this.rufe.push(r);
    if (this.entsorgt) this.nachEntsorgen.push(r);
  }
  async setzeWurzel(u: string) {
    this.merke(`wurzel:${u}`);
    await warte();
  }
  async ladeKoerper(p: string) {
    this.merke(`koerper:${p}`);
    await warte();
    if (g.__fake.wirftBei.has(p)) throw new Error(`Body not loadable: ${p}`);
    return true;
  }
  async setzeWaffe(a: string | null) {
    this.merke(`waffe:${a}`);
    await warte();
  }
  async setze(slot: string, datei: string | null) {
    this.merke(`setze:${slot}=${datei}`);
    await warte();
    if (datei && g.__fake.wirftBei.has(datei))
      throw new Error(`Incompatible armor skeleton: ${datei}`);
  }
  setzeHaarfarbe(h: string) {
    this.merke(`haar:${h}`);
  }
  setzeAugenfarbe(i: string) {
    this.merke(`auge:${i}`);
  }
  drehe(w: number) {
    this.merke(`drehe:${w}`);
  }
  blickZurueck() {
    this.merke('zurueck');
  }
  zoomeKopf() {
    this.merke('zoom');
  }
  dispose() {
    this.entsorgt += 1;
  }
}
