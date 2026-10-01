/**
 * Testliste, Bereich `admin`: die Einträge `[paket, datei, weiche?]` von KERN, deren Pfad mit `admin/` beginnt.
 * Sortiert nach vollem Pfad (`paket/datei`, Bytevergleich): Ein neuer Test wird an SEINER alphabetischen Stelle
 * eingetragen, nicht ans Ende, damit zwei Pull Requests nicht an derselben Stelle einfügen und git sauber mergt.
 * Die Reihenfolge ist zugleich die Laufreihenfolge im Bereich. `scripts/pruefe-runner-liste.mjs` prüft die Sortierung.
 * Der Kommentar steht direkt über seinem Eintrag und wandert mit ihm.
 *
 * Test list, area `admin`: the KERN entries whose path starts with `admin/`, sorted by full path.
 */

export default [
  // S6-Notausgang (Roadmap-Karte 0.1, zweiter Weg): die Adminliste ueber
  // den Betriebsdienst lesen/aendern, wenn everyone-admin auf false steht
  // und niemand mehr im Spiel an eine Konsole kommt. Echter Prozess wie
  // betriebsdienst.ts, eigene Datei statt dort mit hineinzuwachsen — eine
  // andere Frage (Namensaufloesung ueber die Kontendatenbank, Datei- vs.
  // Arbeitsspeicherstand) als das Weltdokument. Keine Assets, keine GPU,
  // ~2s.
  ['admin', 'test/adminliste.ts'],
  // Der Betriebsdienst haelt seit Block A/16 den Speicherweg des Editors.
  // Er gehoert in die KERNLISTE und nicht zu den langen Laeufen: Er
  // braucht keine Assets und keine GPU, ist in Sekunden durch — und die
  // Zusicherung, die er prueft, ist die teuerste im ganzen Projekt.
  // Ein misslungener Speichervorgang darf die Welt nicht beschaedigen;
  // wer das erst nach dem Ausrollen merkt, merkt es an der Welt.
  ['admin', 'test/betriebsdienst.ts'],
  // Editor EG1: GET/PUT /api/gegenstaende und GET .../quittung gegen den echten
  // Betriebsdienst mit einer Testwurzel (Muster z3f-folgen.ts). Deckt die
  // Anlage der Arbeitskopie aus dem Repo, If-Match (428/412), die
  // 422-Ablehnung jedes ungueltigen Teils (nie still verworfen), das
  // kanonische Schreiben, die Bestaetigung beim Entfernen (409) und zwei
  // gleichzeitige PUTs (genau einer gewinnt). Keine Assets, keine GPU, ~5s.
  ['admin', 'test/gegenstaende-route.ts'],
  // ... and the wiring in the operations service itself, checked on the syntax
  // tree (survives `npm run format`): PR #59's content-type gate carries a
  // narrow, path-and-method-scoped exception for this one route, the origin
  // check still runs first, and the route calls the shared gate/removal.
  ['admin', 'test/modell-upload-verdrahtung.ts'],
  // E8: der Betriebsdienst und die Modul-Registry. Steht neben den beiden
  // obigen und nicht in ihnen, weil er eine andere Frage stellt: nicht
  // „darf diese Anfrage", sondern „sieht dieser Dienst dasselbe wie der
  // Spielserver". Er haelt den STILLEN Raumverlust fest (18 Raeume rein,
  // 17 raus) und dazu, dass ein zur Laufzeit gebautes Modul OHNE Neustart
  // des Dienstes ankommt — und beim Loeschen wieder verschwindet. Braucht
  // weder Assets noch GPU, ~2 s.
  ['admin', 'test/modulregistry.ts'],
  // Gelaende T4a: Spielerzahl in GET /api/server aus dem Metrik-Schnappschuss (peers), null bei fehlender/veralteter Quelle. Rein, ~1 s.
  ['admin', 'test/server-steuerung-spieler.ts'],
  // Serversteuerung im Editor (29.09., Mikes Befund): GET/POST /api/server
  // gegen den echten Betriebsdienst mit einem systemctl-Stand-in — anders
  // als /api/testwelt und /dienst hier NICHT nur die Entscheidungslogik,
  // weil der Dienstname bei dieser Route nie aus der Anfrage kommt (fest
  // "wov-server"). Deckt genau einen systemctl-Aufruf je Aktion, den
  // fremden Dienstnamen im Leib als ignoriert, die Prozess-Sperre (409 bei
  // zwei gleichzeitigen Anfragen) und dass die Testwelt-Marker unberuehrt
  // bleiben. ~2s.
  ['admin', 'test/server-steuerung.ts'],
  // G4 (Testluecken-Durchsicht): ERGAENZT betriebsdienst.ts, deckt nicht
  // ab, was dort schon steht. Unbekannte WOV_INSTANZ (echter Prozessstart,
  // bricht vor jedem Dateizugriff ab), GET /status, GET/PUT /einstellungen/
  // server (Feldvalidierung, tatsaechlich geschriebener Wert, Sicherung),
  // GET /einstellungen/auslieferung (nur lesen), und der Testwelt-
  // Umschalter GET/POST /api/testwelt — dort NUR die Entscheidungslogik
  // vor dem echten systemctl-Aufruf (der Erfolgspfad wuerde den echten
  // wov-server neu starten, s. Kopfkommentar der Testdatei). Deckt
  // nebenbei einen echten Befund auf: ein ungueltiger Einstellungswert
  // (falscher Typ, Zahl ausserhalb der Grenzen) liefert heute HTTP 500
  // statt 400 (Sammel-catch in admin/src/main.ts stuft nur
  // LayoutUngueltig/SyntaxError als Eingabefehler ein). ~1s.
  ['admin', 'test/testwelt-einstellungen.ts'],
  // B1 (Nachangriff N2): der Abbruch des GANZEN Tests (TERM/KILL an seine Gruppe,
  // wie run-tests.mjs es bei Zeitlimit/Speicherwächter tut) darf keinen Dienst mit
  // PPID 1 und offenem Port hinterlassen — Rot auf bd8fa6c (detached-Fix), grün seit
  // dem wrapper-/detached-losen Start. Nachbesserung N4 (N3-1): der Abbruch-Test
  // selbst startete sein Kind detached in einer eigenen Gruppe und hinterließ dabei
  // im Startfenster eine Waise — jetzt ein exit/SIGTERM/SIGINT-Riegel plus ein
  // stdin EOF guard covers parent SIGKILL. Each TERM/KILL probe owns a separate
  // temporary directory, cleaned on exit/TERM/INT. SIGKILL of this test can
  // leave its own directory behind; no old-directory cleanup. ~4 s.
  ['admin', 'test/upload-grundskala-betriebsdienst-abbruch.ts'],
  // Dieselbe Verdrahtung am ECHTEN, laufenden Betriebsdienst (Port 0, wie betriebsdienst.ts):
  // POST mit/ohne X-Wov-Grundskala, Grenzen 0,01…100 inkl. 422, PATCH „nachträglich ändern"
  // (Registry-Datei UND Antwort), unbekannter Name/fehlende Felder. Nachbesserung H2: eigener
  // Upload-Ordner je Lauf (WOV_HOCHGELADEN_DIR), NIE der Checkout — geprüft auch nach SIGKILL
  // mitten im Upload (Angriff Probe C4). Nachbesserung N1: 0x10/1e1/Leerzeichen/+4 -> 422.
  // Nachbesserung N2 (F1): Dienst startet detached, jedes Beenden trifft die ganze
  // Prozessgruppe (kein verwaister Enkelprozess mehr). F4: leerer/relativer
  // WOV_HOCHGELADEN_DIR bricht den Start mit klarer Meldung ab.
  // Nachbesserung N3 (B1): kein Wrapper, kein detached mehr — der Dienst ist ein
  // gewöhnliches Kind (node --import tsx direkt). B8: /proc/sys, hängender Symlink
  // and invalid upload directories fail at startup. Each temporary directory
  // is owned by this test; immediate signal/exit handlers clean up. ~10 s.
  ['admin', 'test/upload-grundskala-betriebsdienst.ts'],
  // Betriebsdienst-Verdrahtung (Syntaxbaum, wie modell-upload-verdrahtung.ts): Kopfzeile
  // x-wov-grundskala geprüft und durchgereicht, neuer PATCH-Zweig für „nachträglich ändern"
  // (422 bei ungültiger Grundskala, keine Bestätigungslogik wie bei DELETE).
  ['admin', 'test/upload-grundskala-dienst.ts'],
  ['admin', 'test/welt-arbeitskopie.ts'],
  ['admin', 'test/welt-bestaetigen-z3.ts'],
  // K5.7 N1: the default working-copy folder (no WOV_WELT_VERZEICHNIS) stays inside the checkout; sync vs. editor save under one lock
  // (two processes, 300 rounds, 0 lost edits); the backup script also saves the base file.
  ['admin', 'test/welt-ohne-variable.ts'],
  // ... and PATCH /api/worldlayout/ops plus the 428 on a POST without a base,
  // against the real operations service on a copy of the world.
  ['admin', 'test/welt-ops.ts'],
  // Baeume entfernen V1: ein beschaedigtes oder zu grosses vegetationEntfernt gibt 422 (nichts geschrieben), gueltige Kreise gehen durch.
  ['admin', 'test/welt-vegetation-422.ts'],
  // Reset the world to zero (K4.0): POST /api/welt-zuruecksetzen against the real operations service with a
  // stand-in for systemctl (confirmation, live 403, nothing deleted, undo when a step fails, base for the next save) ...
  ['admin', 'test/welt-zuruecksetzen.ts'],
  // Base version of the world document: ETag / If-Match / 409 / 422 and the
  // lock across processes. ~80 s (two 37 s lock holders).
  ['admin', 'test/weltdokument-basis.ts'],
  // ... N1/B1/B3: die echte 422-mit-Liste (doppelte Zone, gemischte Punkte, __proto__, Index 64) und die
  // Obergrenzen (Zonen/Punkte) ueber den echten Betriebsdienst.
  ['admin', 'test/weltops-hoehenkorrektur.ts'],
  // ... N5: a set but invalid id and duplicate ids with other content are refused (422); ops_apply `vorher` from area_describe can be undone; placement_set reports clamped values; a save without a change counts 0. Real service + real MCP.
  ['admin', 'test/weltops-n5.ts'],
  ['admin', 'test/weltops-quittung.ts'],
  // ... N4: the operations service (real, port 0) refuses typed-wrong placements with 422 + list and writes nothing; the note about a swallowed re-set reaches the answer.
  ['admin', 'test/weltops-tippfehler.ts'],
  ['admin', 'test/z3f-folgen.ts'],
];
