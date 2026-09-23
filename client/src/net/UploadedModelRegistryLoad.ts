/**
 * UploadedModelRegistryLoad.ts — die Upload-Registry im BROWSER
 * (Karte „Editor U1 modell-hochladen").
 *
 * Wortgleiches Muster zu `ModuleRegistryLoad.ts` (E6), nur für eine
 * andere Datei: `assets/hochgeladen/registry.json` statt
 * `assets/generiert/modul-registry.json`. Dieselben drei Begründungen
 * gelten unverändert:
 *
 *   - `fetch`, kein Paket über den Spielsocket — die Datei liegt neben
 *     den GLBs, die derselbe Webserver ohnehin ausliefert.
 *   - Eine FEHLENDE Datei ist der Normalfall (kein Upload je gemacht),
 *     kein Fehler.
 *   - `cache: 'no-store'` — anders als die GLBs (deren Name bei
 *     Änderung wechselt) ändert sich DIESE Datei unter gleichem Namen.
 *
 * Fetches the uploaded-model registry and registers every entry, before
 * the first catalog is built. A missing file means "no uploads yet" —
 * the normal case — and never blocks startup.
 */
import { uploadedModelRegistry } from '@wov/shared';
import { STORE_BASE_URL, UPLOADED_PREFIX } from '../engine/assetUrls';

/** Wo die Registry liegt — derselbe Ordner, aus dem auch die GLBs kommen. */
export const REGISTRY_URL = `${STORE_BASE_URL}${UPLOADED_PREFIX}${uploadedModelRegistry.REGISTRY_DATEI}`;

export interface RegistryLadeBericht {
  readonly geladen: number;
  readonly meldungen: string[];
}

/**
 * Die Upload-Registry holen und jeden Eintrag registrieren.
 *
 * MUSS vor dem ersten Katalogaufbau laufen — `GegenstandsKatalog` leitet
 * sein `MIT_MODELL` beim Import aus `PREFAB_DEFS` ab, und eine
 * Registrierung danach trägt zwar ein, bleibt aber unsichtbar, ohne dass
 * etwas fehlschlägt.
 *
 * Wirft nie.
 */
export async function ladeHochgeladeneRegistrierung(
  basis: string = REGISTRY_URL
): Promise<RegistryLadeBericht> {
  const meldungen: string[] = [];
  let text: string | null = null;
  try {
    const antwort = await fetch(basis, { cache: 'no-store' });
    if (antwort.ok) text = await antwort.text();
    else if (antwort.status !== 404) meldungen.push(`${basis}: HTTP ${antwort.status}`);
  } catch (e) {
    meldungen.push(`${basis}: ${(e as Error).message}`);
  }

  let geladen = 0;
  if (text !== null) {
    const stand = uploadedModelRegistry.leseRegistryAusText(text);
    const erg = uploadedModelRegistry.applyUploadedModelRegistry(stand);
    meldungen.push(...erg.meldungen);
    geladen = erg.geladen;
    if (geladen > 0) console.log(`[ModellUpload] ${geladen} hochgeladene(s) Modell(e) aus ${basis} registriert`);
  }
  for (const m of meldungen) console.warn(`[ModellUpload] ${m}`);

  return { geladen, meldungen };
}
