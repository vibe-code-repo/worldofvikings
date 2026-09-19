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
 * Dritter Teil (M2): Das Strahlen-Tor haengt seinen Pass an die Kette. Ein
 * Bild, in dem das Tor aufgeht, darf TAA nicht hinter dem Strahlenpass stehen
 * lassen: NACH EINEM update() muss die Reihenfolge stimmen, ohne dass TAA
 * dafuer aus- und wieder eingeschaltet wird (das setzte die History zurueck).
 *
 * Lauf: npx tsx client/test/taa-reihenfolge.ts
 */
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { LOOK_VORGABE } from '../../shared/src/lookProfil.js';
import { PostProcessing, taaPlatzWennHinten, taaStehtHinten } from '../src/engine/PostProcessing';

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

// ── M2 Das Strahlen-Tor: 0 Bilder mit falscher Reihenfolge ───────────
{
  type Eintrag = { name: string } | null;
  const namen = (kette: Eintrag[]): string => kette.map((p) => (p ? p.name : '_')).join(',');

  /**
   * `update()` mit dem ECHTEN Rumpf, ohne GPU. Die Kamera bildet Babylons
   * `attachPostProcess` nach (`insertAt` null: ans Ende; freier Platz: dort
   * hinein; sonst einfuegen), TAA haengt sich beim Einschalten wie die
   * Pipeline ans Ende (Aus: eigene Plaetze werden frei).
   */
  function torBau(start: (string | null)[], strahlenPlatz = -1) {
    const kette: Eintrag[] = start.map((n) => (n === null ? null : { name: n }));
    const schreibe: boolean[] = [];
    let an = true;
    const taa = {
      isSupported: true,
      get isEnabled(): boolean {
        return an;
      },
      set isEnabled(v: boolean) {
        schreibe.push(v);
        an = v;
        if (!v) {
          for (let i = 0; i < kette.length; i++) if (kette[i]?.name === 'TAA' || kette[i]?.name === 'TAAPass') kette[i] = null;
        } else {
          kette.push({ name: 'TAA' }, { name: 'TAAPass' });
        }
      },
    };
    const camera = {
      _postProcesses: kette,
      globalPosition: new Vector3(0, 2, 0),
      getWorldMatrix: () => Matrix.Identity(),
      customRenderTargets: [] as unknown[],
      attachPostProcess: (pp: Eintrag, insertAt: number | null = null): number => {
        if (insertAt == null || insertAt < 0) kette.push(pp);
        else if (kette[insertAt] === null) kette[insertAt] = pp;
        else kette.splice(insertAt, 0, pp);
        return kette.indexOf(pp);
      },
      detachPostProcess: (pp: Eintrag): void => {
        const i = kette.indexOf(pp);
        if (i !== -1) kette[i] = null;
      },
    };
    const shafts = { name: 'VLS', customMeshPosition: new Vector3(), exposure: 0, getPass: () => ({ name: 'VLSComposite' }) };
    const post = Object.create(PostProcessing.prototype) as Record<string, unknown>;
    Object.assign(post, {
      taa,
      camera,
      shafts,
      taaNeuAngehaengt: 0,
      profil: LOOK_VORGABE,
      letzteOptionen: { antiAliasing: true },
      dof: null,
      strahlenQuelle: new Vector3(),
      blickAchse: new Vector3(),
      strahlenAngehaengt: false,
      strahlenUmschaltungen: 0,
      strahlenPlatz,
      setzeMsaa: () => undefined,
    });
    const bild = (sonne: { x: number; y: number; z: number }) =>
      (post.update as (dt: number, s: { x: number; y: number; z: number }) => void).call(post, 0.016, sonne);
    return { post, kette, schreibe, shafts, bild };
  }
  const VOR = { x: 0, y: 0, z: 1 }; // Sonne in Blickrichtung: Tor offen
  const HINTER = { x: 0, y: 0, z: -1 }; // Sonne im Ruecken: Tor zu
  const gut = ['valheimDof', 'imageProcessing', 'fxaa', 'TAA', 'TAAPass'];

  pruefe(taaPlatzWennHinten(gut.map((n) => ({ name: n }))) === 3, 'taaPlatzWennHinten findet TAA nicht');
  pruefe(
    taaPlatzWennHinten(['valheimDof', 'TAA', 'TAAPass', 'fxaa'].map((n) => ({ name: n }))) === -1,
    'taaPlatzWennHinten meldet einen Platz, obwohl TAA nicht hinten steht'
  );

  // 1. Das Tor geht auf: schon nach DIESEM Bild steht TAA hinten, ohne Umschalten.
  {
    const t = torBau(gut);
    t.bild(VOR);
    pruefe(t.post.strahlenAngehaengt === true, 'das Tor ging nicht auf — die Probe misst nichts');
    pruefe(taaStehtHinten(t.kette), `im Tor-Bild steht TAA nicht hinten: ${namen(t.kette)}`);
    pruefe(t.schreibe.length === 0, `TAA wurde umgehaengt (${JSON.stringify(t.schreibe)}) — ein Bild ohne Glaettung`);
    pruefe(t.kette.indexOf(t.shafts) < t.kette.findIndex((p) => p?.name === 'TAA'), 'der Strahlenpass steht nicht vor TAA');
    pruefe(t.post.taaNeuAngehaengt === 0, `taaNeuAngehaengt ${t.post.taaNeuAngehaengt}, erwartet 0`);
  }
  // 2. Tor zu: nichts angefasst.
  {
    const t = torBau(gut);
    t.bild(HINTER);
    pruefe(t.post.strahlenAngehaengt === false && t.schreibe.length === 0, 'ein geschlossenes Tor fasst die Kette an');
  }
  // 3. Alter Platz des Strahlenpasses liegt vor TAA: er geht dorthin zurueck.
  {
    const t = torBau(['valheimDof', null, 'imageProcessing', 'fxaa', 'TAA', 'TAAPass'], 1);
    t.bild(VOR);
    pruefe(t.kette[1] === t.shafts, `der Strahlenpass kam nicht auf seinen alten Platz zurueck: ${namen(t.kette)}`);
    pruefe(taaStehtHinten(t.kette) && t.schreibe.length === 0, 'Rueckkehr auf den alten Platz kostet TAA die Reihenfolge');
  }
  // 4. Alter Platz liegt HINTER TAA (frueher an das Ende gehaengt): nicht dorthin.
  {
    const t = torBau([...gut, null], 5);
    t.bild(VOR);
    pruefe(taaStehtHinten(t.kette) && t.schreibe.length === 0, `ein alter Platz hinter TAA stellt den Pass hinter TAA: ${namen(t.kette)}`);
  }
  // 5. TAA steht selbst vorn (keine anderen Paesse): der Pass darf nicht davor
  //    (MSAA), also ans Ende; die Leseprobe am Ende von update() raeumt auf.
  {
    const t = torBau(['TAA', 'TAAPass']);
    t.bild(VOR);
    pruefe(taaStehtHinten(t.kette), `update() laesst TAA hinter dem Strahlenpass stehen: ${namen(t.kette)}`);
    pruefe(t.post.taaNeuAngehaengt === 1, `die Leseprobe am Ende von update() hat nicht genau einmal neu angehaengt (${t.post.taaNeuAngehaengt})`);
    pruefe(t.kette.findIndex((p) => p?.name === 'VLS') !== 0, 'der Strahlenpass steht vor dem ersten belegten Platz (MSAA-Neuanlage)');
  }
}

if (fehler > 0) {
  console.error(`\n${fehler} Fehler`);
  process.exit(1);
}
console.log('\nTAA-Reihenfolge: hinten erkannt, nach Umschalten vorn erkannt.');
