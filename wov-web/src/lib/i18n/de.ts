/**
 * The German catalogue — the source of truth for every visible string.
 *
 * Rules for entries (they are what keep this file useful):
 *
 *  - Plain text only, never HTML. Where a sentence carries inline markup
 *    (`<b>`, `<i>`, `<code>`), it is split into two keys and the markup stays
 *    in the component. `{@html}` would bypass Svelte's escaping, and escaping
 *    that happens by itself is exactly the security gain the rebuild was
 *    after (see the header comment of `formate.ts`); the CSP does not help
 *    against injected markup.
 *  - No numbers interpolated into a value. Counts and names are placed next
 *    to the text fragment in the markup, so a translator never has to guess
 *    what a `%s` will turn into. Dates are the one exception — they go
 *    through `formate.ts`, which takes a locale.
 *  - Decorative runes (`ᚦᛁᛜ`, `ᛊᚨᚷᚨ`, …) are not in here. They are
 *    `aria-hidden` ornament, identical in every language, and belong to the
 *    layout, not to the text.
 *  - The contents of `static/api/*.json` and `static/assets/karten/*.json`
 *    are NOT in here. They are fetched at runtime and stay German for now.
 *
 * New keys go into this file first; `npm run check` then demands the English
 * side before the build is green again.
 */
