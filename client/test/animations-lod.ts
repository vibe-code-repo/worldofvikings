/**
 * fps-analyse #9 — Animations-LOD: Figuren ausserhalb des Sichtkegels oder
 * weiter als {@link ANIMATIONS_LOD_GRENZE_M} pausieren statt zu animieren,
 * und laufen bei Rueckkehr OHNE Sprung weiter (fortgeschriebene Zeit).
 *
 * [1]+[2] pruefen die reine Regel (client/src/entities/animationsLod.ts)
 * gegen erfundene Gruppen — schnell, ohne Szene. [3] prueft dieselbe
 * Funktion gegen eine ECHTE Babylon-`AnimationGroup` auf der NullEngine:
 * genau das, was `wechsleAnimation()`/`EntityManager` im Spiel uebergibt,
 * und der Beleg fuer "Bei Rueckkehr stimmt die Animationszeit" — `play()`
 * setzt eine pausierte Gruppe an ihrem Bild fort statt bei 0 neu zu
 * beginnen (Praezedenz: gruppenSicherung.ts nutzt denselben Babylon-
 * Vertrag schon fuer die Mess-Diagnose).
 *
 * Nachbesserung (Angriff 27.09.2026, B1–B3): [2] bekam drei neue Faelle
 * fuer genau die Regression der ersten Fassung — ein Einmal-Clip wird
 * beim Fortsetzen zur Schleife (`play(true)` statt `play(loopAnimation)`),
 * und `play()` auf einer laengst GESTOPPTEN oder durch eine echte
 * Zustandsaenderung ERSETZTEN Gruppe startet eine zweite Dauergruppe statt
 * nichts zu tun.
 *
 * Nachbesserung N2 (Nachangriff, Befunde A2/A3): [2] bekam zusaetzlich den
 * neuen A2-Fall (ein spielender Einmal-Clip wird gar nicht erst
 * angehalten, s. `ANIMATIONS_LOD_EINMAL_LAEUFT_IMMER`) und einen
 * A3-Testluecken-Fall (N-M1: eine gestoppte Gruppe OHNE Ersatz darf nicht
 * wieder anlaufen — der `isStarted`-Waechter war ungeprueft).
 *
 *   npx tsx client/test/animations-lod.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Animation } from '@babylonjs/core/Animations/animation';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { SicherbareGruppeMitZustand } from '../src/entities/animationsLod';
import { ANIMATIONS_LOD_GRENZE_M, sollAnimieren, wendeAnimationsLodAn } from '../src/entities/animationsLod';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

/**
 * Erfundene Gruppe fuer die reine Regel — kein Babylon noetig, aber mit
 * demselben Vertrag wie die echte `AnimationGroup` fuer `isStarted`
 * (wird bei `stop()` falsch, bleibt bei `pause()` wahr) und
 * `loopAnimation` (wird von `start(loop)`/`play(loop)` gesetzt).
 */
class FakeGruppe implements SicherbareGruppeMitZustand {
  isPlaying = false;
  isStarted = false;
  loopAnimation = false;
  from = 0;
  playAufrufe: boolean[] = [];
  pauseAufrufe = 0;
  pause(): void {
    this.pauseAufrufe++;
    this.isPlaying = false;
    // isStarted bleibt wahr — echtes Babylon-Verhalten, s. animationGroup.pause().
  }
  play(loop?: boolean): void {
    this.playAufrufe.push(Boolean(loop));
    if (loop !== undefined) this.loopAnimation = loop;
    this.isPlaying = true;
    this.isStarted = true;
  }
  start(loop = false): unknown {
    this.isPlaying = true;
    this.isStarted = true;
    this.loopAnimation = loop;
    return this;
  }
  stop(): void {
    this.isPlaying = false;
    this.isStarted = false;
  }
  goToFrame(): void {
    /* fuer diese Regel unerheblich */
  }
}

console.log('\n[1] sollAnimieren: im Sichtkegel UND nicht weiter als die Grenze');
check('nah + im Sichtkegel -> animieren', sollAnimieren(50, true, 60) === true);
check('an der Grenze (=60) -> noch animieren', sollAnimieren(60, true, 60) === true);
check('knapp jenseits der Grenze -> pausieren', sollAnimieren(60.01, true, 60) === false);
check('ausserhalb des Sichtkegels, obwohl nah -> pausieren', sollAnimieren(10, false, 60) === false);
check('weit UND ausserhalb -> pausieren', sollAnimieren(999, false, 60) === false);
check('Karten-Vorschlag ist 60 m', ANIMATIONS_LOD_GRENZE_M === 60);

