/**
 * uploadedModelRohmasse.ts — die rohe Hüllbox einer `.glb`-Datei, BEVOR
 * sie hochgeladen ist (Karte „Editor Upload-Größe", Auftrag Punkt 4).
 *
 * ── Warum eine eigene Datei, nicht in `uploadedModelGroessenvorschlag.ts`
 *    und nicht im Barrel ───────────────────────────────────────────────
 * Sie importiert `kollision/glb.ts` — reines JS, kein `node:fs`, aber
 * genau die Datei, deren eigener Kopfkommentar sagt: „Der Client braucht
 * ihn nie, und über `export *` läge er in jedem Spiel-Bundle" (dieselbe
 * Begründung, aus der `uploadedModelUpload.ts` nicht im Barrel steht,
 * nur hier wegen Bundle-Größe statt `node:fs`). Für DIESE Karte braucht
 * der EDITOR ihn zum ersten Mal (Zielgrößen-Vorschau vor dem Hochladen) —
 * aber das Spiel selbst weiterhin nie. Ein `export *` von hier im Barrel
 * würde `glb.ts` über `uploadedModelGroessenvorschlag.ts` (das DORT schon
 * steht) in JEDES Spiel-Bundle ziehen. Diese Datei bleibt deshalb, wie
 * `uploadedModelUpload.ts`, nur über ihren EXPLIZITEN Pfad importierbar
 * (`@wov/shared/src/uploadedModelRohmasse.js`) — nur der Editor
 * (`GegenstandsKatalog.ts`) tut das.
 */
import { leseGlb } from './kollision/glb.js';

export interface RohMasse {
  readonly breite: number;
  readonly hoehe: number;
  readonly tiefe: number;
}

/** Hüllbox aus Vertexpositionen — wortgleich zu `uploadedModelUpload.huellbox`. */
function huellboxAusPositionen(positionen: Float32Array): RohMasse {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positionen.length; i += 3) {
    const x = positionen[i]!, y = positionen[i + 1]!, z = positionen[i + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return { breite: NaN, hoehe: NaN, tiefe: NaN };
    }
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { breite: maxX - minX, hoehe: maxY - minY, tiefe: maxZ - minZ };
}

/**
 * Die rohe Hüllbox EINER `.glb`-Datei — dieselbe Rechnung wie der
 * Betriebsdienst (`pruefeUndSpeichereUpload`, VOR jeder Grundskala), nur
 * hier BROWSERSEITIG, bevor die Datei überhaupt hochgeladen ist: Der
 * Zielgrößen-Dialog braucht die Rohgröße, um daraus die Grundskala
 * (Zielgröße ÷ Rohgröße) zu rechnen.
 *
 * `null`, wenn die Datei keine gültige GLB ist oder kein sichtbares Netz
 * hat — derselbe Fall, den der Betriebsdienst beim echten Hochladen als
 * eigene Ablehnung meldet. Diese Funktion wirft nie; der Aufrufer zeigt
 * bei `null` einfach keinen Vorschlag an und lässt den Betriebsdienst die
 * eigentliche (ausführlichere) Fehlermeldung liefern.
 */
export function rohMasseAusGlb(bytes: Uint8Array): RohMasse | null {
  let inhalt;
  try {
    inhalt = leseGlb(bytes);
  } catch {
    return null;
  }
  if (inhalt.sicht === null) return null;
  const masse = huellboxAusPositionen(inhalt.sicht.positionen);
  if (!Number.isFinite(masse.breite) || !Number.isFinite(masse.hoehe) || !Number.isFinite(masse.tiefe)) return null;
  return masse;
}
