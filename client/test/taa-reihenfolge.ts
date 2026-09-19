/**
 * TAA steht hinter allen anderen Paessen (G19, A3).
 *
 * Der Konstruktor von `PostProcessing` verlangt TAA HINTEN (E13). Nach dem
 * Einschalten stellt sich das von selbst ein und geht beim naechsten
 * Umschalten eines beliebigen anderen Effekts verloren (gemessen 18.09.2026,
 * 12 von 12 Umschaltungen). Die Kettenpruefung ist eine reine Funktion ueber
 * die Namen der Kamerakette (`camera._postProcesses`, freie Plaetze `null`).
 *
 * Zweiter Teil: dass `PostProcessing` diese Pruefung auch AUSFUEHRT — in
 * `update()` (je Bild, faengt das Tor des Strahlenpasses), in `apply()` und in
 * `wendeLookAn()`. Der Konstruktor braucht eine GPU (`TEXTURE_3D`), deshalb
 * wird die Instanz ohne ihn gebaut (`Object.create`), die Pipeline-Schalter
 * sind Attrappen, TAA ist eine Attrappe, die jedes Aus- und Einschalten
 * mitschreibt. Faellt einer der drei Aufrufe weg, wird der Test rot.
 *
 * Lauf: npx tsx client/test/taa-reihenfolge.ts
 */
import { LOOK_VORGABE } from '../../shared/src/lookProfil.js';
import { PostProcessing, taaStehtHinten } from '../src/engine/PostProcessing';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('TAA-Reihenfolge (G19, A3)');

// ── G19 (A3) TAA steht hinter allen anderen Paessen ──────────────────
{
  const kette = (...namen: (string | null)[]) => namen.map((n) => (n === null ? null : { name: n }));
  pruefe(
    taaStehtHinten(kette('valheimDof', 'imageProcessing', 'fxaa', 'TAA', 'TAAPass')),
    'TAA am Ende wird als „nicht hinten" gemeldet'
  );
  pruefe(
    taaStehtHinten(kette('valheimDof', 'TAA', null, 'imageProcessing', 'TAAPass', null)) === false,
    'TAAPass nach einem Fremdpass bedeutet: TAA steht nicht mehr hinten'
  );
  pruefe(
    taaStehtHinten(kette('valheimDof', 'TAA', 'TAAPass', 'highlights', 'imageProcessing', 'fxaa')) === false,
    'nach dem Umschalten von Bloom steht TAA vorn — das war der gemessene Fehler'
  );
  pruefe(
    taaStehtHinten(kette('valheimDof', 'imageProcessing', 'fxaa', 'valheimMotionBlur', 'TAA', 'TAAPass', null, null)),
    'freie Plaetze am Kettenende (null) duerfen die Pruefung nicht stoeren'
  );
  pruefe(taaStehtHinten(kette('TAA', 'TAAPass', 'fxaa')) === false, 'TAA ganz vorn wurde als hinten gemeldet');
  pruefe(taaStehtHinten(kette('fxaa', 'TAAPass', 'TAA')) === false, 'vertauschte Reihenfolge TAAPass/TAA gilt nicht');
  pruefe(taaStehtHinten(kette()) === false && taaStehtHinten(kette('TAA')) === false, 'leere oder unvollstaendige Kette gilt nicht');
}


// ── Die drei Einstiegspunkte hängen TAA wieder ans Ende ──────────────
{
  type Kette = ({ name: string } | null)[];
  const schlecht = (): Kette => [
    { name: 'valheimDof' },
    { name: 'TAA' },
    { name: 'TAAPass' },
    { name: 'highlights' },
    { name: 'imageProcessing' },
    { name: 'fxaa' },
  ];
  const gut = (): Kette => [{ name: 'valheimDof' }, { name: 'imageProcessing' }, { name: 'fxaa' }, { name: 'TAA' }, { name: 'TAAPass' }];
  const OPTIONEN = {
    bloom: true,
    chromaticAberration: true,
    antiAliasing: true,
    motionBlur: false,
    depthOfField: true,
    sunShafts: true,
    ambientOcclusion: false,
    temporalAA: true,
  };

  function ohneGpu(kette: Kette, taaAn = true) {
    const schreibe: boolean[] = [];
    let an = taaAn;
    const taa = {
      isSupported: true,
      get isEnabled(): boolean {
        return an;
      },
      set isEnabled(v: boolean) {
        schreibe.push(v);
        an = v;
      },
    };
    const post = Object.create(PostProcessing.prototype) as Record<string, unknown>;
    post.taa = taa;
    post.camera = { _postProcesses: kette };
    post.taaNeuAngehaengt = 0;
    post.profil = LOOK_VORGABE;
    post.letzteOptionen = OPTIONEN;
    post.pipeline = { chromaticAberration: {} };
    // Alles, was eine Pipeline oder GPU braucht, ist hier nicht Gegenstand.
    for (const name of ['setMotionBlur', 'setDepthOfField', 'setSunShafts', 'setSSAO', 'setTemporalAA', 'syncGeometryBuffer', 'setzeMsaa']) {
      post[name] = () => undefined;
    }
    return { post, schreibe, neu: () => post.taaNeuAngehaengt as number };
  }

  const einstiege: [string, (p: Record<string, unknown>) => void][] = [
    ['update()', (p) => (p.update as (dt: number) => void).call(p, 0.016)],
    ['apply()', (p) => (p.apply as (o: typeof OPTIONEN) => void).call(p, OPTIONEN)],
    ['wendeLookAn()', (p) => (p.wendeLookAn as (l: typeof LOOK_VORGABE) => void).call(p, LOOK_VORGABE)],
  ];
  for (const [name, ruf] of einstiege) {
    const f = ohneGpu(schlecht());
    ruf(f.post);
    pruefe(
      f.schreibe.length === 2 && f.schreibe[0] === false && f.schreibe[1] === true,
      `${name} hängt TAA bei falscher Reihenfolge nicht neu an (Aus-/Einschalten: ${JSON.stringify(f.schreibe)})`
    );
    pruefe(f.neu() === 1, `${name}: Zähler taaNeuAngehaengt ist ${f.neu()}, erwartet 1`);

    const g = ohneGpu(gut());
    ruf(g.post);
    pruefe(g.schreibe.length === 0, `${name} schaltet TAA um, obwohl die Reihenfolge stimmt (History-Reset ohne Grund)`);

    const aus = ohneGpu(schlecht(), false);
    ruf(aus.post);
    pruefe(aus.schreibe.length === 0, `${name} fasst TAA an, obwohl es ausgeschaltet ist`);
  }
}

if (fehler > 0) {
  console.error(`\n${fehler} Fehler`);
  process.exit(1);
}
console.log('\nTAA-Reihenfolge: hinten erkannt, nach Umschalten vorn erkannt.');