console.log('\n[2] wendeAnimationsLodAn: reine Regel gegen erfundene Gruppen');
{
  const a = new FakeGruppe();
  a.start(true); // 'walk'/'idle': eine Schleife, wie start(true) im echten Code
  const nachPause = wendeAnimationsLodAn([a], undefined, false);
  check('pausiert die laufende Gruppe und merkt sie sich', nachPause === a && a.pauseAufrufe === 1 && !a.isPlaying);

  const nochPausiert = wendeAnimationsLodAn([a], nachPause, false);
  check('erneutes "pausieren" ohne laufende Gruppe: kein zweiter pause()-Aufruf', nochPausiert === a && a.pauseAufrufe === 1);

  const nachResume = wendeAnimationsLodAn([a], nochPausiert, true);
  check(
    'Rueckkehr: play(loopAnimation) auf GENAU der gemerkten Gruppe, nichts mehr gemerkt',
    nachResume === undefined && a.playAufrufe.length === 1 && a.playAufrufe[0] === true
  );

  const ohneAenderung = wendeAnimationsLodAn([a], undefined, true);
  check('animieren=true ohne gemerkte Gruppe: kein ueberfluessiger play()-Aufruf', ohneAenderung === undefined && a.playAufrufe.length === 1);
}
{
  // Der Fall, den die erste Fassung dieser Regel noch nicht abfing: ein
  // echter Zustandswechsel (wechsleAnimation) startet WAEHREND der Pause
  // eine FRISCHE Gruppe. Die muss beim naechsten Aufruf trotzdem gefangen
  // werden, sonst laeuft sie unbemerkt unsichtbar weiter.
  const alt = new FakeGruppe();
  alt.start(true);
  const gepaust = wendeAnimationsLodAn([alt], undefined, false);
  check('Vorbereitung: alte Gruppe pausiert', gepaust === alt && !alt.isPlaying);
  const frisch = new FakeGruppe();
  frisch.start(true); // wechsleAnimation() haette hier eine neue Gruppe gestartet
  const gefangen = wendeAnimationsLodAn([alt, frisch], gepaust, false);
  check('die FRISCHE, jetzt laufende Gruppe wird gefangen und pausiert', gefangen === frisch && !frisch.isPlaying && frisch.pauseAufrufe === 1);
  check('die alte, laengst pausierte Gruppe bleibt unberuehrt', alt.pauseAufrufe === 1);
}
{
  // A2 (Nachbesserung N2, VORLAEUFIG — Mikes Antwort steht noch aus): ein
  // SPIELENDER Einmal-Clip (hit/attack/die, start(false, ...)) wird gar
  // nicht erst angehalten — er laeuft immer zu Ende, egal wie weit weg
  // oder ausser Sicht. B1–B3 hatten nur das FORTSETZEN repariert
  // (play(loopAnimation) statt play(true)), nicht dass ein Einmal-Clip
  // ueberhaupt erst mitten im Bild einfriert (ein Toter blieb im ersten
  // Bild von `die` aufrecht stehen, bis man ihn wieder ansah).
  const einmal = new FakeGruppe();
  einmal.start(false);
  const ergebnis = wendeAnimationsLodAn([einmal], undefined, false);
  check(
    'ein spielender Einmal-Clip wird NICHT angehalten (A2)',
    ergebnis === undefined && einmal.pauseAufrufe === 0 && einmal.isPlaying
  );
}
{
  // B1: bleibt die Ausnahme oben aus (Konstante umgestellt) oder wird ein
  // Einmal-Clip aus einem anderen Grund bereits als "gemerkt, echt pausiert"
  // hereingereicht, darf das Fortsetzen ihn NICHT zur Schleife machen —
  // play(loopAnimation), nicht play(true). Sonst feuert das Ende-Ereignis
  // nie mehr (ein toter Wolf stirbt endlos).
  const einmal = new FakeGruppe();
  einmal.start(false);
  einmal.pause(); // wie eine Pause vor Nachbesserung N2 (Ausnahme aus)
  check('Vorbereitung: Einmal-Clip pausiert', einmal.isStarted && !einmal.isPlaying);
  const nachResume = wendeAnimationsLodAn([einmal], einmal, true);
  check(
    'Einmal-Clip laeuft NICHT als Schleife weiter: play(false), nicht play(true)',
    nachResume === undefined && einmal.playAufrufe.length === 1 && einmal.playAufrufe[0] === false
  );
}
{
  // A3/N-M1 (Testluecke, Angriff 27.09.2026): die gemerkte Gruppe wurde
  // GESTOPPT, OHNE dass eine Ersatzgruppe angelaufen ist — z. B. ein
  // Modell ohne "idle"-Clip (npc_1_walk.glb): wechsleAnimation() findet
  // keine Zielgruppe, stoppt aber trotzdem ALLE (auch die gerade
  // pausierte). `!gruppen.some(isPlaying)` ist dann WAHR wie im
  // echten Fortsetzen — nur `isStarted` unterscheidet "echt pausiert"
  // von "laengst gestoppt, nichts zu tun". Ohne diesen Waechter wuerde
  // die Mutante N-M1 die gestoppte Gruppe wieder anlaufen lassen (Soll:
  // gar nichts).
  const gestopptOhneErsatz = new FakeGruppe();
  gestopptOhneErsatz.start(true);
  gestopptOhneErsatz.pause();
  gestopptOhneErsatz.stop();
  check(
    'Vorbereitung: gestoppt, keine andere Gruppe laeuft',
    !gestopptOhneErsatz.isStarted && !gestopptOhneErsatz.isPlaying
  );
  const ergebnis = wendeAnimationsLodAn([gestopptOhneErsatz], gestopptOhneErsatz, true);
  check(
    'gestoppte Gruppe OHNE Ersatz wird NICHT wieder gestartet (isStarted-Waechter, A3/N-M1)',
    ergebnis === undefined && gestopptOhneErsatz.playAufrufe.length === 0
  );
}
{
  // B2/B3: die gemerkte Gruppe wurde inzwischen durch eine ECHTE
  // Zustandsaenderung gestoppt (wechsleAnimation/spieleEinmalKreatur rufen
  // stop() auf jeder Nicht-Ziel-Gruppe auf, Babylon setzt isStarted dabei
  // auf false) UND eine neue Gruppe laeuft bereits. Fortsetzen wuerde eine
  // ZWEITE Dauergruppe erzeugen (Wolf greift von hinten an, waehrend
  // pausiert war) — die gemerkte Gruppe muss vergessen werden, OHNE sie
  // anzufassen.
  const gestoppt = new FakeGruppe();
  gestoppt.start(true);
  gestoppt.pause();
  gestoppt.stop(); // wie wechsleAnimation()/spieleEinmalKreatur() auf der Nicht-Ziel-Gruppe
  check('Vorbereitung: gemerkte Gruppe ist inzwischen gestoppt', !gestoppt.isStarted && !gestoppt.isPlaying);
  const neu = new FakeGruppe();
  neu.start(true); // die neue Gruppe, die wechsleAnimation() gestartet hat
  const vergessen = wendeAnimationsLodAn([gestoppt, neu], gestoppt, true);
  check(
    'gestoppte, ersetzte Gruppe wird vergessen, OHNE angefasst zu werden — kein play() auf ihr',
    vergessen === undefined && gestoppt.playAufrufe.length === 0
  );
  check('die neue, bereits laufende Gruppe wird nicht angefasst', neu.playAufrufe.length === 0 && neu.pauseAufrufe === 0);
}
{
  // Randfall derselben Regel: die gemerkte Gruppe ist selbst noch
  // (isStarted && !isPlaying), aber eine ANDERE Gruppe der Instanz laeuft
  // bereits (sollte laut wechsleAnimation()/spieleEinmalKreatur() nicht
  // vorkommen — jede Nicht-Ziel-Gruppe wird gestoppt — die Regel sichert
  // es trotzdem ausdruecklich ab, wie die Karte verlangt).
  const nochPausiert = new FakeGruppe();
  nochPausiert.start(true);
  nochPausiert.pause();
  const laeuftSchon = new FakeGruppe();
  laeuftSchon.start(true);
  const ergebnis = wendeAnimationsLodAn([nochPausiert, laeuftSchon], nochPausiert, true);
  check(
    'laeuft schon eine andere Gruppe, wird die gemerkte trotz gueltiger Pause vergessen statt fortgesetzt',
    ergebnis === undefined && nochPausiert.playAufrufe.length === 0
  );
}

