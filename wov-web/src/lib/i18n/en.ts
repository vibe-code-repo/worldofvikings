/**
 * The English catalogue.
 *
 * The `Messages` annotation below is the point of this file: it is
 * `Record<keyof typeof de, string>`, so a key that is missing here — or one
 * that exists here and not in `de.ts` — is a type error. `npm run check` is
 * therefore the completeness test for the whole translation, and it is the
 * only place that can be. Nothing else in the build notices a missing string;
 * it would simply render as `undefined` on the page.
 *
 * Keys are kept in the same order and under the same section headings as in
 * `de.ts`, so the two files diff against each other line by line.
 */
import type { Messages } from './types';

export const en: Messages = {
  /* ------------------------------------------------------------- Kopf */
  'kopf.marke': 'World of Vikings',
  'kopf.nav.aria': 'Main navigation',
  'kopf.bald': 'soon',
  'kopf.fahrt.knopf': 'Set Sail',
  'kopf.sprache.aria': 'Language',

  /* --------------------------------------------------------- MobilNav */
  'mobilnav.nav.aria': 'Main navigation (narrow)',
  'mobilnav.fahrt.vorlesen': 'Set Sail',

  /* ------------------------------------------------------------- Fuss */
  'fuss.marke': 'WORLD OF VIKINGS',
  'fuss.beschreibung': 'A Viking browser game on land of its own.',
  'fuss.halle.ueberschrift': 'Hall',
  'fuss.halle.start': 'Home',
  'fuss.halle.saga': 'The Saga',
  'fuss.halle.karte': 'The Map',
  'fuss.halle.spielen': 'Play ›',
  'fuss.recken.ueberschrift': 'Heroes',
  'fuss.recken.ruestkammer': 'Armory',
  'fuss.recken.ruhmeshalle': 'Hall of Fame',
  'fuss.recken.thing': 'The Thing',
  'fuss.sprache.ueberschrift': 'Language',
  'fuss.schluss':
    '© 865–2026 World of Vikings. Forged in the halls of Midgard. No installation required.',

  /* --------------------------------------------------------- Kopfdaten */
  'kopfdaten.marke': 'World of Vikings',

  /* ----------------------------------------------------------- seiten */
  'seiten.hauptnav.halle.titel': 'Hall',
  'seiten.hauptnav.halle.kurz': 'Hall',
  'seiten.hauptnav.saga.titel': 'The Saga',
  'seiten.hauptnav.saga.kurz': 'Saga',
  'seiten.hauptnav.karte.titel': 'The Map',
  'seiten.hauptnav.karte.kurz': 'Map',
  'seiten.hauptnav.ruestkammer.titel': 'Armory',
  'seiten.hauptnav.ruhmeshalle.titel': 'Hall of Fame',
  'seiten.hauptnav.ruhmeshalle.kurz': 'Fame',
  'seiten.hauptnav.thing.titel': 'The Thing',
  'seiten.hauptnav.thing.kurz': 'Thing',

  /* ------------------------------------------------------------ Halle */
  'halle.kopf.titel': 'World of Vikings — A Viking Browser Game',
  'halle.kopf.beschreibung':
    'Saxons against Vikings. A browser game with no download: explore the world, build, and fell the guardians of Midgard.',
  'halle.held.wappen_alt':
    'Crest of World of Vikings: a longship within a ring of rune-carved stones',
  'halle.held.h1': 'World of Vikings',
  'halle.held.unter':
    'Saxons against Vikings. A world of meadows, black forest, and bog, running right in your browser — no download, no sign-up. Open it and set out.',
  'halle.held.knopf.fahrt': 'Set Sail',
  'halle.held.knopf.welten': 'See the Worlds',
  'halle.held.band.offen': 'open',
  'halle.held.band.von': 'of',
  'halle.held.band.auf_fahrt': 'underway',
  'halle.held.band.geschlossen': 'closed',
  'halle.held.band.wird_geprueft': 'Bifröst — checking status …',
  'halle.held.band.frueher_stand': 'Early days.',
  'halle.held.band.aufbau': 'The world is under construction.',
  'halle.erwartet.kopf': 'What Awaits You',
  'halle.erwartet.neun_lande.bild_alt': 'Painted round shield bearing a raven sigil',
  'halle.erwartet.neun_lande.titel': 'Nine Lands',
  'halle.erwartet.neun_lande.text':
    'From the meadows through the black forest and the swamp to the mountains, the plains, and the mistlands. Every land has its own weather, its own dwellers, and its own ways to kill you.',
  'halle.erwartet.fuenf_waechter.bild_alt': 'Stone skull marked with a glowing rune',
  'halle.erwartet.fuenf_waechter.titel': 'Five Guardians',
  'halle.erwartet.fuenf_waechter.text':
    'Eikthyr, the Elder, the Bonemass, Moder, and Yagluth. Every fallen guardian opens the next land — and earns a place in your armory.',
  'halle.erwartet.bauen.bild_alt': "Smith's hammer crossed over timber beams",
  'halle.erwartet.bauen.titel': 'Build What Lasts',
  'halle.erwartet.bauen.text':
    "Longhouse, workbench, harbor. Building follows real structural physics: what isn't supported falls. What you raise in Midgard still stands tomorrow.",
  'halle.erwartet.verliese.bild_alt': 'Moss-covered cave entrance lit by torches',
  'halle.erwartet.verliese.titel': 'Dungeons from a Seed',
  'halle.erwartet.verliese.text':
    'Crypts and caves are generated from a set seed with real doors and chains of rooms — different every time, yet the same for everyone.',
  'halle.technik.kein_konto.titel': 'No Account, No Client',
  'halle.technik.kein_konto.text':
    'Your browser is the client. No install, no gigabyte-long loading bar — the world streams in as you walk.',
  'halle.technik.ehrlicher_server.titel': 'An Honest Server',
  'halle.technik.ehrlicher_server.text':
    'The rules of the game live on the server, not in your browser. What your hero can do is decided by Midgard — not by your machine.',
  'halle.welten.titel': 'The Worlds',
  'halle.welten.text':
    'Midgard is the lasting world — what stands there stays standing. The Workshop is there for experimenting and gets reset without warning.',
  'halle.welten.fehler': 'The world list is unreachable right now.',
  'halle.welten.laedt': 'Fetching the world list …',
  'halle.welten.zustand_offen': 'open',
  'halle.welten.zustand_geschlossen': 'closed',
  'halle.welten.wert.auf_fahrt': 'underway',
  'halle.welten.wert.weltzeit': 'World Time',
  'halle.welten.wert.art': 'Type',
  'halle.welten.wetter_label': 'Weather:',
  'halle.welten.saat_label': 'Seed:',
  'halle.welten.karte_link': 'See both worlds on the map ›',
  'halle.ruhmeshalle.titel': 'From the Hall of Fame',
  'halle.ruhmeshalle.spalte.raute': '#',
  'halle.ruhmeshalle.spalte.recke': 'Hero',
  'halle.ruhmeshalle.spalte.sippe': 'Clan',
  'halle.ruhmeshalle.spalte.runenrang': 'Rune Rank',
  'halle.ruhmeshalle.fehler': 'The scoreboard is veiled for now.',
  'halle.ruhmeshalle.laedt': 'loading …',
  'halle.ruhmeshalle.link': 'See the whole board ›',
  'halle.thing.titel': 'The Thing Is Being Called',
  'halle.thing.text':
    'At the Thing, free men gathered to deliberate and to judge. Ours will be the forum: a place for structures, finds, arguments over gear, and the question of who marches on Moder next.',
  'halle.thing.knopf': "What's meant to take shape there",
  'halle.saga_anriss.titel': 'News from Midgard',
  'halle.saga_anriss.fehler': 'The saga falls silent for now.',
  'halle.saga_anriss.laedt': 'loading …',
  'halle.saga_anriss.link': 'Read the whole saga ›',

  /* ------------------------------------------------------------- Saga */
  'saga.kopf.titel': 'The Saga',
  'saga.kopf.beschreibung':
    "What's happening in Midgard: news on the world, the game, and the server.",
  'saga.h1': 'The Saga',
  'saga.einleitung':
    "What's been built, changed, and repaired in Midgard — in the order it happened.",
  'saga.fehler': 'The saga falls silent for now.',
  'saga.laedt': 'Opening the saga …',
  'saga.leer': 'No entries yet.',

  /* ------------------------------------------------------------ Karte */
  'karte.titel': 'The Map',
  'karte.beschreibung':
    'The world maps of World of Vikings — Midgard and the Workshop — rendered straight from the world the server actually runs.',
  'karte.ueberschrift': 'The Map',
  'karte.einleitung':
    'This is what Midgard looks like from above. The image is no drawing — it is the world itself: the same terrain calculation the server runs when you step ashore. When the world changes, the map changes.',
  'karte.hinweis.fett': 'No JavaScript, no viewer.',
  'karte.hinweis.text': 'But the maps are also there as plain images:',
  'karte.hinweis.link_midgard': 'Midgard',
  'karte.hinweis.verbindung': 'and',
  'karte.hinweis.link_werkstatt': 'Workshop',
  'karte.cta': 'Sail there yourself',

  /* --------------------------------------------------- Kartenbetrachter */
  'kartenbetrachter.laedt': 'Fetching maps …',
  'kartenbetrachter.fehler.karten': 'The maps are unreachable right now.',
  'kartenbetrachter.fehler.karte': 'This map is unreachable right now.',
  'kartenbetrachter.flaeche.aria': 'World map — drag to pan, scroll wheel to zoom',
  'kartenbetrachter.bild.alt_vorn': 'World map of',
  'kartenbetrachter.bild.alt_hinten': 'kilometres to a side',
  'kartenbetrachter.naeher': 'Zoom in',
  'kartenbetrachter.weiter_weg': 'Zoom out',
  'kartenbetrachter.ganze_welt': 'Whole world',
  'kartenbetrachter.zeiger': 'Pointer:',
  'kartenbetrachter.stand.regionen': 'regions',
  'kartenbetrachter.stand.km_kante': 'km to a side',
  'kartenbetrachter.stand.stand': 'as of',
  'kartenbetrachter.stand.laedt': 'loading …',
  'kartenbetrachter.farben.titel': 'What the colours mean',
  'kartenbetrachter.farben.text':
    'Darker areas within a land are forest, lighter ones are higher ground. The hillshading shows slopes — that is how you read the valleys and ridges a flat colour fill would swallow.',
  'kartenbetrachter.zwei.titel': 'Two worlds, two maps',
  'kartenbetrachter.zwei.midgard.name': 'Midgard',
  'kartenbetrachter.zwei.midgard.text':
    'is the lasting world. What stands there stays standing — and the map only changes when the land itself is rebuilt.',
  'kartenbetrachter.zwei.werkstatt.name': 'The Workshop',
  'kartenbetrachter.zwei.werkstatt.text':
    'is the building site. New islands and stretches of land take shape there before they move on to Midgard; it gets reset without warning.',

  /* ------------------------------------------------------ Rüstkammer */
  'ruestkammer.titel': 'Armory',
  'ruestkammer.beschreibung':
    'Look up heroes from Midgard: gear, skills, guardians defeated, and trophies.',
  'ruestkammer.ueberschrift': 'Armory',
  'ruestkammer.einleitung':
    'Who moves through Midgard, and how: gear, skills, guardians defeated, and trophies. Search for a hero, a clan, or a byname.',
  'ruestkammer.hinweis.fett': 'Sample data for now.',
  'ruestkammer.hinweis.text':
    "The game doesn't have accounts yet, so there are no real heroes to show. But the armory itself is finished and will fill up on its own once the server starts saving characters.",
  'ruestkammer.zurueck': '‹ Back to search',
  'ruestkammer.suche.label': 'Search for a hero',
  'ruestkammer.suche.platzhalter': 'Name, byname, or clan …',
  'ruestkammer.suche.knopf': 'Search',
  'ruestkammer.zustand.fehler':
    "The armory is locked right now — the list of heroes couldn't be loaded.",
  'ruestkammer.zustand.laedt': 'Unlocking the armory …',
  'ruestkammer.zustand.leer': 'No hero by that name in the armory.',
  'ruestkammer.karte.runenrang': 'Rune rank',
  'ruestkammer.karte.zuletzt': 'last seen',

  /* ----------------------------------------------------- Ruhmeshalle */
  'ruhmeshalle.titel': 'Hall of Fame',
  'ruhmeshalle.beschreibung':
    'The leaderboards of Midgard: rune rank, guardians defeated, time spent voyaging.',
  'ruhmeshalle.ueberschrift': 'Hall of Fame',
  'ruhmeshalle.einleitung':
    'Who has made a name for themselves in Midgard. The boards are recalculated every time the world is saved.',
  'ruhmeshalle.hinweis.fett': 'Sample data for now.',
  'ruhmeshalle.hinweis.text':
    'As long as there are no accounts, the heroes shown here are made up — but the boards themselves are finished.',
  'ruhmeshalle.tabelle.raute': '#',
  'ruhmeshalle.tabelle.recke': 'Hero',
  'ruhmeshalle.tabelle.sippe': 'Clan',
  'ruhmeshalle.zustand.fehler': 'The boards are covered up right now.',
  'ruhmeshalle.zustand.laedt': 'fetching …',

  /* ----------------------------------------------- Tafeln (recken.ts) */
  'recken.tafel.rang.titel': 'Rune Rank',
  'recken.tafel.rang.spalte': 'Rank',
  'recken.tafel.waechter.titel': 'Guardians Defeated',
  'recken.tafel.waechter.spalte': 'Guardians',
  'recken.tafel.fahrt.titel': 'Time Voyaging',
  'recken.tafel.fahrt.spalte': 'Hours',
  'recken.tafel.hel.titel': 'Rarely Fallen',
  'recken.tafel.hel.spalte': 'Trips to Hel',

  /* ----------------------------------------------------- Reckenprofil */
  'reckenprofil.slot.kopf': 'Head',
  'reckenprofil.slot.brust': 'Chest',
  'reckenprofil.slot.beine': 'Legs',
  'reckenprofil.slot.umhang': 'Cape',
  'reckenprofil.slot.waffe': 'Weapon',
  'reckenprofil.slot.nebenhand': 'Off-hand',
  'reckenprofil.slot.werkzeug': 'Tool',
  'reckenprofil.slot.guertel': 'Belt',
  'reckenprofil.slot.guete': 'Quality',
  'reckenprofil.slot.leer': '— empty —',
  'reckenprofil.runenrang': 'Rune rank',
  'reckenprofil.zuletzt_gesehen': 'last seen',
  'reckenprofil.wert.leben': 'Health',
  'reckenprofil.wert.ausdauer': 'Stamina',
  'reckenprofil.wert.eitr': 'Eitr',
  'reckenprofil.wert.traglast': 'Carry weight',
  'reckenprofil.wert.auf_fahrt': 'underway',
  'reckenprofil.wert.hel': 'Trips to Hel',
  'reckenprofil.ausruestung.titel': 'Gear',
  'reckenprofil.figur.aria': 'Outline of a hero',
  'reckenprofil.fertigkeiten.titel': 'Skills',
  'reckenprofil.waechter.titel': 'Guardians defeated',
  'reckenprofil.waechter.von': 'of',
  'reckenprofil.lande.titel': 'Lands travelled',
  'reckenprofil.trophaeen.titel': 'Trophies',
  'reckenprofil.erschaffen': 'Created on',

  /* ------------------------------------------------------------ Thing */
  'thing.titel': 'The Thing',
  'thing.beschreibung':
    'The Thing will be the forum of World of Vikings: boards for buildings, voyages, gear, and clans.',
  'thing.ueberschrift': 'The Thing',
  'thing.einleitung.name': 'Thing',
  'thing.einleitung.vorn': 'Among the Norse, the',
  'thing.einleitung.hinten':
    "was the assembly of free men: a place to debate, argue, and pass judgment — everyone had a voice, no one had the final word. That's exactly what the World of Vikings forum is meant to become.",
  'thing.hinweis.fett': 'Not yet convened.',
  'thing.hinweis.text':
    'Below is a list of the boards that are planned. No one can post here yet — this page just holds the place and look ready.',
  'thing.bretter.ueberschrift': 'The planned boards',
  'thing.bretter.tabelle.brett': 'Board',
  'thing.bretter.tabelle.wofuer': 'What for',
  'thing.bretter.tabelle.beitraege': 'Posts',
  'thing.bretter.methalle.name': 'The Mead Hall',
  'thing.bretter.methalle.beschreibung':
    "Anything that doesn't have its own place. Introductions, small talk, arguments.",
  'thing.bretter.hoefe.name': 'Steadings & Longhouses',
  'thing.bretter.hoefe.beschreibung':
    'Show off your buildings, share structural tricks, swap floor plans.',
  'thing.bretter.fahrten.name': 'Voyages & Finds',
  'thing.bretter.fahrten.beschreibung':
    'What lies where. Maps, dungeons, good spots for the next harbor.',
  'thing.bretter.waffen.name': 'Weapons & Armor',
  'thing.bretter.waffen.beschreibung': 'What to wear against whom. A direct line to the armory.',
  'thing.bretter.sippen.name': 'Clans & Meetups',
  'thing.bretter.sippen.beschreibung': 'Find companions, found clans, plan the march on Moder.',
  'thing.bretter.schmiede.name': 'The Forge',
  'thing.bretter.schmiede.beschreibung': 'Report bugs, suggest ideas, talk about the tech.',
  'thing.anschluss.ueberschrift': 'How it will be connected',
  'thing.anschluss.ort.titel': 'Its own location, same shell',
  'thing.anschluss.ort.text_1': 'The forum will get its own service under',
  'thing.anschluss.ort.text_2':
    '. The Nginx in the container already has the location set up — all that is missing is the',
  'thing.anschluss.ort.text_3': 'to the software. Header, footer, and colour palette come from',
  'thing.anschluss.ort.text_4': ", so the forum doesn't feel like a foreign body.",
  'thing.anschluss.konto.titel': 'One account for everything',
  'thing.anschluss.konto.text':
    "Once the game has accounts, you'll sign in once — for the game, the armory, and the Thing. Until then, there's deliberately no login, because a forum account that later doesn't match the game account would cause more trouble than it's worth.",
  'thing.anschluss.recke.titel': 'Hero on every post',
  'thing.anschluss.recke.text_1':
    'Every post should show the hero of its writer — name, clan, rune rank — linked to the armory. The data for this already exists in the right format at',
  'thing.anschluss.recke.text_2': '.',
  'thing.anschluss.lesen.titel': 'Read first, then write',
  'thing.anschluss.lesen.text':
    'The Thing will be readable without logging in. Anyone who wants to post needs an account — that keeps search engines in and spam out.',
  'thing.cta': 'Better go voyaging in the meantime',

  /* -------------------------------------------------------- erstellen */
  'erstellen.kopf.titel': 'Create Character',
  'erstellen.kopf.beschreibung':
    'Choose the appearance and gear of your shieldmaiden, then set sail.',
  'erstellen.titel': 'Create Character',
  'erstellen.einleitung':
    "Choose your appearance and gear — the preview shows how you'll stand in Midgard.",
  'erstellen.aussehen.titel': 'Appearance',
  'erstellen.aussehen.figur.label': 'Figure',
  'erstellen.aussehen.frisur.label': 'Hair',
  'erstellen.aussehen.frisur.vorige': 'Previous hairstyle',
  'erstellen.aussehen.frisur.naechste': 'Next hairstyle',
  'erstellen.aussehen.oberkoerper.label': 'Chest',
  'erstellen.aussehen.oberkoerper.voriges': 'Previous piece',
  'erstellen.aussehen.oberkoerper.nichts': '— none —',
  'erstellen.aussehen.oberkoerper.naechstes': 'Next piece',
  'erstellen.aussehen.beine.label': 'Legs',
  'erstellen.aussehen.beine.voriges': 'Previous piece',
  'erstellen.aussehen.beine.nichts': '— none —',
  'erstellen.aussehen.beine.naechstes': 'Next piece',
  'erstellen.buehne.hinweis.laedt': 'Loading figure …',
  'erstellen.buehne.hinweis.datei_erreichbar':
    'File reachable ({status}), but the loader could not handle it.',
  'erstellen.buehne.hinweis.server_status': 'Server responded with {status}.',
  'erstellen.buehne.hinweis.kein_zugriff': 'No access across the domain boundary ({fehler}).',
  'erstellen.buehne.hinweis.nicht_geladen': 'Figure not loaded — {grund}',
  'erstellen.buehne.hinweis.listen_fehlen':
    'The selection lists are missing — assets/aussehen.json is unreachable.',
  'erstellen.buehne.hinweis.modul_fehlt': 'Preview module could not be loaded — {fehler}',
  'erstellen.buehne.dreh_links': 'Rotate',
  'erstellen.buehne.dreh_rechts': 'Rotate',
  'erstellen.buehne.blick_zurueck': 'Reset view',
  'erstellen.fahrt.titel': 'Voyage',
  'erstellen.fahrt.name.label': 'Name',
  'erstellen.fahrt.name.platzhalter': 'What they will call you',
  'erstellen.fahrt.name.hilfe': '2 to 24 characters. Each name exists only once on a shore.',
  'erstellen.fahrt.gestade.label': 'Shore',
  'erstellen.fahrt.gestade.dev': 'Test Shore — under construction',
  'erstellen.fahrt.gestade.live': 'Midgard — the open land',
  'erstellen.fahrt.gestade.hinweis.dev':
    'Under construction — the world and your progress may be reset at any time.',
  'erstellen.fahrt.gestade.hinweis.live': 'The open land. What you build here stays.',
  'erstellen.fahrt.zeit.label': 'Time of Day',
  'erstellen.fahrt.zeit.serverzeit': 'Use server time',
  'erstellen.fahrt.zeit.hinweis':
    'Sets the world time for everyone on the Test Shore — there, everyone is an admin.',
  'erstellen.fuss.hinweis': 'Drag to rotate the figure, scroll to zoom.',
  'erstellen.fuss.zurueck': 'Back',
  'erstellen.knopf.losfahren': 'Set Sail',
  'erstellen.knopf.laeuft': 'Creating your hero …',
  'erstellen.sperre.titel': 'Sign in first',
  'erstellen.sperre.text':
    'A hero belongs to an account, so the stage only opens once you are signed in. An account takes a minute: username, e-mail, password — the address is never verified, the account works right away.',
  'erstellen.sperre.anmelden': 'Sign in',
  'erstellen.sperre.registrieren': 'Create an account',
  'erstellen.zu_konto': 'Your heroes',

  /* ------------------------------------------------------------ Konto */
  'konto.gestade.hilfe':
    'Every shore keeps its own accounts — an account from the Test Shore does not exist on Midgard.',
  'konto.ohne_js':
    'Submitting this form needs JavaScript. Without scripting the page stays readable — it simply shows no button that would do nothing anyway.',
  'konto.abmelden': 'Sign out',

  'konto.fehler.benutzername_ungueltig':
    'Username: 3 to 24 characters, only letters, digits, _ or -.',
  'konto.fehler.email_ungueltig': 'That does not look like a valid e-mail address.',
  'konto.fehler.passwort_zu_kurz': 'The password must be at least 8 characters long.',
  'konto.fehler.benutzername_vergeben': 'Somebody already carries that username.',
  'konto.fehler.anmeldung_fehlgeschlagen': 'Username or password is wrong.',
  'konto.fehler.zu_viele_versuche': 'Too many failed attempts — please try again in a few minutes.',
  'konto.fehler.nicht_angemeldet': 'Your session has expired — please sign in again.',
  'konto.fehler.name_ungueltig':
    "Hero's name: 2 to 24 characters, letters, digits, spaces, _ or -.",
  'konto.fehler.name_vergeben': 'Another hero already carries that name.',
  'konto.fehler.unbekannt':
    'That hero is gone — already deleted, or they belong to a different account.',
  'konto.fehler.kaputter_koerper': 'The request arrived damaged — please try again.',
  'konto.fehler.serverfehler': 'The shore answered with an error — please try again later.',
  'konto.fehler.netzwerk': 'The shore cannot be reached — please check your connection.',
  'konto.fehler.unerwartet': 'Unexpected answer from the shore — please reload the page.',

  /* ------------------------------------------------------ registrieren */
  'registrieren.kopf.titel': 'Create an account',
  'registrieren.kopf.beschreibung':
    'Create an account on a World of Vikings shore — username, e-mail, password, done.',
  'registrieren.ueberschrift': 'Create an account',
  'registrieren.einleitung':
    'An account keeps your heroes. It works immediately: the e-mail address is stored, but never verified.',
  'registrieren.benutzername.label': 'Username',
  'registrieren.benutzername.platzhalter': 'How you sign in',
  'registrieren.benutzername.hilfe': '3 to 24 characters: letters, digits, _ or -.',
  'registrieren.email.label': 'E-mail',
  'registrieren.email.platzhalter': 'you@example.com',
  'registrieren.email.hilfe':
    'Stored, but neither checked nor confirmed. It is therefore no proof of anything and cannot on its own reset a password.',
  'registrieren.passwort.label': 'Password',
  'registrieren.passwort.hilfe': 'At least 8 characters.',
  'registrieren.passwort2.label': 'Repeat password',
  'registrieren.passwort2.hilfe': 'Compared here in the browser only, and never sent.',
  'registrieren.fehler.ungleich': 'The two passwords do not match.',
  'registrieren.knopf': 'Create account',
  'registrieren.knopf.laeuft': 'Creating account …',
  'registrieren.wechsel.text': 'Already have an account?',
  'registrieren.wechsel.link': 'Sign in here',

  /* ---------------------------------------------------------- anmelden */
  'anmelden.kopf.titel': 'Sign in',
  'anmelden.kopf.beschreibung': 'Sign in to your shore and set sail with your heroes.',
  'anmelden.ueberschrift': 'Sign in',
  'anmelden.einleitung': 'Sign in to see your heroes and set sail.',
  'anmelden.benutzername.label': 'Username',
  'anmelden.passwort.label': 'Password',
  'anmelden.knopf': 'Sign in',
  'anmelden.knopf.laeuft': 'Signing in …',
  'anmelden.wechsel.text': 'No account yet?',
  'anmelden.wechsel.link': 'Create one',
  'anmelden.abgelaufen': 'Your session has expired — please sign in again.',

  /* ------------------------------------------------------- Kontoseite */
  'konto.seite.kopf.titel': 'Your heroes',
  'konto.seite.kopf.beschreibung':
    'Your heroes at a glance: set sail, create new ones, let old ones go.',
  'konto.seite.ueberschrift': 'Your heroes',
  'konto.seite.unerreichbar.titel': 'The shore is not answering',
  'konto.seite.unerreichbar.nochmal': 'Try again',
  'konto.seite.gesperrt.titel': 'Not signed in',
  'konto.seite.gesperrt.text':
    'Once signed in, you see your heroes here. This page is built once at build time and therefore knows nothing about you until your browser asks the shore.',
  'konto.seite.gesperrt.anmelden': 'Sign in',
  'konto.seite.gesperrt.registrieren': 'Create an account',
  'konto.seite.laedt': 'Fetching your heroes …',
  'konto.seite.angemeldet_als': 'Signed in as',
  'konto.seite.email': 'E-mail',
  'konto.seite.leer': 'No hero stands on this shore yet. Create the first one.',
  'konto.seite.erschaffen': 'created on',
  'konto.seite.zuletzt': 'last voyage',
  'konto.seite.nie': 'never sailed',
  'konto.seite.knopf.neu': 'Create a new hero',
  'konto.seite.knopf.loeschen': 'Delete',
  'konto.seite.loeschen.frage': 'Delete this hero for good? This cannot be undone.',
  'konto.seite.loeschen.ja': 'Yes, delete',
  'konto.seite.loeschen.nein': 'Never mind',
  'konto.seite.loeschen.war_weg': 'That hero was already deleted.',
  'konto.seite.spielen.laeuft': 'Fetching a ticket …',
};
