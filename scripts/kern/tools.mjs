/**
 * Testliste, Bereich `tools`: die Einträge `[paket, datei, weiche?]` von KERN, deren Pfad mit `tools/` beginnt.
 * Sortiert nach vollem Pfad (`paket/datei`, Bytevergleich): Ein neuer Test wird an SEINER alphabetischen Stelle
 * eingetragen, nicht ans Ende, damit zwei Pull Requests nicht an derselben Stelle einfügen und git sauber mergt.
 * Die Reihenfolge ist zugleich die Laufreihenfolge im Bereich. `scripts/pruefe-runner-liste.mjs` prüft die Sortierung.
 * Der Kommentar steht direkt über seinem Eintrag und wandert mit ihm.
 *
 * Test list, area `tools`: the KERN entries whose path starts with `tools/`, sorted by full path.
 */
import { brauchtModelle, brauchtBlender, brauchtStore, brauchtBodenQuellen } from '../testweichen.mjs';
import { spawnSync } from 'node:child_process';

/*
  Weiche fuer Pruefer, die eine `python3`-Datei befragen.

  Das Fels-Höhenfeld (F3) liegt bewusst als reines Python-Modul neben dem
  Blender-Bauskript — nur so laesst sie sich ohne Blender messen. Der
  Pruefer ruft `python3` also wirklich auf; fehlt es, misst er nichts und
  wuerde still gruen bleiben. Deshalb hier die Weiche und nicht dort.

  Skips when python3 is missing (the checker shells out to it). `was` names
  what the test asks python3 about; it ends up in the skip reason, so the
  reason names the test's own dependency and not another test's.
*/
function brauchtPython(was) {
  return () =>
    spawnSync('python3', ['-c', 'pass'], { encoding: 'utf-8' }).status === 0
      ? null
      : `python3 fehlt — ${was} wird per python3 befragt`;
}

