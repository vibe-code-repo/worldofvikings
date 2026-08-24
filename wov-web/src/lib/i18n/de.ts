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
  /* ----------------------------------------------------------- header */
  'header.brand': 'World of Vikings',
  'header.nav.aria': 'Hauptnavigation',
  /* Rendered by CSS (`content: attr(data-bald)`) after a nav entry. */
  'header.soon': 'bald',
  'header.voyage.button': 'Auf Fahrt gehen',
  /* The header bar of the "Rune & Iron" draft: one gold play button plus
     three plain links to its right. `header.voyage.button` stays as it is —
     that is the older, longer wording and still in use elsewhere. */
  'header.nav.play_button': 'Spielen',
  'header.signin.link': 'Anmelden',
  'header.account.link': 'Konto',
  'header.discord.link': 'Discord',
  'header.language.aria': 'Sprache',

  /* ------------------------------------------------------ mobile_nav */
  'mobile_nav.nav.aria': 'Hauptnavigation (schmal)',
  'mobile_nav.voyage.label': 'Auf Fahrt gehen',

  /* ----------------------------------------------------------- footer */
  'footer.brand': 'WORLD OF VIKINGS',
  'footer.description': 'Ein Wikinger-Browserspiel auf eigenem Grund.',
  'footer.hall.heading': 'Halle',
  'footer.hall.home': 'Startseite',
  'footer.hall.saga': 'Die Saga',
  'footer.hall.map': 'Die Karte',
  'footer.hall.play': 'Spielen ›',
  'footer.characters.heading': 'Recken',
  'footer.characters.armory': 'Rüstkammer',
  'footer.characters.hall_of_fame': 'Ruhmeshalle',
  'footer.characters.thing': 'Das Thing',
  'footer.language.heading': 'Sprache',
  'footer.closing':
    '© 865–2026 World of Vikings. Gefertigt in den Hallen von Midgard. Keine Installation erforderlich.',

  /* The link row and the two controls of the draft's footer. The controls
     only do anything with JavaScript; without it they are simply absent. */
  'footer.opensource.link': 'Open-Source-Projekt',
  'footer.discord.link': 'Discord',
  'footer.legal.imprint': 'Impressum',
  'footer.legal.privacy': 'Datenschutz',
  'footer.legal.terms': 'Nutzungsbedingungen',
  'footer.controls.graphics_label': 'Grafik',
  'footer.controls.graphics_option_auto': 'Auto',
  'footer.controls.graphics_option_high': 'Hoch',
  'footer.controls.graphics_option_low': 'Niedrig',
  'footer.controls.contrast_button': 'Hoher Kontrast',
  /* ------------------------------------------------------------- meta */
  /* The suffix after every page title, and the og:site_name. */
  'meta.brand': 'World of Vikings',

  /* --------------------------------------------- pages (seiten.ts) */
  /* Labels of the navigation. `title` goes into the header bar,
     `short` into the mobile bar, where there is less room. */
  'pages.main_nav.hall.title': 'Halle',
  'pages.main_nav.hall.short': 'Halle',
  'pages.main_nav.saga.title': 'Die Saga',
  'pages.main_nav.saga.short': 'Saga',
  'pages.main_nav.map.title': 'Die Karte',
  'pages.main_nav.map.short': 'Karte',
  'pages.main_nav.armory.title': 'Rüstkammer',
  'pages.main_nav.hall_of_fame.title': 'Ruhmeshalle',
  'pages.main_nav.hall_of_fame.short': 'Ruhm',
  'pages.main_nav.thing.title': 'Das Thing',
  'pages.main_nav.thing.short': 'Thing',

  'pages.main_nav.wiki.title': 'Wiki',
  'pages.main_nav.wiki.short': 'Wiki',
  /* ------------------------------------------------------------- hall */
  'hall.meta.title': 'World of Vikings — Ein Wikinger-Browserspiel',
  'hall.meta.description':
    'Angelsachsen gegen Wikinger. Ein Browserspiel ohne Download: Welt erkunden, bauen, die Wächter Midgards bezwingen.',
  /* The gate — the draft's new opening of the hall: eyebrow, one paragraph,
     the play button, the early-access note, the call to Discord. It stands
     beside the older hero block; which of the two a page shows is decided in
     the markup, not here. */
  'hall.gate.eyebrow': 'Offizielle Seite von World of Vikings',
  'hall.gate.intro':
    'world-of-vikings.com ist das offizielle Browserspiel um Midgard: Angelsachsen gegen Wikinger, neun Lande, fünf Wächter. Kein Download, kein Client — Welt erkunden, bauen, bestehen. Karte, Saga und Ruhmeshalle liegen auf dieser Seite.',
  'hall.gate.play_button': 'Spielen',
  'hall.gate.early_access_text':
    'Midgard ist im Aufbau. Was gebaut wird, bleibt stehen — aber Regeln, Welten und Werte können sich noch ändern.',
  'hall.gate.discord_cta': 'Tritt dem Thing auf Discord bei',
  'hall.gate.world_badge_closed': 'zu',
  'hall.hero.crest_alt': 'Wappen von World of Vikings: ein Langschiff in einem Steinring aus Runen',
  'hall.hero.heading': 'World of Vikings',
  'hall.hero.subtitle':
    'Angelsachsen gegen Wikinger. Eine Welt aus Wiesen, Schwarzwald und Sumpf, die im Browser läuft — kein Download, keine Anmeldung. Öffnen und loslaufen.',
  'hall.hero.button.voyage': 'Auf Fahrt gehen',
  'hall.hero.button.worlds': 'Die Welten sehen',
  /* The Bifröst ribbon is assembled in the markup from the world name,
     numbers and these four blocks: "Midgard open — 3 of 20 underway". */
  'hall.hero.ribbon.open': 'offen',
  'hall.hero.ribbon.of': 'von',
  'hall.hero.ribbon.underway': 'auf Fahrt',
  'hall.hero.ribbon.closed': 'geschlossen',
  'hall.hero.ribbon.checking': 'Bifröst — Zustand wird geprüft …',
  'hall.hero.ribbon.early_days': 'Früher Stand.',
  'hall.hero.ribbon.under_construction': 'Die Welt ist im Aufbau.',
  'hall.awaits.heading': 'Was dich erwartet',
  'hall.awaits.nine_lands.image_alt': 'Bemalter Rundschild mit Rabenzeichen',
  'hall.awaits.nine_lands.title': 'Neun Lande',
  'hall.awaits.nine_lands.text':
    'Von den Wiesen über den Schwarzwald und den Sumpf bis in die Berge, die Ebenen und das Nebelland. Jedes Land hat eigenes Wetter, eigene Bewohner und eigene Wege, dich umzubringen.',
  'hall.awaits.five_guardians.image_alt': 'Steinerner Schädel mit leuchtender Rune',
  'hall.awaits.five_guardians.title': 'Fünf Wächter',
  'hall.awaits.five_guardians.text':
    'Eikthyr, der Älteste, die Knochenmasse, Moder und Yagluth. Jeder gefallene Wächter öffnet das nächste Land — und trägt sich in deine Rüstkammer ein.',
  'hall.awaits.building.image_alt': 'Schmiedehammer über gekreuzten Balken',
  'hall.awaits.building.title': 'Bauen, was bleibt',
  'hall.awaits.building.text':
    'Langhaus, Werkbank, Hafen. Der Bau folgt echter Statik: Was nicht getragen wird, fällt. Was du in Midgard errichtest, steht auch morgen noch.',
  'hall.awaits.dungeons.image_alt': 'Moosbewachsener Höhleneingang mit Fackeln',
  'hall.awaits.dungeons.title': 'Verliese mit Saat',
  'hall.awaits.dungeons.text':
    'Gruften und Höhlen entstehen aus gesetzter Saat mit echten Türen und Raumketten — bei jedem neu, aber für alle gleich.',
  'hall.technology.no_account.title': 'Kein Konto, kein Client',
  'hall.technology.no_account.text':
    'Der Browser ist der Client. Keine Installation, kein Ladebalken über Gigabyte — die Welt wird gestreamt, während du gehst.',
  'hall.technology.honest_server.title': 'Ein ehrlicher Server',
  'hall.technology.honest_server.text':
    'Die Spielregeln liegen beim Server, nicht im Browser. Was dein Recke kann, entscheidet Midgard — nicht dein Rechner.',
  'hall.worlds.title': 'Die Welten',
  'hall.worlds.text':
    'Midgard ist die bleibende Welt — was dort steht, bleibt stehen. Die Werkstatt ist zum Ausprobieren da und wird ohne Vorwarnung zurückgesetzt.',
  'hall.worlds.error': 'Die Weltliste ist gerade nicht erreichbar.',
  'hall.worlds.loading': 'Die Weltliste wird geholt …',
  'hall.worlds.state_open': 'offen',
  'hall.worlds.state_closed': 'geschlossen',
  'hall.worlds.value.underway': 'auf Fahrt',
  'hall.worlds.value.world_time': 'Weltzeit',
  'hall.worlds.value.type': 'Art',
  'hall.worlds.weather_label': 'Wetter:',
  'hall.worlds.seed_label': 'Saat:',
  'hall.worlds.map_link': 'Beide Welten auf der Karte ansehen ›',
  'hall.hall_of_fame.title': 'Aus der Ruhmeshalle',
  'hall.hall_of_fame.column.hash': '#',
  'hall.hall_of_fame.column.character': 'Recke',
  'hall.hall_of_fame.column.clan': 'Sippe',
  'hall.hall_of_fame.column.rune_rank': 'Runenrang',
  'hall.hall_of_fame.error': 'Die Tafel ist gerade verhängt.',
  'hall.hall_of_fame.loading': 'wird geholt …',
  'hall.hall_of_fame.link': 'Die ganze Tafel ansehen ›',
  'hall.thing.title': 'Das Thing wird einberufen',
  'hall.thing.text':
    'Beim Thing versammelten sich die Freien, um zu beraten und zu richten. Unseres wird das Forum: ein Ort für Bauwerke, Fundstücke, Streit über Ausrüstung und die Frage, wer als Nächstes gegen Moder zieht.',
  'hall.thing.button': 'Was dort entstehen soll',
  'hall.saga_teaser.title': 'Neues aus Midgard',
  'hall.saga_teaser.error': 'Die Saga schweigt gerade.',
  'hall.saga_teaser.loading': 'wird geholt …',
  'hall.saga_teaser.link': 'Die ganze Saga lesen ›',

  /* ------------------------------------------------------------- saga */
  'saga.meta.title': 'Die Saga',
  'saga.meta.description': 'Was sich in Midgard tut: Neuigkeiten zu Welt, Spiel und Server.',
  'saga.heading': 'Die Saga',
  'saga.intro':
    'Was in Midgard gebaut, geändert und repariert wurde — in der Reihenfolge, in der es geschah.',
  'saga.error': 'Die Saga schweigt gerade.',
  'saga.loading': 'Die Saga wird aufgeschlagen …',
  'saga.empty': 'Noch kein Eintrag.',

  /* -------------------------------------------------------------- map */
  'map.title': 'Die Karte',
  'map.description':
    'Die Weltkarten von World of Vikings: Midgard und die Werkstatt, gerechnet aus der Welt, die der Server wirklich fährt.',
  'map.heading': 'Die Karte',
  'map.intro':
    'So sieht Midgard von oben aus. Das Bild ist keine Zeichnung, sondern die Welt selbst: dieselbe Geländeberechnung, die der Server fährt, wenn du an Land gehst. Ändert sich die Welt, ändert sich die Karte.',
  'map.hint.bold': 'Ohne JavaScript kein Betrachter.',
  'map.hint.text': 'Die Karten liegen aber als gewöhnliche Bilder bereit:',
  'map.hint.link_midgard': 'Midgard',
  'map.hint.and': 'und',
  'map.hint.link_workshop': 'Werkstatt',
  'map.cta': 'Selbst hinfahren',

  /* Heading above the biome legend next to the map. */
  'map.legend.title': 'Lande',
  /* ------------------------------ map_viewer (Kartenbetrachter.svelte) */
  'map_viewer.loading': 'Karten werden geholt …',
  'map_viewer.error.maps': 'Die Karten sind gerade nicht erreichbar.',
  'map_viewer.error.map': 'Diese Karte ist gerade nicht erreichbar.',
  'map_viewer.area.aria': 'Weltkarte — ziehen zum Schieben, Mausrad zum Zoomen',
  /* Assembled, the alt text reads: "World map of Midgard — 10.2 kilometres to a side". */
  'map_viewer.image.alt_prefix': 'Weltkarte von',
  'map_viewer.image.alt_suffix': 'Kilometer Kantenlänge',
  'map_viewer.zoom_in': 'Näher heran',
  'map_viewer.zoom_out': 'Weiter weg',
  'map_viewer.whole_world': 'Ganze Welt',
  'map_viewer.pointer': 'Zeiger:',
  'map_viewer.status.regions': 'Regionen',
  'map_viewer.status.km_side': 'km Kante',
  'map_viewer.status.as_of': 'Stand',
  'map_viewer.status.loading': 'wird geholt …',
  'map_viewer.colors.title': 'Was die Farben bedeuten',
  'map_viewer.colors.text':
    'Dunklere Flächen innerhalb eines Landes sind Wald, hellere sind höheres Gelände. Die Schummerung zeigt Hänge — so liest man Täler und Grate, die in einer flachen Einfärbung untergingen.',
  'map_viewer.two.title': 'Zwei Welten, zwei Karten',
  'map_viewer.two.midgard.name': 'Midgard',
  'map_viewer.two.midgard.text':
    'ist die bleibende Welt. Was dort steht, bleibt stehen — und die Karte ändert sich nur, wenn das Land selbst umgebaut wird.',
  'map_viewer.two.workshop.name': 'Die Werkstatt',
  'map_viewer.two.workshop.text':
    'ist der Bauplatz. Dort entstehen neue Inseln und Landstriche, bevor sie nach Midgard wandern; sie wird ohne Vorwarnung zurückgesetzt.',

  /* ----------------------------------------------------------- armory */
  'armory.title': 'Rüstkammer',
  'armory.description':
    'Sieh dir Recken aus Midgard an: Ausrüstung, Fertigkeiten, bezwungene Wächter und Trophäen.',
  'armory.heading': 'Rüstkammer',
  'armory.intro':
    'Wer wie durch Midgard zieht: Ausrüstung, Fertigkeiten, bezwungene Wächter und Trophäen. Suche nach einem Recken, einer Sippe oder einem Beinamen.',
  'armory.hint.bold': 'Noch Beispieldaten.',
  'armory.hint.text':
    'Das Spiel kennt bisher keine Konten — es gibt also noch keine echten Recken zu zeigen. Die Kammer steht aber fertig und füllt sich von selbst, sobald der Server Charaktere speichert.',
  'armory.back': '‹ Zurück zur Suche',
  'armory.search.label': 'Recke suchen',
  'armory.search.placeholder': 'Name, Beiname oder Sippe …',
  'armory.search.button': 'Suchen',
  'armory.state.error':
    'Die Kammer ist gerade verschlossen — die Reckenliste liess sich nicht laden.',
  'armory.state.loading': 'Die Kammer wird aufgeschlossen …',
  'armory.state.empty': 'Kein Recke dieses Namens in der Kammer.',
  'armory.card.rune_rank': 'Runenrang',
  'armory.card.last_seen': 'zuletzt',

  /* ---------------------------------------------------- hall_of_fame */
  'hall_of_fame.title': 'Ruhmeshalle',
  'hall_of_fame.description':
    'Die Bestenlisten aus Midgard: Runenrang, bezwungene Wächter, Zeit auf Fahrt.',
  'hall_of_fame.heading': 'Ruhmeshalle',
  'hall_of_fame.intro':
    'Wer sich in Midgard einen Namen gemacht hat. Die Tafeln werden neu berechnet, sobald die Welt gespeichert wird.',
  'hall_of_fame.hint.bold': 'Noch Beispieldaten.',
  'hall_of_fame.hint.text':
    'Solange es keine Konten gibt, stehen hier erfundene Recken — die Tafeln selbst sind fertig.',
  'hall_of_fame.table.hash': '#',
  'hall_of_fame.table.character': 'Recke',
  'hall_of_fame.table.clan': 'Sippe',
  'hall_of_fame.state.error': 'Die Tafeln sind gerade verhängt.',
  'hall_of_fame.state.loading': 'wird geholt …',

  /* ------------------------------------------ characters (recken.ts) */
  'characters.board.rank.title': 'Runenrang',
  'characters.board.rank.column': 'Rang',
  'characters.board.guardian.title': 'Bezwungene Wächter',
  'characters.board.guardian.column': 'Wächter',
  'characters.board.voyage.title': 'Zeit auf Fahrt',
  'characters.board.voyage.column': 'Stunden',
  'characters.board.hel.title': 'Selten gefallen',
  'characters.board.hel.column': 'Fahrten nach Hel',

  /* ------------------------ character_profile (Reckenprofil.svelte) */
  'character_profile.slot.head': 'Kopf',
  'character_profile.slot.chest': 'Brust',
  'character_profile.slot.legs': 'Beine',
  'character_profile.slot.cape': 'Umhang',
  'character_profile.slot.weapon': 'Waffe',
  'character_profile.slot.off_hand': 'Nebenhand',
  'character_profile.slot.tool': 'Werkzeug',
  'character_profile.slot.belt': 'Gürtel',
  'character_profile.slot.quality': 'Güte',
  'character_profile.slot.empty': '— leer —',
  'character_profile.rune_rank': 'Runenrang',
  'character_profile.last_seen': 'zuletzt gesehen',
  'character_profile.value.health': 'Leben',
  'character_profile.value.stamina': 'Ausdauer',
  'character_profile.value.eitr': 'Eitr',
  'character_profile.value.carry_weight': 'Traglast',
  'character_profile.value.underway': 'auf Fahrt',
  'character_profile.value.hel': 'Fahrten nach Hel',
  'character_profile.gear.title': 'Ausrüstung',
  'character_profile.figure.aria': 'Umriss eines Recken',
  'character_profile.skills.title': 'Fertigkeiten',
  'character_profile.guardian.title': 'Bezwungene Wächter',
  'character_profile.guardian.of': 'von',
  'character_profile.lands.title': 'Bereiste Lande',
  'character_profile.trophies.title': 'Trophäen',
  'character_profile.created': 'Erschaffen am',

  /* Sits under the character preview and says what can be done with it.
     The preview itself stays the existing Babylon bundle. */
  'character_profile.preview.hint': 'Reckenvorschau · ziehen zum Drehen',
  /* ------------------------------------------------------------ thing */
  'thing.title': 'Das Thing',
  'thing.description':
    'Das Thing wird das Forum von World of Vikings: Bretter für Bauwerke, Fahrten, Ausrüstung und Sippen.',
  'thing.heading': 'Das Thing',
  /* The name is italic inside the sentence; hence two blocks and an <i> in the markup. */
  'thing.intro.name': 'Thing',
  'thing.intro.prefix': 'Das',
  'thing.intro.suffix':
    'war bei den Nordleuten die Versammlung der Freien: Dort wurde beraten, gestritten und Recht gesprochen — jeder mit Stimme, keiner mit letztem Wort. Genau das soll das Forum von World of Vikings werden.',
  'thing.hint.bold': 'Noch nicht einberufen.',
  'thing.hint.text':
    'Unten steht, welche Bretter geplant sind. Schreiben kann hier noch niemand — die Seite hält den Platz und das Aussehen bereit.',
  'thing.boards.heading': 'Die geplanten Bretter',
  'thing.boards.table.board': 'Brett',
  'thing.boards.table.purpose': 'Wofür',
  'thing.boards.table.posts': 'Beiträge',
  'thing.boards.mead_hall.name': 'Die Met-Halle',
  'thing.boards.mead_hall.description':
    'Alles, was keinen eigenen Platz hat. Vorstellen, plaudern, streiten.',
  'thing.boards.steadings.name': 'Höfe & Langhäuser',
  'thing.boards.steadings.description':
    'Bauwerke zeigen, Statik-Kniffe teilen, Grundrisse tauschen.',
  'thing.boards.voyages.name': 'Fahrten & Fundstücke',
  'thing.boards.voyages.description':
    'Wo liegt was. Karten, Verliese, gute Plätze für den nächsten Hafen.',
  'thing.boards.weapons.name': 'Waffen & Rüstung',
  'thing.boards.weapons.description': 'Was trägt man gegen wen. Direkter Draht zur Rüstkammer.',
  'thing.boards.clans.name': 'Sippen & Verabredungen',
  'thing.boards.clans.description':
    'Mitstreiter suchen, Sippen gründen, den Zug gegen Moder planen.',
  'thing.boards.forge.name': 'Die Schmiede',
  'thing.boards.forge.description': 'Fehler melden, Vorschläge machen, über die Technik reden.',
  'thing.connection.heading': 'Wie es angeschlossen wird',
  'thing.connection.location.title': 'Eigener Ort, gleiche Hülle',
  /* Three blocks, because two <code> snippets sit inside the sentence. */
  'thing.connection.location.text_1': 'Das Forum bekommt einen eigenen Dienst unter',
  'thing.connection.location.text_2':
    '. Der Nginx im Container hat den Ort bereits vorgesehen — es fehlt nur das',
  'thing.connection.location.text_3': 'auf die Software. Kopf, Fuß und Palette kommen aus',
  'thing.connection.location.text_4': ', damit das Forum nicht wie ein Fremdkörper aussieht.',
  'thing.connection.account.title': 'Ein Konto für alles',
  'thing.connection.account.text':
    'Sobald das Spiel Konten kennt, meldet man sich einmal an — für Spiel, Rüstkammer und Thing. Bis dahin gibt es bewusst keine Anmeldung, denn ein Forumskonto, das später nicht zum Spielkonto passt, macht mehr Ärger als es wert ist.',
  'thing.connection.character.title': 'Recke am Beitrag',
  'thing.connection.character.text_1':
    'Jeder Beitrag soll den Recken des Schreibers zeigen — Name, Sippe, Runenrang — verlinkt in die Rüstkammer. Die Daten dafür liegen schon im richtigen Format unter',
  'thing.connection.character.text_2': '.',
  'thing.connection.reading.title': 'Erst lesen, dann schreiben',
  'thing.connection.reading.text':
    'Das Thing wird ohne Anmeldung lesbar sein. Wer schreiben will, braucht ein Konto — das hält Suchmaschinen drin und Werbemüll draußen.',
  'thing.cta': 'Solange lieber auf Fahrt gehen',

  /* ------------------------------------------------------------- wiki */
  /* The draft adds a wiki. No route exists for it yet — the texts come
     first, so that both catalogues stay in step with each other.
     `wiki.description` is not from the draft; it is the meta description
     every other page here has, shortened from `wiki.intro`. */
  'wiki.title': 'Das Wiki',
  'wiki.description':
    'Wie Midgard funktioniert: Lande und Wetter, die fünf Wächter, Bau und Statik, Verliese und ihre Saat.',
  'wiki.heading': 'Das Wiki',
  'wiki.intro':
    'Wie Midgard funktioniert: Lande und Wetter, die fünf Wächter, Bau und Statik, Verliese und ihre Saat. Nachgeschlagen, nicht geraten — jeder Eintrag beschreibt, was der Server tatsächlich rechnet.',
  'wiki.hint.bold': 'Im Aufbau.',
  'wiki.hint.text': 'Vier Bücher stehen, die Einträge darunter wachsen mit dem Spiel.',
  'wiki.books.lands.title': 'Neun Lande',
  'wiki.books.lands.text':
    'Wiesen, Schwarzwald, Sumpf, Berge, Ebenen, Nebelland, Aschelande — Wetter, Bewohner und Baustoffe je Land, mit den Übergängen dazwischen.',
  'wiki.books.lands.image_alt': 'Bemalter Rundschild mit Rabenzeichen',
  'wiki.books.guardians.title': 'Fünf Wächter',
  'wiki.books.guardians.text':
    'Eikthyr, der Älteste, die Knochenmasse, Moder, Yagluth: Beschwörung, Angriffsmuster, Beute — und was jeder gefallene Wächter freigibt.',
  'wiki.books.guardians.image_alt': 'Steinerner Schädel mit leuchtender Rune',
  'wiki.books.building.title': 'Bauen & Statik',
  'wiki.books.building.text':
    'Tragwerk, Spannweiten, Werkbankradius, Aufwertung bis Güte 4. Was nicht getragen wird, fällt — hier steht, was trägt.',
  'wiki.books.building.image_alt': 'Schmiedehammer über gekreuzten Balken',
  'wiki.books.dungeons.title': 'Verliese & Saat',
  'wiki.books.dungeons.text':
    'Gruften und Höhlen entstehen aus gesetzter Saat mit echten Türen und Raumketten — bei jedem neu, aber für alle gleich.',
  'wiki.books.dungeons.image_alt': 'Moosbewachsener Höhleneingang mit Fackeln',
  /* --------------------------------------------- create (/erstellen) */
  /* `{…}` are placeholders the page fills in itself (`fuelle()` in
     `erstellen/+page.svelte`) — they are not a format any library reads.
     They occur only in error texts of the stage, where a status code or a
     system message lands in the middle of a sentence. */
  'create.meta.title': 'Charakter erstellen',
  'create.meta.description': 'Wähle Aussehen und Ausrüstung deiner Wikingerin und geh auf Fahrt.',
  'create.title': 'Charakter erstellen',
  'create.intro':
    'Wähle Aussehen und Ausrüstung — die Vorschau zeigt dich, wie du in Midgard stehst.',
  'create.appearance.title': 'Aussehen',
  'create.appearance.figure.label': 'Figur',
  'create.appearance.hair.label': 'Frisur',
  'create.appearance.hair.previous': 'Vorige Frisur',
  'create.appearance.hair.next': 'Nächste Frisur',
  'create.appearance.haircolor.label': 'Haarfarbe',
  'create.appearance.chest.label': 'Oberkörper',
  'create.appearance.chest.previous': 'Voriges Teil',
  'create.appearance.chest.none': '— nichts —',
  'create.appearance.chest.next': 'Nächstes Teil',
  'create.appearance.legs.label': 'Beine',
  'create.appearance.legs.previous': 'Voriges Teil',
  'create.appearance.legs.none': '— nichts —',
  'create.appearance.legs.next': 'Nächstes Teil',
  'create.stage.hint.loading': 'Figur wird geladen …',
  'create.stage.hint.file_reachable':
    'Datei erreichbar ({status}), aber der Lader kam nicht damit zurecht.',
  'create.stage.hint.server_status': 'Server antwortet mit {status}.',
  'create.stage.hint.no_access': 'Kein Zugriff über die Domaingrenze ({fehler}).',
  'create.stage.hint.not_loaded': 'Figur nicht geladen — {grund}',
  'create.stage.hint.lists_missing':
    'Die Auswahllisten fehlen — assets/appearance.json nicht erreichbar.',
  'create.stage.hint.module_missing': 'Vorschau-Modul nicht ladbar — {fehler}',
  'create.stage.rotate_left': 'Drehen',
  'create.stage.rotate_right': 'Drehen',
  'create.stage.reset_view': 'Blick zurücksetzen',
  'create.voyage.title': 'Fahrt',
  'create.voyage.name.label': 'Name',
  'create.voyage.name.placeholder': 'Wie man dich ruft',
  'create.voyage.name.hint': '2 bis 24 Zeichen. Jeden Namen gibt es auf einem Gestade nur einmal.',
  'create.voyage.shore.label': 'Gestade',
  'create.voyage.shore.dev': 'Testgestade — hier wird gebaut',
  'create.voyage.shore.live': 'Midgard — das offene Land',
  'create.voyage.shore.hint.dev':
    'Hier wird gebaut — Welt und Fortschritt können jederzeit zurückgesetzt werden.',
  'create.voyage.shore.hint.live': 'Das offene Land. Hier bleibt, was du baust.',
  'create.voyage.time.label': 'Uhrzeit',
  'create.voyage.time.server_time': 'Serverzeit übernehmen',
  'create.voyage.time.hint':
    'Setzt die Weltzeit für alle auf dem Testgestade — dort ist jeder Admin.',
  'create.footer.hint': 'Ziehen dreht die Figur, Rad zoomt.',
  'create.footer.back': 'Zurück',
  'create.button.set_sail': 'Auf Fahrt gehen',
  'create.button.loading': 'Recke wird angelegt …',
  /* The sign-in gate. This is the state a browser without JavaScript gets
     to see as well — which is why it explains itself in full. */
  'create.gate.title': 'Erst anmelden',
  'create.gate.text':
    'Ein Recke gehört zu einem Konto, darum steht die Bühne erst offen, wenn du angemeldet bist. Ein Konto ist in einer Minute angelegt: Benutzername, E-Mail, Passwort — die Adresse wird nicht geprüft, das Konto steht sofort.',
  'create.gate.login': 'Anmelden',
  'create.gate.register': 'Konto anlegen',
  'create.to_account': 'Deine Recken',

  /* ---------------------------------------------------------- account */
  /* Texts shared by the account pages (/registrieren, /anmelden, /konto)
     and the sign-in gate on /erstellen. */
  'account.shore.hint':
    'Jedes Gestade führt seine eigenen Konten — ein Konto vom Testgestade gibt es auf Midgard nicht.',
  /* Stands where the submit button sits when JavaScript is running. A
     button that does nothing without scripting would be worse than a
     sentence that explains why there is none. */
  'account.without_js':
    'Zum Absenden dieses Formulars wird JavaScript gebraucht. Ohne Skript bleibt die Seite lesbar — sie zeigt dann aber keinen Knopf, der ohnehin nichts täte.',
  'account.logout': 'Abmelden',

  /* The API answers with keys, not with sentences. That is precisely why
     the sentences live here and exist in both languages. */
  'account.error.username_invalid':
    'Benutzername: 3 bis 24 Zeichen, nur Buchstaben, Ziffern, _ oder -.',
  'account.error.email_invalid': 'Das sieht nicht nach einer gültigen E-Mail-Adresse aus.',
  'account.error.password_too_short': 'Das Passwort muss mindestens 8 Zeichen lang sein.',
  'account.error.username_taken': 'Diesen Benutzernamen trägt schon jemand.',
  'account.error.login_failed': 'Benutzername oder Passwort stimmt nicht.',
  'account.error.too_many_attempts':
    'Zu viele Fehlversuche — bitte in einigen Minuten noch einmal versuchen.',
  'account.error.not_logged_in': 'Deine Sitzung ist abgelaufen — bitte melde dich erneut an.',
  'account.error.name_invalid':
    'Name des Recken: 2 bis 24 Zeichen, Buchstaben, Ziffern, Leerzeichen, _ oder -.',
  'account.error.name_taken': 'Diesen Namen trägt schon ein anderer Recke.',
  'account.error.unknown':
    'Diesen Recken gibt es nicht mehr — schon gelöscht, oder er gehört zu einem anderen Konto.',
  'account.error.broken_body': 'Die Anfrage kam beschädigt an — bitte noch einmal versuchen.',
  'account.error.server_error':
    'Das Gestade antwortet mit einem Fehler — bitte später noch einmal versuchen.',
  'account.error.network': 'Das Gestade ist nicht erreichbar — bitte die Verbindung prüfen.',
  'account.error.unexpected': 'Unerwartete Antwort vom Gestade — bitte die Seite neu laden.',

  /* ------------------------------------------ register (/registrieren) */
  'register.meta.title': 'Konto anlegen',
  'register.meta.description':
    'Leg ein Konto auf einem Gestade von World of Vikings an — Benutzername, E-Mail, Passwort, fertig.',
  'register.heading': 'Konto anlegen',
  'register.intro':
    'Ein Konto hält deine Recken fest. Es entsteht sofort: Die E-Mail-Adresse wird gespeichert, aber nicht geprüft.',
  'register.username.label': 'Benutzername',
  'register.username.placeholder': 'Wie du dich anmeldest',
  'register.username.hint': '3 bis 24 Zeichen: Buchstaben, Ziffern, _ oder -.',
  'register.email.label': 'E-Mail',
  'register.email.placeholder': 'du@beispiel.de',
  'register.email.hint':
    'Wird gespeichert, aber weder geprüft noch bestätigt. Sie ist deshalb kein Nachweis und taugt für sich allein nicht dazu, ein Passwort zurückzusetzen.',
  'register.password.label': 'Passwort',
  'register.password.hint': 'Mindestens 8 Zeichen.',
  'register.password_repeat.label': 'Passwort wiederholen',
  'register.password_repeat.hint': 'Wird nur hier im Browser verglichen und niemals mitgeschickt.',
  'register.error.mismatch': 'Die beiden Passwörter stimmen nicht überein.',
  'register.button': 'Konto erstellen',
  'register.button.loading': 'Konto wird angelegt …',
  'register.switch.text': 'Schon ein Konto?',
  'register.switch.link': 'Hier anmelden',

  /* ------------------------------------------------ login (/anmelden) */
  'login.meta.title': 'Anmelden',
  'login.meta.description': 'Melde dich an deinem Gestade an und geh mit deinen Recken auf Fahrt.',
  'login.heading': 'Anmelden',
  'login.intro': 'Melde dich an, um deine Recken zu sehen und auf Fahrt zu gehen.',
  'login.username.label': 'Benutzername',
  'login.password.label': 'Passwort',
  'login.button': 'Anmelden',
  'login.button.loading': 'Wird angemeldet …',
  'login.switch.text': 'Noch kein Konto?',
  'login.switch.link': 'Eines anlegen',
  'login.session_expired': 'Deine Sitzung ist abgelaufen — bitte melde dich erneut an.',

  /* -------------------------------------------- account.page (/konto) */
  'account.page.meta.title': 'Deine Recken',
  'account.page.meta.description':
    'Deine Recken auf einen Blick: auf Fahrt gehen, neue erschaffen, alte ziehen lassen.',
  'account.page.heading': 'Deine Recken',
  'account.page.intro':
    'Deine Recken auf diesem Gestade. Wähle einen aus oder erschaffe einen neuen.',
  'account.page.unreachable.title': 'Das Gestade antwortet nicht',
  'account.page.unreachable.retry': 'Noch einmal versuchen',
  'account.page.locked.title': 'Nicht angemeldet',
  'account.page.locked.text':
    'Wer angemeldet ist, sieht hier seine Recken. Diese Seite wird einmal zur Bauzeit gebaut und weiss deshalb nichts über dich, bis dein Browser das Gestade danach fragt.',
  'account.page.locked.login': 'Anmelden',
  'account.page.locked.register': 'Konto anlegen',
  'account.page.loading': 'Deine Recken werden geholt …',
  'account.page.logged_in_as': 'Angemeldet als',
  'account.page.email': 'E-Mail',
  'account.page.empty': 'Auf diesem Gestade steht noch kein Recke. Erschaffe den ersten.',
  'account.page.created': 'erschaffen am',
  'account.page.last_seen': 'zuletzt auf Fahrt',
  'account.page.never_sailed': 'noch nie auf Fahrt',
  'account.page.button.new': 'Neuen Recken erschaffen',
  'account.page.button.delete': 'Löschen',
  'account.page.delete.question':
    'Diesen Recken endgültig löschen? Das lässt sich nicht rückgängig machen.',
  'account.page.delete.yes': 'Ja, löschen',
  'account.page.delete.no': 'Doch nicht',
  'account.page.delete.already_gone': 'Dieser Recke war schon gelöscht.',
  'account.page.play.loading': 'Ticket wird geholt …',
} as const;