console.log('\n[3] Echte Babylon-AnimationGroup (NullEngine): Ruecckehr ohne Sprung');
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const node = new TransformNode('figur', scene);
  const anim = new Animation('lauf', 'position.x', 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
  anim.setKeys([
    { frame: 0, value: 0 },
    { frame: 100, value: 100 },
  ]);
  node.animations.push(anim);
  const gruppe = new AnimationGroup('lauf-gruppe', scene);
  gruppe.addTargetedAnimation(anim, node);
  gruppe.start(true);
  gruppe.goToFrame(40);
  check('Vorbereitung: Figur steht auf Bild 40 (Wert 40)', Math.abs(node.position.x - 40) < 1e-6, `${node.position.x}`);
  check('Vorbereitung: Gruppe spielt', gruppe.isPlaying);

  const gepaust = wendeAnimationsLodAn([gruppe], undefined, false);
  check('pausiert die echte Gruppe', gepaust === gruppe && !gruppe.isPlaying);
  check('Bild 40 bleibt stehen, waehrend pausiert (unsichtbar, keine Zeit vergangen)', Math.abs(node.position.x - 40) < 1e-6, `${node.position.x}`);

  const nachRueckkehr = wendeAnimationsLodAn([gruppe], gepaust, true);
  check('Rueckkehr setzt fort statt neu zu starten', nachRueckkehr === undefined);
  check(
    'KEIN Sprung: unmittelbar nach der Rueckkehr steht die Figur IMMER NOCH auf Bild 40, nicht auf 0',
    Math.abs(node.position.x - 40) < 1e-6,
    `${node.position.x}`
  );
  check('Gruppe spielt wieder', gruppe.isPlaying);
}

