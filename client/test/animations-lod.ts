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
 *   npx tsx client/test/animations-lod.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Animation } from '@babylonjs/core/Animations/animation';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { SicherbareGruppe } from '../src/entities/gruppenSicherung';
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

/** Erfundene Gruppe fuer die reine Regel — kein Babylon noetig. */
class FakeGruppe implements SicherbareGruppe {
  isPlaying = false;
  from = 0;
  playAufrufe: boolean[] = [];
  pauseAufrufe = 0;
  pause(): void {
    this.pauseAufrufe++;
    this.isPlaying = false;
  }
  play(loop?: boolean): void {
    this.playAufrufe.push(Boolean(loop));
    this.isPlaying = true;
  }
  start(): unknown {
    this.isPlaying = true;
    return this;
  }
  stop(): void {
    this.isPlaying = false;
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
  a.start();
  const nachPause = wendeAnimationsLodAn([a], undefined, false);
  check('pausiert die laufende Gruppe und merkt sie sich', nachPause === a && a.pauseAufrufe === 1 && !a.isPlaying);

  const nochPausiert = wendeAnimationsLodAn([a], nachPause, false);
  check('erneutes "pausieren" ohne laufende Gruppe: kein zweiter pause()-Aufruf', nochPausiert === a && a.pauseAufrufe === 1);

  const nachResume = wendeAnimationsLodAn([a], nochPausiert, true);
  check('Rueckkehr: play(true) auf GENAU der gemerkten Gruppe, nichts mehr gemerkt', nachResume === undefined && a.playAufrufe.length === 1 && a.playAufrufe[0] === true);

  const ohneAenderung = wendeAnimationsLodAn([a], undefined, true);
  check('animieren=true ohne gemerkte Gruppe: kein ueberfluessiger play()-Aufruf', ohneAenderung === undefined && a.playAufrufe.length === 1);
}
{
  // Der Fall, den die erste Fassung dieser Regel noch nicht abfing: ein
  // echter Zustandswechsel (wechsleAnimation) startet WAEHREND der Pause
  // eine FRISCHE Gruppe. Die muss beim naechsten Aufruf trotzdem gefangen
  // werden, sonst laeuft sie unbemerkt unsichtbar weiter.
  const alt = new FakeGruppe();
  alt.start();
  const gepaust = wendeAnimationsLodAn([alt], undefined, false);
  check('Vorbereitung: alte Gruppe pausiert', gepaust === alt && !alt.isPlaying);
  const frisch = new FakeGruppe();
  frisch.start(); // wechsleAnimation() haette hier eine neue Gruppe gestartet
  const gefangen = wendeAnimationsLodAn([alt, frisch], gepaust, false);
  check('die FRISCHE, jetzt laufende Gruppe wird gefangen und pausiert', gefangen === frisch && !frisch.isPlaying && frisch.pauseAufrufe === 1);
  check('die alte, laengst pausierte Gruppe bleibt unberuehrt', alt.pauseAufrufe === 1);
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

console.log(fehler === 0 ? '\nALL PASSED' : `\n${fehler} FAILED`);
process.exit(fehler === 0 ? 0 : 1);
