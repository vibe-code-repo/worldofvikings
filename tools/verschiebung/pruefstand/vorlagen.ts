/**
 * Test bench of the move proof: source texts the self-tests cut.
 *
 * Small on purpose, but with everything a real step meets: imports that are used as values and as
 * types, module constants, a class with fields, constructor, accessor, private and async methods,
 * comments in front of and inside declarations, and declarations after the class.
 */
import type { Auftrag } from './verschieber';

/** Modules the source texts import. The same in both states. */
export const UMFELD: Readonly<Record<string, string>> = {
  'src/net/Peer.ts': "export class Peer {\n  name = 'x';\n  istAdmin = false;\n}\n",
  'src/world/Welt.ts': 'export interface Welt {\n  id: string;\n}\n',
  'src/konto/StarterSet.ts': "import type { Peer } from '../net/Peer';\n\nexport const StarterSet = {\n  gib(p: Peer): void {\n    void p;\n  },\n};\n",
  'src/items/Inventory.ts': 'export class Inventory {\n  has(name: string): boolean {\n    return name.length > 0;\n  }\n}\n',
  'src/werte.ts': 'export const FAKTOR = 3;\nexport const ANDERER_FAKTOR = 5;\nexport function messe(): number {\n  return 1;\n}\n',
  'src/wirkung.ts': "export const GELADEN: string[] = [];\nGELADEN.push('wirkung');\n",
  'src/boese/StarterSet.ts': "export const StarterSet = {\n  gib(p: unknown): void {\n    void p;\n  },\n};\n",
};

export const QUELLE = 'src/Server.ts';

/** A server class with module level declarations around it. */
export const SERVER = `/**
 * Head comment of the source file.
 */
import { Peer } from './net/Peer';
import type { Welt } from './world/Welt';
import { StarterSet } from './konto/StarterSet';
import { Inventory } from './items/Inventory';
import { FAKTOR, messe } from './werte';

const PARADE_AUSDAUER = 4;
const PARADE_FENSTER_MS = 250;
let instance: Server | null = null;

/** Drops per creature. */
export const KREATUR_DROPS: Record<string, number> = { wolf: 2, kuh: 1 };

// Chests, by size.
const TRUHEN = [1, 2, 3];

/** Rolls the content of a chest. */
export function wuerfleTruhe(i: number): number {
  return TRUHEN[i % 3]! * FAKTOR;
}

export interface Eintrag {
  name: string;
  menge: number;
}

export function gepruefteWaffe(inventar: Inventory, waffe: string): string {
  return inventar.has(waffe) ? waffe : '';
}

export class Server {
  private letzteTimeoutPruefung = 0;
  private zaehler = 0;
  readonly config = { name: 'x' };
  readonly welten = new Map<string, Welt>();

  constructor() {
    this.zaehler = 1;
    this.letzteTimeoutPruefung = 2;
    instance = this;
  }

  get geo(): number {
    return this.zaehler;
  }

  /**
   * Handles the first packet.
   * Second line of the comment.
   */
  private handleA(p: Peer, r: number): void {
    // a comment inside
    if (this.zaehler > r) {
      this.log(\`viel
  mehrzeilig \${p.name}\`);
      return;
    }
    this.zaehler += r;
  }

  async speichern(): Promise<void> {
    await this.schreiben();
  }

  weltAnlegen(id: string): Welt {
    return this.welten.get(id)!;
  }

  weltSpawn(): number {
    return this.zaehler + 1;
  }

  sendeEffekt(a: number, umkreis = 40): void {
    [a].forEach((x) => this.log(String(x + umkreis)));
  }

  starter(p: Peer): void {
    StarterSet.gib(p);
    this.log('s');
  }

  handleParry(p: Peer): number {
    return PARADE_AUSDAUER + this.zaehler + (p.istAdmin ? 1 : 0);
  }

  andere(): number {
    return 5 + this.zaehler * PARADE_FENSTER_MS + messe();
  }

  zweite(): void {
    StarterSet.gib(new Peer());
    this.log('z');
  }

  private log(s: string): void {
    void s;
  }

  private async schreiben(): Promise<void> {
    void instance;
  }
}

/** After the class. */
export function createServer(inv: Inventory | null = null): Server {
  void inv;
  return new Server();
}
`;

export const BEUTE = 'src/spiel/Beute.ts';
export const KAMPF = 'src/spiel/Kampf.ts';

/** Form 0: four declarations move into one file. */
export const AUFTRAG_FORM0: Auftrag = {
  quelle: QUELLE,
  ziele: [{ datei: BEUTE, woertlich: ['KREATUR_DROPS', 'TRUHEN', 'wuerfleTruhe', 'Eintrag'] }],
};

export const METHODEN = ['handleA', 'speichern', 'weltAnlegen', 'weltSpawn', 'sendeEffekt', 'starter'];

/** Form k: six methods move into one file. */
export const KONTEXT = { datei: 'src/spiel/Kontext.ts', typ: 'ServerKontext' };

export const AUFTRAG_FORMK: Auftrag = {
  quelle: QUELLE,
  klasse: 'Server',
  kontextDatei: KONTEXT,
  ziele: [{ datei: KAMPF, methoden: METHODEN, kontext: { typ: 'KampfKontext' } }],
};

/** Both forms in one step, two target files. */
export const AUFTRAG_BEIDE: Auftrag = {
  quelle: QUELLE,
  klasse: 'Server',
  kontextDatei: KONTEXT,
  ziele: [
    { datei: BEUTE, woertlich: ['KREATUR_DROPS', 'TRUHEN', 'wuerfleTruhe', 'Eintrag'] },
    { datei: KAMPF, methoden: METHODEN, kontext: { typ: 'KampfKontext' } },
  ],
};

/** A class with one method `m` whose body is given: for fixtures about one construct. */
export function kleineKlasse(rumpf: string, parameter = 'a: number', davor = ''): string {
  return `${davor}export class A {\n  config = 1;\n  zahl = 2;\n  m(${parameter}): void {\n    ${rumpf}\n  }\n  n(): number {\n    return this.zahl;\n  }\n}\n`;
}

export const AUFTRAG_KLEIN: Auftrag = {
  quelle: 'src/A.ts',
  klasse: 'A',
  ziele: [{ datei: 'src/teil/Ziel.ts', methoden: ['m'], kontext: { typ: 'Ktx' } }],
};

export const ZIEL_KLEIN = 'src/teil/Ziel.ts';