{
  // A2 an der echten Babylon-Klasse (Nachbesserung N2): ein spielender
  // Einmal-Clip (start(false, ...), wie spieleEinmalKreatur() ihn startet)
  // wird durch wendeAnimationsLodAn NICHT angehalten, obwohl "pausieren"
  // verlangt ist — er laeuft ungestoert bis zum Ende und feuert sein
  // Ende-Ereignis GENAU einmal, egal was der Sichtkegeltest sagt.
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useConstantAnimationDeltaTime = true;
  scene.activeCamera = new FreeCamera('kamera', Vector3.Zero(), scene); // scene.render() braucht eine Kamera
  const node = new TransformNode('figur-einmal', scene);
  const anim = new Animation('die', 'position.x', 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
  anim.setKeys([
    { frame: 0, value: 0 },
    { frame: 10, value: 10 }, // 10 Bilder = kurzer Clip
  ]);
  node.animations.push(anim);
  const gruppe = new AnimationGroup('die-gruppe', scene);
  gruppe.addTargetedAnimation(anim, node);
  gruppe.start(false, 1, 0, 10); // wie spieleEinmalKreatur(): kein Loop
  gruppe.goToFrame(3);
  let enden = 0;
  gruppe.onAnimationGroupEndObservable.add(() => enden++);

  const ergebnis = wendeAnimationsLodAn([gruppe], undefined, false);
  check(
    'A2: der spielende Einmal-Clip wird NICHT angehalten, obwohl "pausieren" verlangt ist',
    ergebnis === undefined && gruppe.isPlaying
  );

  for (let i = 0; i < 20; i++) scene.render(); // Clip ist 10 Bilder lang bei 16 ms/Bild

  check('das Ende-Ereignis feuert GENAU einmal (kein Loop, kein zweiter Durchlauf)', enden === 1, `enden=${enden}`);
  check('die Gruppe spielt danach nicht mehr (kein Ruecksprung auf Bild 0)', !gruppe.isPlaying);

  scene.dispose();
  engine.dispose();
}

console.log(fehler === 0 ? '\nALL PASSED' : `\n${fehler} FAILED`);
process.exit(fehler === 0 ? 0 : 1);