export default [
  // Emberrage-Glühen: Glow-Schicht nur für angelegte Teile, NullEngine, kein Blender.
  ['tools/armor/test', 'emberrage-glow.ts'],
  /*
    The four thin armor build entry points (Seidraven/Emberrage, male/female)
    check their command line before any build starts: run under python3 with a
    stand-in for the call that would start build_common.py, good command lines
    reach it with the right arguments, bad ones (no `--`, no directory, unknown or
    repeated switch, --female on the male entry, a switch in front of the `--`)
    stop before it with a message and a non-zero exit. No Blender. ~5 s.
  */
  ['tools/armor/test', 'entry-args.mjs', brauchtPython('the armor entry points')],
  /*
    Canonical-skin exporter on tiny synthetic GLBs (no Blender, no assets):
    an item without replaced regions (the Wildwarden crown) is exported from
    its `sourceRegions` and tagged `extras.attachment`; a replacement keeps
    `extras.replaces`; inconsistent definitions are rejected.
  */
  ['tools/armor/test', 'export-attachment.mjs'],
  /*
    All 33 female armor items (five sets) against the real, shipped
    WikingerinKoerper.glb (71 bones, since 27.09.2026): every item's skin
    joints match the body's joints by name and order, and canWearArmor
    accepts the shipped wov-female-v1 policy and rejects the retired
    legacy-female-v1 profile. Needs the real body and item GLBs.
  */
  [
    'tools/armor/test',
    'female-71-skin.mjs',
    brauchtModelle('assets/models/wikingerin/WikingerinKoerper.glb'),
  ],
  /*
    armor-motion.py --keep-body= contract (tools/armor/test/keep_body.py): an unknown
    region, a region the armor already replaces, and a second --keep-body option are all
    refused; an empty list and a repeated region are allowed. No Blender. ~1 s.
  */
  ['tools/armor/test', 'keep-body-args.mjs', brauchtPython('the --keep-body contract')],
  /*
    The four scaffold-built armor sets are data plus design on tools/armor/lib: every
    config.py complete and refused when a required field is missing, items/regions/free
    regions equal to shared/src/<family>.ts, no exec/replace left under sets/. No Blender. ~1 s.
  */
  ['tools/armor/test', 'scaffold-config.mjs', brauchtPython('the armor set configurations')],
  /*
    The skin gate itself (tools/armor/test/skin-gate.mjs) on synthetic GLBs
    written from the item registry, so no Blender and no assets: every
    registered family passes complete; GLB extras that disagree with the
    registry, a part missing from the manifest or from disk, a wrong body and
    an unknown family each fail with their own message. ~10 s.
  */
  ['tools/armor/test', 'skin-gate-selftest.mjs'],
  /*
    Wildwarden: PARTS in tools/armor/sets/wildwarden/male/build.py (read as text by python3,
    Blender is not started), the item registry and the seven shipped GLBs
    must agree on items, replaced regions (ten) and the crown attachment.
  */
  ['tools/armor/test', 'wildwarden-pipeline.mjs', brauchtPython('die Bautabelle von Wildwarden')],
  /*
    S1 (Elemente-Umzug): Kopfzeilen-Wächter über `tools/elements/`. Steht
    ganz vorn, weil er der billigste Prüfer der Liste ist — er liest Text,
    sonst nichts: kein `assets/`, kein Blender, keine GPU, keine
    Netzverbindung. Damit läuft er auch im CI-Checkout, in dem die Modelle
    fehlen, und braucht als einziger Eintrag hier keine Weiche.

    Was er festhält: Jede Datei unter `tools/elements/` sagt in ihrer
    ersten Kommentarzeile, ob sie etwas ERZEUGT, etwas PRÜFT oder
    HILFSMITTEL ist. Diese Auskunft verfällt sonst still — eine fehlende
    Kopfzeile bricht nichts und fällt niemandem auf.

    Header convention guard for tools/elements/ — text only, ~0.1 s.
  */
  ['tools/elements', 'pruefe-koepfe.mjs'],
  /*
    S2 (Elemente-Umzug): der Pfad-Wächter, direkt neben dem Kopfzeilen-
    Wächter und aus demselben Grund hier vorn — er liest Text, sonst nichts.

    Er hält die Zusage des Umzugs fest: Kein Skript unter `tools/elements/`
    nennt einen Ort ausserhalb des Repos. Ohne ihn ist der Umzug nur auf
    Mikes Rechner fertig, denn dort gibt es `~/wov-ai` weiterhin — ein
    Skript, das seine Datei am alten Ort findet, sieht wie ein umgezogenes
    aus. Rot wird das erst beim nächsten Checkout, und dann erklärt es
    niemand mehr.

    Guards the move: no script under tools/elements/ names a path outside
    the repo. Text only, ~0.1 s.
  */
  ['tools/elements', 'pruefe-pfade.mjs'],
  /*
    S4 (Elemente-Umzug): der README-Wächter, der dritte und letzte im Bunde
    — und aus demselben Grund hier vorn: Er liest Text, sonst nichts.

    Er hält das Verzeichnis der Werkbank in beide Richtungen fest: Jeder
    Pfad, den `tools/README.md` oder `tools/elements/README.md` nennt,
    existiert, UND jede Datei unter `tools/elements/` steht in einer der
    beiden. Beide Richtungen sind nötig — ein README ohne tote Pfade kann
    trotzdem den halben Ordner verschweigen, und ein vollständiges kann
    trotzdem ins Leere zeigen.

    Warum das ein Prüfer sein muss und keine Bitte: Ein README wird nie
    ausgeführt. Ein verschobenes Skript hinterlässt einen toten Pfad, ein
    neues eine Lücke — beides bricht nichts, beides fällt niemandem auf.
    Sein erster Lauf fand neun tote Pfade und sechs unerwähnte Dateien.

    S4: guards both README files — no dead path, no unlisted file.
  */
  ['tools/elements', 'pruefe-readme.mjs'],
  /*
    Mass D (05.09.2026): die gebackene VERSCHATTUNG im Netz. In der Krypta
    steht kein gerichtetes Licht — gemessen war der Relieffaktor mit gegen
    ohne Normal-Kanal 1,001. Die Fels-Wandmodule tragen deshalb ein
    COLOR_0 aus der Kruemmung des Hoehenfeldes, das im Steinmaterial aufs
    Albedo multipliziert wird. Der haeufigste stille Ausfall ist NICHT die
    fehlende Spalte, sondern eine aus lauter Einsen; deshalb misst dieser
    Pruefer die Streuung mit. Liest die GLB mit `node` allein, ~0,1 s.
    Guard for the baked cavity term in the rock modules' COLOR_0.
  */
  [
    'tools/elements',
    'pruefung/fels-cavity.mjs',
    brauchtModelle('assets/models/RockVaultWall.glb', 'assets/models/StoneVaultWall.glb'),
  ],
  // F3 (Fels-Relief 3b): die BLOCKLAGE der Fels-Frontschicht — die Naht an
  // der Modulgrenze (jedes abgeschnittene Reststück trifft sein Gegenstück
  // in Höhe und Tiefe), die Hüllbox (kein Block steht weiter vor als das
  // Ziegelrelief, sonst wäre `DG_RockVault` kein abgeleitetes Kit mehr) und
  // das Dreiecksbudget von 1500 je Wandpaneel. Befragt `felsrelief.py` per
  // `python3 --dump`; kein Blender, kein `assets/`, ~1 s.
  // F3: the rock front layer's block lattice — seam, bounding box, budget.
  ['tools/elements', 'pruefung/fels-frontschicht.mjs', brauchtPython('das Fels-Höhenfeld')],
  /*
    Mass A (05.09.2026): der WAECHTER ueber die Kollisionstrennung. Die
    Fels-Frontschicht darf seit heute 18 statt 9 cm tief sein — aber nur,
    weil jedes Fels-Wandmodul ein glattes `_col`-Netz mitbringt, an dem
    die Spielerkapsel entlanggleitet. Faellt das Netz aus einer GLB heraus,
    sieht man NICHTS; die Figur bleibt nur irgendwann in einer Kluft
    haengen. Dieser Pruefer misst die ausgelieferten GLB (Blender headless)
    und haelt fest, dass jedes Modul mit Frontschicht sein `_col` hat, dass
    es dieselbe Huellbox und mehr Volumen hat (also die Kluefte fuellt),
    und dass Zelle, Saele und das Ziegelkit KEINS bekommen haben.
    Guard for the rock kit's separated collision meshes.
  */
  [
    'tools/elements',
    'pruefung/fels-kollision.mjs',
    brauchtBlender('assets/models/RockVaultWall.glb', 'assets/models/StoneVaultStairs.glb'),
  ],
  // F2: Misst das Fels-TEXTURPAAR selbst — Format, Kachelnaht gegen das
  // Bildinnere, Anisotropie (waagerechte Fugen verrieten Mauerwerk) und
  // die Reliefstärke der Normal-Karte. Liest das PNG mit `node:zlib`,
  // braucht also weder PIL noch Blender — aber die Dateien, und die
  // liegen in `assets/`.
  // F2: measures the rock texture pair itself (tiling, format, relief).
  [
    'tools/elements',
    'pruefung/fels-textur.mjs',
    brauchtModelle('assets/models/stein_fels.png', 'assets/models/stein_fels_normal.png'),
  ],
  /*
    S2 (Elemente-Umzug): der volle Kit-Neubau als Prüfer. Baut alle zwölf
    `DG_StoneVault`-Module aus `tools/elements/blender/make-stonevault.py`
    neu und vergleicht je Objekt sechs Felder mit der Auslieferung unter
    `assets/models` — Dreiecke, Ecken, Materialslot, signiertes Volumen,
    Ursprung, Hüllbox. Er ist der einzige Test, der die BAUSKRIPTE selbst
    festhält; ohne ihn merkt niemand, dass eine verstellte Zahl im
    Blender-Skript und die ausgelieferten GLBs auseinandergelaufen sind.

    Der teuerste Eintrag dieses Blocks (~14 s, drei Blender-Starts) und der
    einzige, der Blender braucht — daher `brauchtBlender`. Er steht
    trotzdem hier vorn: Ein verstelltes Bauskript soll auffallen, bevor
    drei Minuten Server-Tests vergangen sind.

    S2: full kit rebuild measured against the shipped GLBs. Needs Blender.
  */
  [
    'tools/elements/pruefung',
    'kit-neubau.mjs',
    brauchtBlender('assets/models/StoneVaultHallVast.glb', 'assets/models/StoneVaultStairs.glb'),
  ],
  /*
    G11 (Modul-Generierung 2.0): die KANTENSONDE als Waechter. Sie liest
    die Modul-GLBs, rechnet ihre Eckpunkte in die Pose um, in der der
    Client sie zeigt (x gespiegelt ueber Babylons `__root__`), und fragt
    je Zellkante: Ist das Durchgangsfenster frei? Damit ist sie der
    einzige Test, der die Kit-ERKLAERUNG (`RoomDef.gridEdges`,
    `connections`) gegen die GEOMETRIE haelt statt gegen eine zweite
    Erklaerung — genau die Luecke, durch die G10 vier gespiegelte Kanten
    an Corner und Junction gefunden hat. Springt bei fehlenden Modellen.
    ~1 s.
    G11: the kit's edge declaration measured against the real GLB geometry.
  */
  // Seit F4 misst sie ohne Argument BEIDE Rasterkits — Ziegel und Fels.
  // Die Kit-Erklaerung ist fuer beide dieselbe (sie wird abgeleitet), die
  // GEOMETRIE ist es nicht: Ein Fels-Block, der ins Durchgangsfenster
  // ragt, aendert keine Zeile der Erklaerung. Deshalb stehen hier auch
  // die Fels-Dateien in der Weiche.
  [
    'tools/elements/pruefung',
    'stonevault-kantensonde.ts',
    brauchtModelle(
      'assets/models/StoneVaultCorner.glb',
      'assets/models/StoneVaultJunction.glb',
      'assets/models/RockVaultCorner.glb',
      'assets/models/RockVaultJunction.glb'
    ),
  ],
  ['tools', 'test/appearance-frisch.ts'],
  /*
    Asset-Paket (12.09.2026): Textnachweis, dass jeder Ordner, aus dem der
    Client zur Laufzeit laedt, auch im Release-Archiv steckt. Steht direkt
    hinter dem nginx-Waechter, weil er aus demselben Holz ist -- liest eine
    Datei, sonst nichts, ~0.1 s, braucht kein assets/.

    Guard: every runtime asset root is a member of PAKET_TEILE.
  */
  ['tools/test', 'asset-paket-teile.ts'],
  /*
    Die Rauschmaske auf dem Felsanteil (A11, 11.09.2026).

    `tools/test/fels-rauschen.ts` rechnet ueber 4 Millionen Proben nach,
    was im Kopf von `client/src/engine/felsRauschen.ts` als Zahl steht:
    Der Erwartungswert bleibt der Deckel aus `RAMPEN` (der Ausschlag 1,45
    klemmt unten bei 0, und ein abgeschnittener Schwanz HEBT den Mittel-
    wert — der Ausgleich rechnet ihn heraus), der Fels wird nirgends rein
    (Vorbild 0,0 %), und es gibt wieder reines Moos (Vorbild 19,2 %; die
    alte Maske hatte 0,0 %). Dazu: die erzeugten GLSL-Zeilen tragen
    dieselben Zahlen wie die TypeScript-Fassung — ohne das ist die
    CPU-Fassung eine Abschrift, und jede Messmaske, die sie benutzt,
    misst eine andere Schicht als der Bildschirm zeigt.

    KEINE WEICHE: Die Datei importiert bewusst kein Babylon und braucht
    keine Assets, laeuft also auch im CI-Checkout.
  */
  ['tools', 'test/fels-rauschen.ts'],
  /*
    E7: `assets/generiert/` ist ein SCHWESTERORDNER von `assets/models/`,
    kein Unterordner — und muss es bleiben. Unter `assets/` ist genau eine
    Datei getrackt (`assets/manifest.json`); schriebe der Spielserver seine
    gebauten Saele nach `assets/models/`, machte jeder Klick im Editor den
    Testlauf rot UND hinterliesse eine ungetrackte Aenderung an einer
    getrackten Datei, die das naechste `git pull` in tools/wov-update.sh
    blockiert. Heute stimmt die Trennung, aber nur als Zufall der Pfade —
    ein Zufall hat keine Bruchstelle, an der etwas anschlaegt. Der Test
    legt deshalb eine echte GLB an den kuenftigen Zielort und laesst BEIDE
    Manifest-Werkzeuge im Original laufen: Ausgabe und erzeugtes Manifest
    muessen Zeichen fuer Zeichen dieselben bleiben. Springt ueber, wenn
    assets/models/ fehlt; raeumt die Attrappe selbst weg. Ein paar
    Sekunden (vier tsx-Starts).

    E7: the generated-assets folder must stay invisible to both manifest
    tools — same output, same bytes, clean `git status assets/`.
  */
  ['tools', 'test/generiert-getrennt.ts'],
  /*
    I1 step 0 (N1): the proof tool `tools/i1-verschiebung.mjs` proves itself with 151 fixtures: real moves and every
    forgery of the attack on #155 (forwarding form, the whole rest of the source file, the whole target file, free
    names bound with scopes, local `k`, `arguments`, replacement table, effect comments, `k: any`), for a class method
    (`this.` -> `k.`), a free function (form a) and verbatim moves (form 0); plus the command line (exit 0, 1, 2).
    Node only, ~2 s.
    Der Verschiebebeweis probt sich selbst: echt, gefälscht, unvollständig, je Form.
  */
  ['tools', 'test/i1-verschiebung.ts'],
  /*
    Der Boden gegen das VORBILD (10.09.2026, `design/original-boden.md`).
    `tools/test/look-referenz.ts` ist dabei umgedreht worden, und das ist
    der Kern der Sache: Bis dahin hat er vier TOENUNGEN bewacht, die am
    Referenzbild zurueckgerechnet waren. Die Spezifikation aus den
    Spieldateien sagt, dass es sie im Vorbild nicht gibt (alle
    `m_DiffuseRemap` 0…1, alle `m_Specular` schwarz) — ein Test, der eine
    Erfindung bewacht, macht sie unantastbar.

    Was er jetzt festhaelt:

     * KEINE Zeile traegt eine Toenung. Der naechste „der Hang ist zu
       hell"-Befund laesst sich in zehn Minuten mit einem Faktor
       erschlagen; wer einen braucht, braucht zuerst eine Messung.
     * Die Schichtoberflaechen stehen auf Tabelle A der Spezifikation.
       Metallic 0,85 auf `rock-a` und Kachel 3 m / Normale 5 auf
       `rock-rough` sind die zwei Paare, aus denen „ich lese den Fels als
       Erde" entstanden ist.
     * Die Rampe hat einen DECKEL. Das Vorbild hat bei ≥ 45° nur 0,425
       Felsgewicht — Moos bleibt in der Wand.
     * Die Halmhoehen sind die der Detail-Prototypen (0,50–0,75 m hoch,
       0,25–0,38 m kurz am Steilhang), und kurzes Gras haengt an der
       NEIGUNG statt an der Menge.
     * `TOENUNG_VORRANG` traegt nur noch, wofuer das Vorbild eine Zahl
       liefert (Ahorn ja, Gras nein).
     * Und unveraendert: Gras wirft keinen Schatten, kein Laubmaterial
       reisst aus, Schnee bleibt im Hohen Norden.

    Braucht `assets/store-lab/vegetation` nur fuer den Laub-Zensus; fehlt
    der Ordner, ueberspringt er DIESEN EINEN Abschnitt und prueft den
    Rest weiter. Deshalb keine Weiche.
  */
  ['tools', 'test/look-referenz.ts'],
  // Karte B1: Vollstaendigkeit der Ton- und Symbol-Abschnitte von
  // assets/manifest.json (tools/asset-manifest.mjs) gegen den echten
  // Bestand unter assets/store/audio bzw. assets/store/ui.
  ['tools', 'test/manifest-ton-symbole.ts', brauchtModelle('assets/store/audio', 'assets/store/ui')],
  // F2 (Roadmap): assets/manifest.json (tools/asset-manifest.mjs) haelt Huellbox,
  // Dreieckszahl, Animationen und mesh-lose Rigs je GLB fest -- ohne diesen Test
  // veraltet es lautlos (neues Modell ohne Eintrag, geloeschtes mit Leiche im
  // Manifest). Liest nur Dateinamen gegeneinander, baut die glTF-Messung nicht
  // nach. Kein Server/Socket, Sekunden.
  //
  // S3: Er vergleicht das getrackte Manifest mit dem UNGETRACKTEN
  // Plattenbestand — sieht ein Arbeitsbaum nur einen Ausschnitt von
  // `assets/models`, meldet er jeden fehlenden Eintrag als Fehler und ist
  // dauerhaft rot. `PlayerAvatar.glb` steht hier stellvertretend für den
  // vollen Bestand: Es ist keine Dungeon-Datei und liegt deshalb nur dort,
  // wo wirklich alle Modelle liegen.
  //
  // B9.1: Kuh und Wolf stehen seither zusätzlich hier. Der Stellvertreter
  // reichte nicht: Ein Baum mit dem Stand vor B9.1 (jede Kopie von DEV, bevor
  // die beiden Dateien dort liegen) hat `PlayerAvatar.glb`, aber nicht
  // `Kuh.glb`/`Wolf.glb`, und wurde mit dem neuen Manifest rot
  // (`manifest=275−0 Platte=273`). Wer neue Modelle ins Manifest aufnimmt,
  // die noch nicht überall liegen, trägt sie hier ein.
  //
  // Cow and wolf join the switch: a tree that predates them holds
  // PlayerAvatar.glb but not the two files and would go red on the new manifest.
  //
  // B9.6: the hen joins for the same reason — a tree that predates it has
  // Kuh.glb/Wolf.glb but not Huhn.glb.
  [
    'tools',
    'test/manifest-vollstaendig.ts',
    brauchtModelle(
      'assets/models/PlayerAvatar.glb',
      'assets/models/Kuh.glb',
      'assets/models/Wolf.glb',
      'assets/models/Huhn.glb',
    ),
  ],
  // F5: die zwei Zuordnungen, mit denen `--abgleich` von einer Prefab-
  // Definition auf die GLB kommt, die sie wirklich laedt — MODELL_ALIAS
  // (aus dem Client-Quelltext gelesen) und Fels-Modul -> Stammmodul (aus
  // der Kit-Ableitung). Beide scheitern lautlos, indem sie etwas aus dem
  // Bericht FALLEN lassen. Braucht keine Modelldateien, laeuft also auch
  // im CI-Checkout. Sekundenbruchteile.
  ['tools', 'test/manifest-zuordnung.ts'],
  // G1/G8 (Modul-Generierung 2.0): Zwei Blöcke an derselben Messzelle.
  // Block A misst den 1.0-Pfad und hält die Ausgangslage fest — 952
  // Abschlussplatten im Körper des Nachbarmoduls (531 gegen eine volle
  // Wand, 414 gegen die Treppenflanke, 7 am Eingang), 1328 gestapelte
  // Zellen. Block B misst über den VERTEILER, also das, was Server und
  // Editor heute bauen: 0/0/0/0. `--streng` muss auf A rot und auf B grün
  // sein — ohne A wäre eine Messzelle, die nur noch Nullen kennt, von
  // einer kaputten nicht zu unterscheiden. ~2 s.
  // Freezes both the old baseline and the new grid result at one measuring cell.
  ['tools', 'test/messe-stonevault-metrik.ts'],
  /*
    Karte D1, Angriffsbefund F2: Textnachweis über deploy/nginx-live.conf —
    der $editor_host-Schalter kennt jede produktive Editor-Domain. Liest
    nur Text, ~0.1 s.
  */
  ['tools/test', 'nginx-live-editor-host.ts'],
  /*
    Ein Ursprung im Container (12.09.2026): Textnachweis über
    deploy/nginx/wov-lab.conf — alle sieben Wege (Webseite, /play/,
    /editor/, /api/accounts/, /api/, /assets/, /ws) stehen als eigener
    location-Block darin. Liest nur Text, ~0.1 s — deshalb ganz vorn,
    aus demselben Grund wie die drei Elemente-Umzug-Wächter direkt
    darunter.

    Text-only guard over the single-origin nginx config — all seven
    paths present as their own location block.
  */
  ['tools/test', 'nginx-wov-lab-pfade.ts'],
  /*
    Karte D1, Angriffsbefund E2: die Weiterleitungsvorlage
    (deploy/npm-weiterleitung-vikings.conf) bildet dieselbe Regel ab wie
    wov-web/src/lib/basisDomains.ts (weiterleitungsZielVikings). Liest nur
    Text, ~0.1 s.
  */
  ['tools/test', 'npm-weiterleitung-vikings-vorlage.ts'],
  /*
    I1 step 0 (N3): the size guard must not touch the surrounding repository when it runs from a git hook. Runs
    `scripts/pruefe-groessen.mjs` from a pre-commit hook in a linked worktree (GIT_DIR and GIT_INDEX_FILE set), from
    `git rebase --exec` and with GIT_DIR set by hand, in a throwaway clone under /var/tmp, and compares HEAD, refs, index and
    the shallow file of the real repo before and after. Red on the guard of `feeccea6` (WOV_GUARD_SKRIPT). ~3 s.
    Der Größenwächter darf aus einem Git-Hook heraus das Repo nicht verändern.
  */
  ['tools', 'test/pruefe-groessen-hook.ts'],
  // G10 (Modul-Generierung 2.0): der BEGEHUNGSPLAN fuer die Spielprobe.
  // Prueft rein rechnerisch, dass die Route aus `tools/raster-begehungsplan.ts`
  // wirklich eine Begehung ist: jeder Schritt eine echte Zellkante, jede
  // Zelle versorgt, JEDE Graphkante in beide Richtungen gequert (sonst
  // blieben die Schleifenkanten aus G5 ungeprueft), kein Wegpunkt im
  // Luftraum einer Treppe, jede Treppe hoch UND herunter, und dieselbe
  // Saat dieselbe Route. Der Lauf im Spiel selbst laeuft NICHT hier mit
  // (er braucht play.dev und Minuten) — dieser Test ist seine
  // Voraussetzung: Ein roter Lauf soll das Grab beschuldigen, nicht den
  // Weg. ~4 s.
  // G10: the walking tour for the in-game probe, checked arithmetically.
  ['tools', 'test/raster-begehung.ts'],
  // G4-Abnahme: dieselben G1-Metriken, gemessen am NEUEN Pfad. Die
  // Messzelle traegt ihre eigene Kantenerklaerung des Kits und ist damit
  // ein unabhaengiger Zeuge — der Generator kann sich nicht selbst
  // freisprechen. Abnahme ueber 40 Saaten und Mikes Kombination: 0 Platten
  // in belegten Zellen (heute 952), 0 unerklaerte Nachbarschaften (531),
  // 0 offene Kanten ohne Eingang, 0 Doppelbelegungen, 100 % Erreichbarkeit.
  // ~2 s.
  // The same G1 metrics measured against the new grid path.
  ['tools', 'test/raster-generator-g4.ts'],
  ['tools', 'test/store-einsortierung.ts', brauchtModelle('assets/store')],
  ['tools', 'test/store-erzeugung.ts', brauchtStore()],
  /*
    Der Store-FELS, und die Fragen sind andere als beim Bewuchs:

      store-felsen.ts  Gibt es jede Art, liegt ihr Neigungsfenster
                       richtigherum, bevorzugt der grosse Fels wirklich
                       den Hang, und steckt jeder Stein zwischen 20 und
                       60 % seiner Hoehe im Boden? Die Zahlen kommen aus
                       den Huellboxen in prefabs.json und aus den GLBs
                       selbst — dem Namen sieht man keine davon an.

    Der teuerste stille Fehler, gegen den er steht, ist ein VERDREHTES
    Neigungsfenster: Bei minTilt > maxTilt ist die Bedingung in
    streuung.ts fuer jede Neigung falsch, die Art verschwindet
    vollstaendig aus der Welt — ohne Fehlermeldung, denn ein abgewiesener
    Kandidat ist der Normalfall.

    Er prueft ausserdem die Annahme, unter der der EntityManager ohne den
    Katalog ueber Store-Kollision entscheidet (STORE_NICHT_STREUEN statt
    `kollision: none`). Hier ist der Katalog umsonst, im Spiel-Buendel
    waere er es nicht.

    WEICHE wie bei den Nachbarn: fehlt `assets/store` GANZ, wird
    uebersprungen; fehlt eine EINZELNE Datei, wird er rot.
  */
  ['tools/test', 'store-felsen.ts', brauchtModelle('assets/store')],
  /*
    Die Store-Vegetation, zwei Fragen und zwei Dateien:

      store-flora.ts       Steht jeder Name in `shared/src/storeFlora.ts`
                           auch im Store, und ergibt jede Biomliste eine
                           Landschaft (Baum, Strauch, Schnee nur im
                           Norden)? Misst die Hoehen aus prefabs.json —
                           am Namen liesse sich das nicht entscheiden.

      store-vegetation.ts  Laeuft die Aufbereitung durch, ist ihr Ergebnis
                           beim zweiten Lauf byteidentisch, und traegt
                           danach jedes Laubmaterial eine Toenung? Ohne
                           die waere das Laub grau — und grau sieht nicht
                           nach Fehler aus, sondern nach Herbst.

    WEICHE `brauchtModelle('assets/store')`: Der Store liegt ausserhalb
    des Repos (Symlink assets/store). Fehlt er GANZ, wird uebersprungen;
    fehlt eine EINZELNE Datei, werden die Tests rot — die Sonde
    entscheidet nie selbst, ob sie laufen darf.
  */
  ['tools/test', 'store-flora.ts', brauchtModelle('assets/store')],
  // Die zwei Fallen in der Prefab-QUELLE: `verhalten` behaelt PERSISTENT, und
  // zwei Eintraege auf dieselbe GLB brechen den Lauf ab statt einen still zu
  // verlieren. Wegwerf-Baum mit veraenderter prefabs.json. ~3 s.
  ['tools', 'test/store-quelle.ts', brauchtStore()],
  ['tools/test', 'store-vegetation.ts', brauchtModelle('assets/store')],
  // ── Stufe 2: die Bodenschichten des Vorbilds ──────────────────────
  //
  // `tools/test/terrain-schichten.ts` haelt vier Dinge fest, von denen
  // keines beim Ausfuehren auffaellt:
  //
  //  1. Das Werkzeug `store-terrain-schichten.mjs` laeuft DETERMINISTISCH
  //     — zweiter Lauf, byteidentische Dateien. Seine Ausgabe liegt unter
  //     `assets/generiert/` und damit ausserhalb von Git; ein `git
  //     status` wuerde eine wandernde Ausgabe nie melden.
  //
  //  2. Werkzeug und Shader nennen DIESELBEN Zahlen. Kachelmass,
  //     Normalstaerke, Metallic und Glaette stehen zwangslaeufig zweimal
  //     (das Werkzeug baut die Pixel, `TerrainSplat.ts` baut den Shader,
  //     und der entsteht, bevor `assets/generiert/` gelesen wird). Zwei
  //     Listen laufen auseinander, sobald jemand EINE korrigiert.
  //
  //  3. Jedes der fuenf Biome hat eine Kachel fuer flach, mittleren und
  //     steilen Hang. Fehlt eine, traegt der Berg weiter Gras — das sieht
  //     nicht falsch aus, nur nicht nach Berg.
  //
  //  4. Beide Schalter (`STORE_BODEN_AKTIV`, `BODEN_FACETTIERT`) sind als
  //     `boolean` typisiert. Mit einem Literaltyp narrowt TypeScript den
  //     anderen Zweig zu totem Code, und der Rueckfall auf Stufe 0 ist
  //     beim naechsten Umbau still kaputt.
  //
  // WEICHE `brauchtBodenQuellen()`: Der Test braucht ZWEI Ordner, nicht
  // einen. Fehlt einer davon GANZ, wird uebersprungen; fehlen EINZELNE
  // Dateien darin, wird der Test rot. Begruendung bei der Funktion.
  ['tools', 'test/terrain-schichten.ts', brauchtBodenQuellen()],
  ['tools', 'test/vorschau-buendeln-typpruefung.ts'],
  // Preview bundle stays untracked; the update script's dirty-tree warning is run for real,
  // and the tracked appearance.json is checked against its generator.
  ['tools', 'test/vorschau-nicht-getrackt.ts'],
  /*
    Wikingerin, Webkopien ueberdecken Spiel-Assets (2026-09-29): nginx liefert
    /assets/ zuerst aus wov-web/static/assets/, sonst aus assets/ -- eine
    getrackte Webkopie am selben relativen Pfad wie ein Eintrag in
    assets/manifest.json versteckt die echte Spiel-Datei dauerhaft, egal ob
    beide gleich sind. Keine echten Assets noetig (nur manifest.json), daher
    ohne brauchtModelle. ~0.1 s.
  */
  ['tools', 'test/webkopien-ueberdeckung.ts'],
  ['tools', 'test/welt-abnehmen.ts'],
  ['tools/test', 'weltbau-integration.ts'],
  // KI-Weltbau über MCP (tools/worldlayout-mcp, shared/src/weltbau): Kartenbild, Weltprüfung,
  // Diff, Ortsbeschreibung, Katalog, Vorgänge, Stilführer und ihre Nachbesserung, dazu die
  // Kontext-Probe gegen einen eigenen Betriebsdienst (Port 0, Wegwerf-Wurzel).
  // MCP world building: map image, world check, diff, describe, catalog, operations, style guide.
  ['tools/test', 'weltbau-karte.ts'],
  // World-map publisher: the small probe (256 px, ~20-35 s); `--gross` runs the full 4096 px probe by hand.
  ['tools', 'test/weltkarte-probe.mjs'],
  ['tools', 'test/wov-sicherung-welt.ts'],
  ['tools/worldlayout-mcp', 'height-correction-readers.ts'],
  ['tools/worldlayout-mcp', 'probe-kontext.ts'],
  // WorldLayout-MCP-Server (Aufgabe B8): echter Client-Handshake gegen den
  // echten Server-Unterprozess (stdio), alle Werkzeuge vorhanden UND ihre
  // Wirkung im Dokument geprueft (Regionsregler, Kontinent/Fluss/See/
  // Route/Platzierung/Startpunkt, layout_pruefen, die meadows-Ablehnung,
  // die layout_deploy-Bremse unter WOV_ADMIN_URL). Der MCP-Server schreibt
  // die Weltdatei nicht selbst, sondern spricht mit dem Betriebsdienst; die
  // Probe startet dafuer einen EIGENEN Betriebsdienst auf einer Kopie der
  // Welt unter /tmp und raeumt sie in `finally` wieder weg, schreibt also NIE
  // in server/data/welten/ (s. Kopfkommentar der Testdatei). ~2-3s.
  ['tools/worldlayout-mcp', 'probe.ts'],
];
