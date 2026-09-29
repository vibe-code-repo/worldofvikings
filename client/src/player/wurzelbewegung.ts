/**
 * Root motion of a clip: measure it and take it out, because the figure's position
 * belongs to the physics (PlayerController) and the server, not to the clip.
 *
 * Moved here from AvatarRig so that the same rule serves the own figure (AvatarRig)
 * and the figures of other players (AssetManager) and so that a test can run it on the
 * real body models.
 *
 * ── The rule for lying and stooping clips (card "Tod und Treffer", A4) ─────────────
 * The old rule nails the axis with the LARGEST hip span to its bind value. For a clip in
 * which the figure goes down that axis can be the HEIGHT: `tod_hinten` drops the hips by
 * 0.76 (model units) and slides them back by 0.62 — the old rule froze the height and the
 * dead figure hovered at hip height 0.85 instead of lying at 0.12. So for these clips
 * (`LIEGE_CLIPS`) only the ground-plane axes x/z compete, and the height is never touched.
 * Every other clip keeps the old rule bit for bit.
 */
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';

/**
 * Clips in which the hips go up or down as part of the motion: death, getting up,
 * knocked down, stooping, opening a chest. Their height is the animation.
 */
export const LIEGE_CLIPS = /^(tod_|aufstehen_|umgeworfen$|aufrappeln$|buecken_|truhe_oeffnen$)/;

/*
 * From the former AvatarRig comment (why the travel goes out, and why only ONE axis):
 * Misst die im Clip eingebackene Vorwärtsbewegung, entfernt sie und gibt
 * das Tempo in m/s zurück.
 *
 * ── Warum die Bewegung weg muss ─────────────────────────────────────
 * Beide Clips wandern: Die Hüfte legt im Rennzyklus 3,2, im Gehzyklus
 * 1,6 Modelleinheiten zurück. Mitgespielt liefe die Figur aus ihrer
 * eigenen Position heraus — die Fortbewegung steuert bei uns aber der
 * PlayerController über `root`.
 *
 * ── Warum nur EINE Achse und nicht die ganze Spur ───────────────────
 * Ein früherer Versuch entfernte die komplette Positionsspur der
 * wurzelnahen Knochen. Damit verschwindet aber auch das Auf-und-Ab der
 * Hüfte und der seitliche Versatz — der Gang wird brettsteif. Die
 * Wanderung steckt in genau einer lokalen Achse (Spannweite 3,2 gegen
 * 0,03 und 0,04 der beiden anderen); nur die wird auf ihren
 * Bindepose-Wert festgenagelt. Welche Achse das ist, wird gemessen statt
 * angenommen: Der glTF-Export kommt aus Blender (Z-up) und die
 * Achsenlage ändert sich mit den Exporteinstellungen.
 *
 * Ein weiterer Versuch verwarf ALLE Verschiebungsspuren aller Knochen.
 * Das tötete die Animation komplett — bei diesem Export haben die
 * Drehspuren nur 2 Keyframes, die Bewegung steckt fast vollständig in
 * den Translationen.

 */

/** Bones that can move the body as a whole. */
const WURZEL_KNOCHEN = /^(Root|Hip|Hips|Pelvis|mixamorig:Hips)$/;

/** A span smaller than this (metres) is gait, not travel. */
const WANDERUNG_MIN_M = 0.2;

export type Achse = 'x' | 'y' | 'z';

/**
 * Which axes of the hip keys get nailed to their bind value.
 *
 * `spann` is the span of the keys per axis in the parent space of the bone,
 * `massstab` the world scale of that parent (model units → metres).
 * Returns the axes and the travelled distance in metres (0 when it is only gait).
 */
export function wurzelAchsen(
  clipName: string,
  spann: { x: number; y: number; z: number },
  massstab: number,
  istSprung = false
): { achsen: Achse[]; weiteMeter: number } {
  const nurBoden = LIEGE_CLIPS.test(clipName);
  const achse: Achse = nurBoden
    ? spann.x >= spann.z ? 'x' : 'z'
    : spann.x >= spann.y && spann.x >= spann.z ? 'x' : spann.y >= spann.z ? 'y' : 'z';
  const weiteMeter = spann[achse] * massstab;
  if (weiteMeter < WANDERUNG_MIN_M) return { achsen: [], weiteMeter };
  // A jump hands ALL three axes to the physics; a lying clip never gives up its height.
  return { achsen: istSprung && !nurBoden ? ['x', 'y', 'z'] : [achse], weiteMeter };
}

/**
 * Measure the travelled distance of a clip (m/s, the largest over the root bones) and
 * remove the travel. `massstabVorgabe` is the world scale used when a bone has no parent.
 */
export function messeUndEntferneWurzelbewegung(grp: AnimationGroup, massstabVorgabe: number, istSprung = false): number {
  let weiteste = 0;
  for (const ta of grp.targetedAnimations) {
    if (ta.animation.targetProperty !== 'position') continue;
    const zielName = (ta.target as { name?: string })?.name ?? '';
    if (!WURZEL_KNOCHEN.test(zielName)) continue;
    const keys = ta.animation.getKeys();
    if (keys.length < 2) continue;

    const min = (keys[0]!.value as Vector3).clone();
    const max = min.clone();
    for (const k of keys) {
      min.minimizeInPlace(k.value as Vector3);
      max.maximizeInPlace(k.value as Vector3);
    }
    const spann = max.subtract(min);

    // Keys live in the PARENT space of the hip node, so its world scale converts them to metres.
    const eltern = (ta.target as TransformNode).parent as TransformNode | null;
    eltern?.computeWorldMatrix(true);
    const massstab = eltern?.absoluteScaling?.x ?? massstabVorgabe;

    const { achsen, weiteMeter } = wurzelAchsen(grp.name, spann, massstab, istSprung);
    if (weiteMeter < WANDERUNG_MIN_M) continue;

    // Nail to the BIND pose value, not to the first key (the run cycle starts 0.64 units in front of the origin).
    for (const ax of achsen) {
      const ruhewert = (ta.target as TransformNode).position[ax];
      for (const k of keys) (k.value as Vector3)[ax] = ruhewert;
    }
    ta.animation.setKeys(keys);

    const fps = ta.animation.framePerSecond || 60;
    const dauer = (keys[keys.length - 1]!.frame - keys[0]!.frame) / fps;
    if (dauer > 0) weiteste = Math.max(weiteste, weiteMeter / dauer);
  }
  return weiteste;
}