export const de = {
  /* ------------------------------------------------------------- Kopf */
  'kopf.marke': 'World of Vikings',
  'kopf.nav.aria': 'Hauptnavigation',
  /* Steht per CSS (`content: attr(data-bald)`) hinter einem Navigationspunkt. */
  'kopf.bald': 'bald',
  'kopf.fahrt.knopf': 'Auf Fahrt gehen',
  'kopf.sprache.aria': 'Sprache',

  /* --------------------------------------------------------- MobilNav */
  'mobilnav.nav.aria': 'Hauptnavigation (schmal)',
  'mobilnav.fahrt.vorlesen': 'Auf Fahrt gehen',

  /* ------------------------------------------------------------- Fuss */
  'fuss.marke': 'WORLD OF VIKINGS',
  'fuss.beschreibung': 'Ein Wikinger-Browserspiel auf eigenem Grund.',
  'fuss.halle.ueberschrift': 'Halle',
  'fuss.halle.start': 'Startseite',
  'fuss.halle.saga': 'Die Saga',
  'fuss.halle.karte': 'Die Karte',
  'fuss.halle.spielen': 'Spielen ›',
  'fuss.recken.ueberschrift': 'Recken',
  'fuss.recken.ruestkammer': 'Rüstkammer',
  'fuss.recken.ruhmeshalle': 'Ruhmeshalle',
  'fuss.recken.thing': 'Das Thing',
  'fuss.sprache.ueberschrift': 'Sprache',
  'fuss.schluss':
    '© 865–2026 World of Vikings. Gefertigt in den Hallen von Midgard. Keine Installation erforderlich.',

  /* --------------------------------------------------------- Kopfdaten */
  /* Der Zusatz hinter jedem Seitentitel und der og:site_name. */
  'kopfdaten.marke': 'World of Vikings',

  /* ----------------------------------------------------------- seiten */
  /* Beschriftungen der Navigation. `titel` steht in der Kopfleiste,
     `kurz` in der Mobilleiste, wo weniger Platz ist. */
  'seiten.hauptnav.halle.titel': 'Halle',
  'seiten.hauptnav.halle.kurz': 'Halle',
  'seiten.hauptnav.saga.titel': 'Die Saga',
  'seiten.hauptnav.saga.kurz': 'Saga',
  'seiten.hauptnav.karte.titel': 'Die Karte',
  'seiten.hauptnav.karte.kurz': 'Karte',
  'seiten.hauptnav.ruestkammer.titel': 'Rüstkammer',
  'seiten.hauptnav.ruhmeshalle.titel': 'Ruhmeshalle',
  'seiten.hauptnav.ruhmeshalle.kurz': 'Ruhm',
  'seiten.hauptnav.thing.titel': 'Das Thing',
  'seiten.hauptnav.thing.kurz': 'Thing',

  /* ------------------------------------------------------------ Halle */
  'halle.kopf.titel': 'World of Vikings — Ein Wikinger-Browserspiel',
  'halle.kopf.beschreibung':
    'Angelsachsen gegen Wikinger. Ein Browserspiel ohne Download: Welt erkunden, bauen, die Wächter Midgards bezwingen.',
  'halle.held.wappen_alt':
    'Wappen von World of Vikings: ein Langschiff in einem Steinring aus Runen',
  'halle.held.h1': 'World of Vikings',
  'halle.held.unter':
    'Angelsachsen gegen Wikinger. Eine Welt aus Wiesen, Schwarzwald und Sumpf, die im Browser läuft — kein Download, keine Anmeldung. Öffnen und loslaufen.',
  'halle.held.knopf.fahrt': 'Auf Fahrt gehen',
  'halle.held.knopf.welten': 'Die Welten sehen',
  /* Das Bifröst-Band setzt sich im Markup aus Weltname, Zahlen und diesen
     vier Bausteinen zusammen: „Midgard offen — 3 von 20 auf Fahrt“. */
  'halle.held.band.offen': 'offen',
  'halle.held.band.von': 'von',
  'halle.held.band.auf_fahrt': 'auf Fahrt',
  'halle.held.band.geschlossen': 'geschlossen',
  'halle.held.band.wird_geprueft': 'Bifröst — Zustand wird geprüft …',
  'halle.held.band.frueher_stand': 'Früher Stand.',
  'halle.held.band.aufbau': 'Die Welt ist im Aufbau.',
  'halle.erwartet.kopf': 'Was dich erwartet',
  'halle.erwartet.neun_lande.bild_alt': 'Bemalter Rundschild mit Rabenzeichen',
  'halle.erwartet.neun_lande.titel': 'Neun Lande',
  'halle.erwartet.neun_lande.text':
    'Von den Wiesen über den Schwarzwald und den Sumpf bis in die Berge, die Ebenen und das Nebelland. Jedes Land hat eigenes Wetter, eigene Bewohner und eigene Wege, dich umzubringen.',
  'halle.erwartet.fuenf_waechter.bild_alt': 'Steinerner Schädel mit leuchtender Rune',
  'halle.erwartet.fuenf_waechter.titel': 'Fünf Wächter',
  'halle.erwartet.fuenf_waechter.text':
    'Eikthyr, der Älteste, die Knochenmasse, Moder und Yagluth. Jeder gefallene Wächter öffnet das nächste Land — und trägt sich in deine Rüstkammer ein.',
  'halle.erwartet.bauen.bild_alt': 'Schmiedehammer über gekreuzten Balken',
  'halle.erwartet.bauen.titel': 'Bauen, was bleibt',
  'halle.erwartet.bauen.text':
    'Langhaus, Werkbank, Hafen. Der Bau folgt echter Statik: Was nicht getragen wird, fällt. Was du in Midgard errichtest, steht auch morgen noch.',
  'halle.erwartet.verliese.bild_alt': 'Moosbewachsener Höhleneingang mit Fackeln',
  'halle.erwartet.verliese.titel': 'Verliese mit Saat',
  'halle.erwartet.verliese.text':
    'Gruften und Höhlen entstehen aus gesetzter Saat mit echten Türen und Raumketten — bei jedem neu, aber für alle gleich.',
  'halle.technik.kein_konto.titel': 'Kein Konto, kein Client',
  'halle.technik.kein_konto.text':
    'Der Browser ist der Client. Keine Installation, kein Ladebalken über Gigabyte — die Welt wird gestreamt, während du gehst.',
  'halle.technik.ehrlicher_server.titel': 'Ein ehrlicher Server',
  'halle.technik.ehrlicher_server.text':
    'Die Spielregeln liegen beim Server, nicht im Browser. Was dein Recke kann, entscheidet Midgard — nicht dein Rechner.',
  'halle.welten.titel': 'Die Welten',
  'halle.welten.text':
    'Midgard ist die bleibende Welt — was dort steht, bleibt stehen. Die Werkstatt ist zum Ausprobieren da und wird ohne Vorwarnung zurückgesetzt.',
  'halle.welten.fehler': 'Die Weltliste ist gerade nicht erreichbar.',
  'halle.welten.laedt': 'Die Weltliste wird geholt …',
  'halle.welten.zustand_offen': 'offen',
  'halle.welten.zustand_geschlossen': 'geschlossen',
  'halle.welten.wert.auf_fahrt': 'auf Fahrt',
  'halle.welten.wert.weltzeit': 'Weltzeit',
  'halle.welten.wert.art': 'Art',
  'halle.welten.wetter_label': 'Wetter:',
  'halle.welten.saat_label': 'Saat:',
  'halle.welten.karte_link': 'Beide Welten auf der Karte ansehen ›',
  'halle.ruhmeshalle.titel': 'Aus der Ruhmeshalle',
  'halle.ruhmeshalle.spalte.raute': '#',
  'halle.ruhmeshalle.spalte.recke': 'Recke',
  'halle.ruhmeshalle.spalte.sippe': 'Sippe',
  'halle.ruhmeshalle.spalte.runenrang': 'Runenrang',
  'halle.ruhmeshalle.fehler': 'Die Tafel ist gerade verhängt.',
  'halle.ruhmeshalle.laedt': 'wird geholt …',
  'halle.ruhmeshalle.link': 'Die ganze Tafel ansehen ›',
  'halle.thing.titel': 'Das Thing wird einberufen',
  'halle.thing.text':
    'Beim Thing versammelten sich die Freien, um zu beraten und zu richten. Unseres wird das Forum: ein Ort für Bauwerke, Fundstücke, Streit über Ausrüstung und die Frage, wer als Nächstes gegen Moder zieht.',
  'halle.thing.knopf': 'Was dort entstehen soll',
  'halle.saga_anriss.titel': 'Neues aus Midgard',
  'halle.saga_anriss.fehler': 'Die Saga schweigt gerade.',
  'halle.saga_anriss.laedt': 'wird geholt …',
  'halle.saga_anriss.link': 'Die ganze Saga lesen ›',

  /* ------------------------------------------------------------- Saga */
  'saga.kopf.titel': 'Die Saga',
  'saga.kopf.beschreibung': 'Was sich in Midgard tut: Neuigkeiten zu Welt, Spiel und Server.',
  'saga.h1': 'Die Saga',
  'saga.einleitung':
    'Was in Midgard gebaut, geändert und repariert wurde — in der Reihenfolge, in der es geschah.',
  'saga.fehler': 'Die Saga schweigt gerade.',
  'saga.laedt': 'Die Saga wird aufgeschlagen …',
  'saga.leer': 'Noch kein Eintrag.',

  /* ------------------------------------------------------------ Karte */
  'karte.titel': 'Die Karte',
  'karte.beschreibung':
    'Die Weltkarten von World of Vikings: Midgard und die Werkstatt, gerechnet aus der Welt, die der Server wirklich fährt.',
  'karte.ueberschrift': 'Die Karte',
  'karte.einleitung':
    'So sieht Midgard von oben aus. Das Bild ist keine Zeichnung, sondern die Welt selbst: dieselbe Geländeberechnung, die der Server fährt, wenn du an Land gehst. Ändert sich die Welt, ändert sich die Karte.',
  'karte.hinweis.fett': 'Ohne JavaScript kein Betrachter.',
  'karte.hinweis.text': 'Die Karten liegen aber als gewöhnliche Bilder bereit:',
  'karte.hinweis.link_midgard': 'Midgard',
  'karte.hinweis.verbindung': 'und',
  'karte.hinweis.link_werkstatt': 'Werkstatt',
  'karte.cta': 'Selbst hinfahren',

  /* --------------------------------------------------- Kartenbetrachter */
  'kartenbetrachter.laedt': 'Karten werden geholt …',
  'kartenbetrachter.fehler.karten': 'Die Karten sind gerade nicht erreichbar.',
  'kartenbetrachter.fehler.karte': 'Diese Karte ist gerade nicht erreichbar.',
  'kartenbetrachter.flaeche.aria': 'Weltkarte — ziehen zum Schieben, Mausrad zum Zoomen',
  /* Der Alt-Text lautet zusammengesetzt: „Weltkarte von Midgard — 10,2 Kilometer Kantenlänge“. */
  'kartenbetrachter.bild.alt_vorn': 'Weltkarte von',
  'kartenbetrachter.bild.alt_hinten': 'Kilometer Kantenlänge',
  'kartenbetrachter.naeher': 'Näher heran',
  'kartenbetrachter.weiter_weg': 'Weiter weg',
  'kartenbetrachter.ganze_welt': 'Ganze Welt',
  'kartenbetrachter.zeiger': 'Zeiger:',
  'kartenbetrachter.stand.regionen': 'Regionen',
  'kartenbetrachter.stand.km_kante': 'km Kante',
  'kartenbetrachter.stand.stand': 'Stand',
  'kartenbetrachter.stand.laedt': 'wird geholt …',
  'kartenbetrachter.farben.titel': 'Was die Farben bedeuten',
  'kartenbetrachter.farben.text':
    'Dunklere Flächen innerhalb eines Landes sind Wald, hellere sind höheres Gelände. Die Schummerung zeigt Hänge — so liest man Täler und Grate, die in einer flachen Einfärbung untergingen.',
  'kartenbetrachter.zwei.titel': 'Zwei Welten, zwei Karten',
  'kartenbetrachter.zwei.midgard.name': 'Midgard',
  'kartenbetrachter.zwei.midgard.text':
    'ist die bleibende Welt. Was dort steht, bleibt stehen — und die Karte ändert sich nur, wenn das Land selbst umgebaut wird.',
  'kartenbetrachter.zwei.werkstatt.name': 'Die Werkstatt',
  'kartenbetrachter.zwei.werkstatt.text':
    'ist der Bauplatz. Dort entstehen neue Inseln und Landstriche, bevor sie nach Midgard wandern; sie wird ohne Vorwarnung zurückgesetzt.',

  /* ------------------------------------------------------ Rüstkammer */
  'ruestkammer.titel': 'Rüstkammer',
  'ruestkammer.beschreibung':
    'Sieh dir Recken aus Midgard an: Ausrüstung, Fertigkeiten, bezwungene Wächter und Trophäen.',
  'ruestkammer.ueberschrift': 'Rüstkammer',
  'ruestkammer.einleitung':
    'Wer wie durch Midgard zieht: Ausrüstung, Fertigkeiten, bezwungene Wächter und Trophäen. Suche nach einem Recken, einer Sippe oder einem Beinamen.',
  'ruestkammer.hinweis.fett': 'Noch Beispieldaten.',
  'ruestkammer.hinweis.text':
    'Das Spiel kennt bisher keine Konten — es gibt also noch keine echten Recken zu zeigen. Die Kammer steht aber fertig und füllt sich von selbst, sobald der Server Charaktere speichert.',
  'ruestkammer.zurueck': '‹ Zurück zur Suche',
  'ruestkammer.suche.label': 'Recke suchen',
  'ruestkammer.suche.platzhalter': 'Name, Beiname oder Sippe …',
  'ruestkammer.suche.knopf': 'Suchen',
  'ruestkammer.zustand.fehler':
    'Die Kammer ist gerade verschlossen — die Reckenliste liess sich nicht laden.',
  'ruestkammer.zustand.laedt': 'Die Kammer wird aufgeschlossen …',
  'ruestkammer.zustand.leer': 'Kein Recke dieses Namens in der Kammer.',
  'ruestkammer.karte.runenrang': 'Runenrang',
  'ruestkammer.karte.zuletzt': 'zuletzt',

  /* ----------------------------------------------------- Ruhmeshalle */
  'ruhmeshalle.titel': 'Ruhmeshalle',
  'ruhmeshalle.beschreibung':
    'Die Bestenlisten aus Midgard: Runenrang, bezwungene Wächter, Zeit auf Fahrt.',
  'ruhmeshalle.ueberschrift': 'Ruhmeshalle',
  'ruhmeshalle.einleitung':
    'Wer sich in Midgard einen Namen gemacht hat. Die Tafeln werden neu berechnet, sobald die Welt gespeichert wird.',
  'ruhmeshalle.hinweis.fett': 'Noch Beispieldaten.',
  'ruhmeshalle.hinweis.text':
    'Solange es keine Konten gibt, stehen hier erfundene Recken — die Tafeln selbst sind fertig.',
  'ruhmeshalle.tabelle.raute': '#',
  'ruhmeshalle.tabelle.recke': 'Recke',
  'ruhmeshalle.tabelle.sippe': 'Sippe',
  'ruhmeshalle.zustand.fehler': 'Die Tafeln sind gerade verhängt.',
  'ruhmeshalle.zustand.laedt': 'wird geholt …',

  /* ----------------------------------------------- Tafeln (recken.ts) */
  'recken.tafel.rang.titel': 'Runenrang',
  'recken.tafel.rang.spalte': 'Rang',
  'recken.tafel.waechter.titel': 'Bezwungene Wächter',
  'recken.tafel.waechter.spalte': 'Wächter',
  'recken.tafel.fahrt.titel': 'Zeit auf Fahrt',
  'recken.tafel.fahrt.spalte': 'Stunden',
  'recken.tafel.hel.titel': 'Selten gefallen',
  'recken.tafel.hel.spalte': 'Fahrten nach Hel',

  /* ----------------------------------------------------- Reckenprofil */
  'reckenprofil.slot.kopf': 'Kopf',
  'reckenprofil.slot.brust': 'Brust',
  'reckenprofil.slot.beine': 'Beine',
  'reckenprofil.slot.umhang': 'Umhang',
  'reckenprofil.slot.waffe': 'Waffe',
  'reckenprofil.slot.nebenhand': 'Nebenhand',
  'reckenprofil.slot.werkzeug': 'Werkzeug',
  'reckenprofil.slot.guertel': 'Gürtel',
  'reckenprofil.slot.guete': 'Güte',
  'reckenprofil.slot.leer': '— leer —',
  'reckenprofil.runenrang': 'Runenrang',
  'reckenprofil.zuletzt_gesehen': 'zuletzt gesehen',
  'reckenprofil.wert.leben': 'Leben',
  'reckenprofil.wert.ausdauer': 'Ausdauer',
  'reckenprofil.wert.eitr': 'Eitr',
  'reckenprofil.wert.traglast': 'Traglast',
  'reckenprofil.wert.auf_fahrt': 'auf Fahrt',
  'reckenprofil.wert.hel': 'Fahrten nach Hel',
  'reckenprofil.ausruestung.titel': 'Ausrüstung',
  'reckenprofil.figur.aria': 'Umriss eines Recken',
  'reckenprofil.fertigkeiten.titel': 'Fertigkeiten',
  'reckenprofil.waechter.titel': 'Bezwungene Wächter',
  'reckenprofil.waechter.von': 'von',
  'reckenprofil.lande.titel': 'Bereiste Lande',
  'reckenprofil.trophaeen.titel': 'Trophäen',
  'reckenprofil.erschaffen': 'Erschaffen am',

  /* ------------------------------------------------------------ Thing */
  'thing.titel': 'Das Thing',
  'thing.beschreibung':
    'Das Thing wird das Forum von World of Vikings: Bretter für Bauwerke, Fahrten, Ausrüstung und Sippen.',
  'thing.ueberschrift': 'Das Thing',
  /* Der Name steht im Satz kursiv; darum zwei Bausteine und ein <i> im Markup. */
  'thing.einleitung.name': 'Thing',
  'thing.einleitung.vorn': 'Das',
  'thing.einleitung.hinten':
    'war bei den Nordleuten die Versammlung der Freien: Dort wurde beraten, gestritten und Recht gesprochen — jeder mit Stimme, keiner mit letztem Wort. Genau das soll das Forum von World of Vikings werden.',
  'thing.hinweis.fett': 'Noch nicht einberufen.',
  'thing.hinweis.text':
    'Unten steht, welche Bretter geplant sind. Schreiben kann hier noch niemand — die Seite hält den Platz und das Aussehen bereit.',
  'thing.bretter.ueberschrift': 'Die geplanten Bretter',
  'thing.bretter.tabelle.brett': 'Brett',
  'thing.bretter.tabelle.wofuer': 'Wofür',
  'thing.bretter.tabelle.beitraege': 'Beiträge',
  'thing.bretter.methalle.name': 'Die Met-Halle',
  'thing.bretter.methalle.beschreibung':
    'Alles, was keinen eigenen Platz hat. Vorstellen, plaudern, streiten.',
  'thing.bretter.hoefe.name': 'Höfe & Langhäuser',
  'thing.bretter.hoefe.beschreibung': 'Bauwerke zeigen, Statik-Kniffe teilen, Grundrisse tauschen.',
  'thing.bretter.fahrten.name': 'Fahrten & Fundstücke',
  'thing.bretter.fahrten.beschreibung':
    'Wo liegt was. Karten, Verliese, gute Plätze für den nächsten Hafen.',
  'thing.bretter.waffen.name': 'Waffen & Rüstung',
  'thing.bretter.waffen.beschreibung': 'Was trägt man gegen wen. Direkter Draht zur Rüstkammer.',
  'thing.bretter.sippen.name': 'Sippen & Verabredungen',
  'thing.bretter.sippen.beschreibung':
    'Mitstreiter suchen, Sippen gründen, den Zug gegen Moder planen.',
  'thing.bretter.schmiede.name': 'Die Schmiede',
  'thing.bretter.schmiede.beschreibung':
    'Fehler melden, Vorschläge machen, über die Technik reden.',
  'thing.anschluss.ueberschrift': 'Wie es angeschlossen wird',
  'thing.anschluss.ort.titel': 'Eigener Ort, gleiche Hülle',
  /* Drei Bausteine, weil zwei <code>-Schnipsel mitten im Satz stehen. */
  'thing.anschluss.ort.text_1': 'Das Forum bekommt einen eigenen Dienst unter',
  'thing.anschluss.ort.text_2':
    '. Der Nginx im Container hat den Ort bereits vorgesehen — es fehlt nur das',
  'thing.anschluss.ort.text_3': 'auf die Software. Kopf, Fuß und Palette kommen aus',
  'thing.anschluss.ort.text_4': ', damit das Forum nicht wie ein Fremdkörper aussieht.',
  'thing.anschluss.konto.titel': 'Ein Konto für alles',
  'thing.anschluss.konto.text':
    'Sobald das Spiel Konten kennt, meldet man sich einmal an — für Spiel, Rüstkammer und Thing. Bis dahin gibt es bewusst keine Anmeldung, denn ein Forumskonto, das später nicht zum Spielkonto passt, macht mehr Ärger als es wert ist.',
  'thing.anschluss.recke.titel': 'Recke am Beitrag',
  'thing.anschluss.recke.text_1':
    'Jeder Beitrag soll den Recken des Schreibers zeigen — Name, Sippe, Runenrang — verlinkt in die Rüstkammer. Die Daten dafür liegen schon im richtigen Format unter',
  'thing.anschluss.recke.text_2': '.',
  'thing.anschluss.lesen.titel': 'Erst lesen, dann schreiben',
  'thing.anschluss.lesen.text':
    'Das Thing wird ohne Anmeldung lesbar sein. Wer schreiben will, braucht ein Konto — das hält Suchmaschinen drin und Werbemüll draußen.',
  'thing.cta': 'Solange lieber auf Fahrt gehen',

  /* -------------------------------------------------------- erstellen */
  /* `{…}` sind Platzhalter, die die Seite selbst füllt (`fuelle()` in
     `erstellen/+page.svelte`) — sie sind kein Format, das eine Bibliothek
     auswertet. Sie stehen nur in Fehlertexten der Bühne, wo eine Zahl oder
     eine Systemmeldung mitten im Satz landet. */
  'erstellen.kopf.titel': 'Charakter erstellen',
  'erstellen.kopf.beschreibung':
    'Wähle Aussehen und Ausrüstung deiner Wikingerin und geh auf Fahrt.',
  'erstellen.titel': 'Charakter erstellen',
  'erstellen.einleitung':
    'Wähle Aussehen und Ausrüstung — die Vorschau zeigt dich, wie du in Midgard stehst.',
  'erstellen.aussehen.titel': 'Aussehen',
  'erstellen.aussehen.figur.label': 'Figur',
  'erstellen.aussehen.frisur.label': 'Frisur',
  'erstellen.aussehen.frisur.vorige': 'Vorige Frisur',
  'erstellen.aussehen.frisur.naechste': 'Nächste Frisur',
  'erstellen.aussehen.oberkoerper.label': 'Oberkörper',
  'erstellen.aussehen.oberkoerper.voriges': 'Voriges Teil',
  'erstellen.aussehen.oberkoerper.nichts': '— nichts —',
  'erstellen.aussehen.oberkoerper.naechstes': 'Nächstes Teil',
  'erstellen.aussehen.beine.label': 'Beine',
  'erstellen.aussehen.beine.voriges': 'Voriges Teil',
  'erstellen.aussehen.beine.nichts': '— nichts —',
  'erstellen.aussehen.beine.naechstes': 'Nächstes Teil',
  'erstellen.buehne.hinweis.laedt': 'Figur wird geladen …',
  'erstellen.buehne.hinweis.datei_erreichbar':
    'Datei erreichbar ({status}), aber der Lader kam nicht damit zurecht.',
  'erstellen.buehne.hinweis.server_status': 'Server antwortet mit {status}.',
  'erstellen.buehne.hinweis.kein_zugriff': 'Kein Zugriff über die Domaingrenze ({fehler}).',
  'erstellen.buehne.hinweis.nicht_geladen': 'Figur nicht geladen — {grund}',
  'erstellen.buehne.hinweis.listen_fehlen':
    'Die Auswahllisten fehlen — assets/aussehen.json nicht erreichbar.',
  'erstellen.buehne.hinweis.modul_fehlt': 'Vorschau-Modul nicht ladbar — {fehler}',
  'erstellen.buehne.dreh_links': 'Drehen',
  'erstellen.buehne.dreh_rechts': 'Drehen',
  'erstellen.buehne.blick_zurueck': 'Blick zurücksetzen',
  'erstellen.fahrt.titel': 'Fahrt',
  'erstellen.fahrt.name.label': 'Name',
  'erstellen.fahrt.name.platzhalter': 'Wie man dich ruft',
  'erstellen.fahrt.name.hilfe':
    '2 bis 24 Zeichen. Jeden Namen gibt es auf einem Gestade nur einmal.',
  'erstellen.fahrt.gestade.label': 'Gestade',
  'erstellen.fahrt.gestade.dev': 'Testgestade — hier wird gebaut',
  'erstellen.fahrt.gestade.live': 'Midgard — das offene Land',
  'erstellen.fahrt.gestade.hinweis.dev':
    'Hier wird gebaut — Welt und Fortschritt können jederzeit zurückgesetzt werden.',
  'erstellen.fahrt.gestade.hinweis.live': 'Das offene Land. Hier bleibt, was du baust.',
  'erstellen.fahrt.zeit.label': 'Uhrzeit',
  'erstellen.fahrt.zeit.serverzeit': 'Serverzeit übernehmen',
  'erstellen.fahrt.zeit.hinweis':
    'Setzt die Weltzeit für alle auf dem Testgestade — dort ist jeder Admin.',
  'erstellen.fuss.hinweis': 'Ziehen dreht die Figur, Rad zoomt.',
  'erstellen.fuss.zurueck': 'Zurück',
  'erstellen.knopf.losfahren': 'Auf Fahrt gehen',
  'erstellen.knopf.laeuft': 'Recke wird angelegt …',
  /* Die Anmeldesperre. Das ist der Zustand, den auch ein Browser ohne
     JavaScript zu sehen bekommt — deshalb erklärt er sich vollständig. */
  'erstellen.sperre.titel': 'Erst anmelden',
  'erstellen.sperre.text':
    'Ein Recke gehört zu einem Konto, darum steht die Bühne erst offen, wenn du angemeldet bist. Ein Konto ist in einer Minute angelegt: Benutzername, E-Mail, Passwort — die Adresse wird nicht geprüft, das Konto steht sofort.',
  'erstellen.sperre.anmelden': 'Anmelden',
  'erstellen.sperre.registrieren': 'Konto anlegen',
  'erstellen.zu_konto': 'Deine Recken',

  /* ------------------------------------------------------------ Konto */
  /* Gemeinsame Texte der Kontoseiten (/registrieren, /anmelden, /konto)
     und der Anmeldesperre auf /erstellen. */
  'konto.gestade.hilfe':
    'Jedes Gestade führt seine eigenen Konten — ein Konto vom Testgestade gibt es auf Midgard nicht.',
  /* Steht dort, wo mit JavaScript der Absendeknopf sitzt. Ein Knopf, der
     ohne Skript nichts tut, wäre schlimmer als ein Satz, der es erklärt. */
  'konto.ohne_js':
    'Zum Absenden dieses Formulars wird JavaScript gebraucht. Ohne Skript bleibt die Seite lesbar — sie zeigt dann aber keinen Knopf, der ohnehin nichts täte.',
  'konto.abmelden': 'Abmelden',

  /* Die API antwortet mit Schlüsseln, nicht mit Sätzen. Genau deshalb
     stehen die Sätze hier und gibt es sie in beiden Sprachen. */
  'konto.fehler.benutzername_ungueltig':
    'Benutzername: 3 bis 24 Zeichen, nur Buchstaben, Ziffern, _ oder -.',
  'konto.fehler.email_ungueltig': 'Das sieht nicht nach einer gültigen E-Mail-Adresse aus.',
  'konto.fehler.passwort_zu_kurz': 'Das Passwort muss mindestens 8 Zeichen lang sein.',
  'konto.fehler.benutzername_vergeben': 'Diesen Benutzernamen trägt schon jemand.',
  'konto.fehler.anmeldung_fehlgeschlagen': 'Benutzername oder Passwort stimmt nicht.',
  'konto.fehler.zu_viele_versuche':
    'Zu viele Fehlversuche — bitte in einigen Minuten noch einmal versuchen.',
  'konto.fehler.nicht_angemeldet': 'Deine Sitzung ist abgelaufen — bitte melde dich erneut an.',
  'konto.fehler.name_ungueltig':
    'Name des Recken: 2 bis 24 Zeichen, Buchstaben, Ziffern, Leerzeichen, _ oder -.',
  'konto.fehler.name_vergeben': 'Diesen Namen trägt schon ein anderer Recke.',
  'konto.fehler.unbekannt':
    'Diesen Recken gibt es nicht mehr — schon gelöscht, oder er gehört zu einem anderen Konto.',
  'konto.fehler.kaputter_koerper': 'Die Anfrage kam beschädigt an — bitte noch einmal versuchen.',
  'konto.fehler.serverfehler':
    'Das Gestade antwortet mit einem Fehler — bitte später noch einmal versuchen.',
  'konto.fehler.netzwerk': 'Das Gestade ist nicht erreichbar — bitte die Verbindung prüfen.',
  'konto.fehler.unerwartet': 'Unerwartete Antwort vom Gestade — bitte die Seite neu laden.',

  /* ------------------------------------------------------ registrieren */
  'registrieren.kopf.titel': 'Konto anlegen',
  'registrieren.kopf.beschreibung':
    'Leg ein Konto auf einem Gestade von World of Vikings an — Benutzername, E-Mail, Passwort, fertig.',
  'registrieren.ueberschrift': 'Konto anlegen',
  'registrieren.einleitung':
    'Ein Konto hält deine Recken fest. Es entsteht sofort: Die E-Mail-Adresse wird gespeichert, aber nicht geprüft.',
  'registrieren.benutzername.label': 'Benutzername',
  'registrieren.benutzername.platzhalter': 'Wie du dich anmeldest',
  'registrieren.benutzername.hilfe': '3 bis 24 Zeichen: Buchstaben, Ziffern, _ oder -.',
  'registrieren.email.label': 'E-Mail',
  'registrieren.email.platzhalter': 'du@beispiel.de',
  'registrieren.email.hilfe':
    'Wird gespeichert, aber weder geprüft noch bestätigt. Sie ist deshalb kein Nachweis und taugt für sich allein nicht dazu, ein Passwort zurückzusetzen.',
  'registrieren.passwort.label': 'Passwort',
  'registrieren.passwort.hilfe': 'Mindestens 8 Zeichen.',
  'registrieren.passwort2.label': 'Passwort wiederholen',
  'registrieren.passwort2.hilfe': 'Wird nur hier im Browser verglichen und niemals mitgeschickt.',
  'registrieren.fehler.ungleich': 'Die beiden Passwörter stimmen nicht überein.',
  'registrieren.knopf': 'Konto erstellen',
  'registrieren.knopf.laeuft': 'Konto wird angelegt …',
  'registrieren.wechsel.text': 'Schon ein Konto?',
  'registrieren.wechsel.link': 'Hier anmelden',

  /* ---------------------------------------------------------- anmelden */
  'anmelden.kopf.titel': 'Anmelden',
  'anmelden.kopf.beschreibung':
    'Melde dich an deinem Gestade an und geh mit deinen Recken auf Fahrt.',
  'anmelden.ueberschrift': 'Anmelden',
  'anmelden.einleitung': 'Melde dich an, um deine Recken zu sehen und auf Fahrt zu gehen.',
  'anmelden.benutzername.label': 'Benutzername',
  'anmelden.passwort.label': 'Passwort',
  'anmelden.knopf': 'Anmelden',
  'anmelden.knopf.laeuft': 'Wird angemeldet …',
  'anmelden.wechsel.text': 'Noch kein Konto?',
  'anmelden.wechsel.link': 'Eines anlegen',
  'anmelden.abgelaufen': 'Deine Sitzung ist abgelaufen — bitte melde dich erneut an.',

  /* ------------------------------------------------------- Kontoseite */
  'konto.seite.kopf.titel': 'Deine Recken',
  'konto.seite.kopf.beschreibung':
    'Deine Recken auf einen Blick: auf Fahrt gehen, neue erschaffen, alte ziehen lassen.',
  'konto.seite.ueberschrift': 'Deine Recken',
  'konto.seite.unerreichbar.titel': 'Das Gestade antwortet nicht',
  'konto.seite.unerreichbar.nochmal': 'Noch einmal versuchen',
  'konto.seite.gesperrt.titel': 'Nicht angemeldet',
  'konto.seite.gesperrt.text':
    'Wer angemeldet ist, sieht hier seine Recken. Diese Seite wird einmal zur Bauzeit gebaut und weiss deshalb nichts über dich, bis dein Browser das Gestade danach fragt.',
  'konto.seite.gesperrt.anmelden': 'Anmelden',
  'konto.seite.gesperrt.registrieren': 'Konto anlegen',
  'konto.seite.laedt': 'Deine Recken werden geholt …',
  'konto.seite.angemeldet_als': 'Angemeldet als',
  'konto.seite.email': 'E-Mail',
  'konto.seite.leer': 'Auf diesem Gestade steht noch kein Recke. Erschaffe den ersten.',
  'konto.seite.erschaffen': 'erschaffen am',
  'konto.seite.zuletzt': 'zuletzt auf Fahrt',
  'konto.seite.nie': 'noch nie auf Fahrt',
  'konto.seite.knopf.neu': 'Neuen Recken erschaffen',
  'konto.seite.knopf.loeschen': 'Löschen',
  'konto.seite.loeschen.frage':
    'Diesen Recken endgültig löschen? Das lässt sich nicht rückgängig machen.',
  'konto.seite.loeschen.ja': 'Ja, löschen',
  'konto.seite.loeschen.nein': 'Doch nicht',
  'konto.seite.loeschen.war_weg': 'Dieser Recke war schon gelöscht.',
  'konto.seite.spielen.laeuft': 'Ticket wird geholt …',
} as const;
