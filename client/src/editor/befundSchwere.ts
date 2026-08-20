/**
 * Schweregrad eines Prüfbefunds (Aufgabe B1) — `LayoutBefund`
 * (shared/src/worldlayout/pruefung.ts) kennt selbst keinen, aber die
 * Kommentare dort sagen ihn wörtlich: 'modell' MELDET nur (eigene
 * Whitelist, kein Server-Verhalten daran), eine Ein-Punkt-Route und
 * NPC-Angaben ohne Vorgabe sind dort ausdrücklich "Hinweis, kein
 * Fehler", und ein fehlender Startpunkt ist zulässig (Server spawnt am
 * Ursprung). Der Rest sind Namen, die der Server beim Spawnen still
 * überspringt — aus Sicht des Entwurfs eine echte Lücke.
 *
 * Eigene Datei statt einer Funktion in editorMain.ts: Reine Logik ohne
 * DOM — editorMain.ts baut beim Import sofort die ganze Editor-Shell
 * auf (`new EditorShell(...)`) und stößt einen Fetch an; von dort aus
 * ist diese Klassifikation nicht isoliert testbar.
 */
import type { LayoutBefund } from '@wov/shared';

export function befundSchwere(b: LayoutBefund): 'fehler' | 'hinweis' {
  if (b.art === 'modell' || b.art === 'welt') return 'hinweis';
  if (b.art === 'route' && b.text.startsWith('Route hat nur einen Wegpunkt')) return 'hinweis';
  if (b.art === 'placement' && b.text.startsWith('NPC-Angaben')) return 'hinweis';
  return 'fehler';
}
