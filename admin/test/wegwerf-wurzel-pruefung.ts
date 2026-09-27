/**
 * B1 (Nachangriff „Editor Upload-Größe N5"): reine Prüfung, ob ein von
 * AUSSEN vorgegebener Pfad als Wegwerf-Wurzel (`WOV_WEGWERF_WURZEL`)
 * übernommen bzw. — im Abbruch-Test — rekursiv gelöscht werden darf.
 *
 * Ohne diese Prüfung übernahm `wegwerfWurzelBauen`
 * (`upload-grundskala-betriebsdienst.ts`) den Wert der Umgebungsvariable
 * UNGEPRÜFT: `export WOV_WEGWERF_WURZEL=/opt/worldofvikings` in der Umgebung
 * eines `npm test` überschrieb dort `server/data/server.yml`, und der
 * Abbruch-Test löschte danach denselben Pfad rekursiv — beides grün
 * (Angriff N5, Befund B1). Kein bekannter Weg setzt die Variable außer dem
 * Sweep-Test selbst (der Ordner mit dem Präfix unten anlegt); die Prüfung
 * ist trotzdem die einzige Bremse gegen einen falsch gesetzten Wert von
 * außen (Shell-`export`, `.env`, ein künftiger Aufrufer).
 *
 * Reine Funktion: liest nur (lstat/realpath/readdir), schreibt und löscht
 * nichts. Wird von `wegwerfWurzelBauen` (beim ÜBERNEHMEN, `pruefeLeer:
 * true`) UND vom Abbruch-Test (vor jedem `rmSync`, `pruefeLeer: false` —
 * der Ordner ist zu diesem Zeitpunkt vom eigenen Testlauf befüllt) benutzt.
 */
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname } from 'node:path';

export interface WegwerfPruefung {
  readonly ok: boolean;
  readonly grund?: string;
}

/**
 * `pfad` ist nur dann eine sichere Wegwerf-Wurzel, wenn ALLE vier gelten:
 *  - `realpath(pfad)` liegt DIREKT unter `realpath(os.tmpdir())` (kein
 *    beliebiger Systempfad, keine tiefere Verschachtelung);
 *  - der Basisname beginnt mit einem der `praefixe`;
 *  - `pfad` ist selbst KEIN Symlink (`lstat`, unabhängig vom Ziel — ein
 *    Symlink auf einen sonst gültigen Pfad zählt trotzdem nicht);
 *  - ist `pruefeLeer` gesetzt: das Verzeichnis ist beim Prüfen leer (nur
 *    beim ÜBERNEHMEN eines fremden Ordners sinnvoll — ein selbst befüllter
 *    Ordner, der gleich gelöscht werden soll, ist es naturgemäß nicht mehr).
 */
export function pruefeWegwerfPfad(pfad: string, praefixe: readonly string[], pruefeLeer: boolean): WegwerfPruefung {
  let eigenerStat;
  try {
    eigenerStat = lstatSync(pfad);
  } catch (e) {
    return { ok: false, grund: `Pfad nicht lesbar (lstat): ${(e as Error).message}` };
  }
  if (eigenerStat.isSymbolicLink()) {
    return { ok: false, grund: `'${pfad}' ist selbst ein Symlink` };
  }
  if (!eigenerStat.isDirectory()) {
    return { ok: false, grund: `'${pfad}' ist kein Verzeichnis` };
  }

  let real: string;
  let tmpReal: string;
  try {
    real = realpathSync(pfad);
    tmpReal = realpathSync(tmpdir());
  } catch (e) {
    return { ok: false, grund: `realpath fehlgeschlagen: ${(e as Error).message}` };
  }
  if (dirname(real) !== tmpReal) {
    return { ok: false, grund: `'${real}' liegt nicht direkt unter '${tmpReal}'` };
  }

  const basis = basename(real);
  if (!praefixe.some((p) => basis.startsWith(p))) {
    return { ok: false, grund: `Basisname '${basis}' beginnt mit keinem erlaubten Präfix (${praefixe.join(', ')})` };
  }

  if (pruefeLeer) {
    let inhalt: string[];
    try {
      inhalt = readdirSync(real);
    } catch (e) {
      return { ok: false, grund: `Verzeichnis nicht lesbar: ${(e as Error).message}` };
    }
    if (inhalt.length > 0) {
      return { ok: false, grund: `'${real}' ist nicht leer (${inhalt.length} Einträge)` };
    }
  }

  return { ok: true };
}
