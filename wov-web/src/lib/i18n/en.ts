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
  /* ----------------------------------------------------------- header */
  'header.brand': 'World of Vikings',
  'header.nav.aria': 'Main navigation',
  'header.soon': 'soon',
  'header.voyage.button': 'Set Sail',
  /* The header bar of the "Rune & Iron" draft: one gold play button plus
     three plain links to its right. `header.voyage.button` stays as it is —
     that is the older, longer wording and still in use elsewhere. */
  'header.nav.play_button': 'Play',
  'header.signin.link': 'Sign in',
  'header.account.link': 'Account',
  'header.account.signed_in_aria': 'Signed in as',
  'header.discord.link': 'Discord',
  'header.language.aria': 'Language',

  /* ------------------------------------------------------ mobile_nav */
  'mobile_nav.nav.aria': 'Main navigation (narrow)',
  'mobile_nav.voyage.label': 'Set Sail',

  /* ----------------------------------------------------------- footer */
  'footer.brand': 'WORLD OF VIKINGS',
  'footer.description': 'A Viking browser game on land of its own.',
  'footer.hall.heading': 'Hall',
  'footer.hall.home': 'Home',
  'footer.hall.saga': 'The Saga',
  'footer.hall.map': 'The Map',
  'footer.hall.play': 'Play ›',
  'footer.characters.heading': 'Heroes',
  'footer.characters.armory': 'Armory',
  'footer.characters.hall_of_fame': 'Hall of Fame',
  'footer.characters.thing': 'The Thing',
  'footer.language.heading': 'Language',
  'footer.closing':
    '© 865–2026 World of Vikings. Forged in the halls of Midgard. No installation required.',

  /* The link row and the two controls of the draft's footer. The controls
     only do anything with JavaScript; without it they are simply absent. */
  'footer.opensource.link': 'Open source project',
  'footer.discord.link': 'Discord',
  'footer.legal.imprint': 'Imprint',
  'footer.legal.privacy': 'Privacy',
  'footer.legal.terms': 'Terms of use',
  'footer.controls.graphics_label': 'Graphics',
  'footer.controls.graphics_option_auto': 'Auto',
  'footer.controls.graphics_option_high': 'High',
  'footer.controls.graphics_option_low': 'Low',
  'footer.controls.contrast_button': 'High contrast',
  /* ------------------------------------------------------------- meta */
  'meta.brand': 'World of Vikings',

  /* --------------------------------------------- pages (seiten.ts) */
  'pages.main_nav.hall.title': 'Hall',
  'pages.main_nav.hall.short': 'Hall',
  'pages.main_nav.saga.title': 'The Saga',
  'pages.main_nav.saga.short': 'Saga',
  'pages.main_nav.map.title': 'The Map',
  'pages.main_nav.map.short': 'Map',
  'pages.main_nav.armory.title': 'Armory',
  'pages.main_nav.hall_of_fame.title': 'Hall of Fame',
  'pages.main_nav.hall_of_fame.short': 'Fame',
  'pages.main_nav.thing.title': 'The Thing',
  'pages.main_nav.thing.short': 'Thing',

  'pages.main_nav.wiki.title': 'Wiki',
  'pages.main_nav.wiki.short': 'Wiki',
  /* ------------------------------------------------------------- hall */
  'hall.meta.title': 'World of Vikings — A Viking Browser Game',
  'hall.meta.description':
    'Saxons against Vikings. A browser game with no download: explore the world, build, and fell the guardians of Midgard.',
  /* The gate — the draft's new opening of the hall: eyebrow, one paragraph,
     the play button, the early-access note, the call to Discord. It stands
     beside the older hero block; which of the two a page shows is decided in
     the markup, not here. */
  'hall.gate.eyebrow': 'The official World of Vikings site',
  'hall.gate.intro':
    'world-of-vikings.com is the official browser game set in Midgard: Anglo-Saxons against Vikings, nine lands, five guardians. No download, no client — explore the world, build, endure. The map, the saga and the hall of fame all live on this site.',
  'hall.gate.play_button': 'Play',
  'hall.gate.early_access_text':
    'Midgard is under construction. What gets built stays built — but rules, worlds and values may still change.',
  'hall.gate.discord_cta': 'Join the Thing on Discord',
  'hall.gate.world_badge_closed': 'closed',
  'hall.gate.day': 'Day',
  'hall.gate.accounts_one': 'account',
  'hall.gate.accounts_many': 'accounts',
  'hall.gate.shore.aria': 'Choose a server',
  'hall.gate.shore.chosen': 'chosen',
  'hall.gate.shore.hint': 'This is where you play. Open to switch.',
  'hall.hero.crest_alt':
    'Crest of World of Vikings: a longship within a ring of rune-carved stones',
  'hall.hero.heading': 'World of Vikings',
  'hall.hero.subtitle':
    'Saxons against Vikings. A world of meadows, black forest, and bog, running right in your browser — no download, no sign-up. Open it and set out.',
  'hall.hero.button.voyage': 'Set Sail',
  'hall.hero.button.worlds': 'See the Worlds',
  'hall.hero.ribbon.open': 'open',
  'hall.hero.ribbon.of': 'of',
  'hall.hero.ribbon.underway': 'underway',
  'hall.hero.ribbon.closed': 'closed',
  'hall.hero.ribbon.checking': 'Bifröst — checking status …',
  'hall.hero.ribbon.early_days': 'Early days.',
  'hall.hero.ribbon.under_construction': 'The world is under construction.',
  'hall.awaits.heading': 'What Awaits You',
  'hall.awaits.nine_lands.image_alt': 'Painted round shield bearing a raven sigil',
  'hall.awaits.nine_lands.title': 'Nine Lands',
  'hall.awaits.nine_lands.text':
    'From the meadows through the black forest and the swamp to the mountains, the plains, and the mistlands. Every land has its own weather, its own dwellers, and its own ways to kill you.',
  'hall.awaits.five_guardians.image_alt': 'Stone skull marked with a glowing rune',
  'hall.awaits.five_guardians.title': 'Five Guardians',
  'hall.awaits.five_guardians.text':
    'Eikthyr, the Elder, the Bonemass, Moder, and Yagluth. Every fallen guardian opens the next land — and earns a place in your armory.',
  'hall.awaits.building.image_alt': "Smith's hammer crossed over timber beams",
  'hall.awaits.building.title': 'Build What Lasts',
  'hall.awaits.building.text':
    "Longhouse, workbench, harbor. Building follows real structural physics: what isn't supported falls. What you raise in Midgard still stands tomorrow.",
  'hall.awaits.dungeons.image_alt': 'Moss-covered cave entrance lit by torches',
  'hall.awaits.dungeons.title': 'Dungeons from a Seed',
  'hall.awaits.dungeons.text':
    'Crypts and caves are generated from a set seed with real doors and chains of rooms — different every time, yet the same for everyone.',
  'hall.technology.no_account.title': 'No Account, No Client',
  'hall.technology.no_account.text':
    'Your browser is the client. No install, no gigabyte-long loading bar — the world streams in as you walk.',
  'hall.technology.honest_server.title': 'An Honest Server',
  'hall.technology.honest_server.text':
    'The rules of the game live on the server, not in your browser. What your hero can do is decided by Midgard — not by your machine.',
  'hall.worlds.title': 'The Worlds',
  'hall.worlds.text':
    'Midgard is the lasting world — what stands there stays standing. The Workshop is there for experimenting and gets reset without warning.',
  'hall.worlds.error': 'The world list is unreachable right now.',
  'hall.worlds.loading': 'Fetching the world list …',
  'hall.worlds.state_open': 'open',
  'hall.worlds.state_closed': 'closed',
  'hall.worlds.value.underway': 'underway',
  'hall.worlds.value.world_time': 'World Time',
  'hall.worlds.value.type': 'Type',
  'hall.worlds.weather_label': 'Weather:',
  'hall.worlds.seed_label': 'Seed:',
  'hall.worlds.map_link': 'See both worlds on the map ›',
  'hall.hall_of_fame.title': 'From the Hall of Fame',
  'hall.hall_of_fame.column.hash': '#',
  'hall.hall_of_fame.column.character': 'Hero',
  'hall.hall_of_fame.column.clan': 'Clan',
  'hall.hall_of_fame.column.rune_rank': 'Rune Rank',
  'hall.hall_of_fame.error': 'The scoreboard is veiled for now.',
  'hall.hall_of_fame.loading': 'loading …',
  'hall.hall_of_fame.link': 'See the whole board ›',
  'hall.thing.title': 'The Thing Is Being Called',
  'hall.thing.text':
    'At the Thing, free men gathered to deliberate and to judge. Ours will be the forum: a place for structures, finds, arguments over gear, and the question of who marches on Moder next.',
  'hall.thing.button': "What's meant to take shape there",
  'hall.saga_teaser.title': 'News from Midgard',
  'hall.saga_teaser.error': 'The saga falls silent for now.',
  'hall.saga_teaser.loading': 'loading …',
  'hall.saga_teaser.link': 'Read the whole saga ›',

  /* ------------------------------------------------------------- saga */
  'saga.meta.title': 'The Saga',
  'saga.meta.description':
    "What's happening in Midgard: news on the world, the game, and the server.",
  'saga.heading': 'The Saga',
  'saga.intro': "What's been built, changed, and repaired in Midgard — in the order it happened.",
  'saga.error': 'The saga falls silent for now.',
  'saga.loading': 'Opening the saga …',
  'saga.empty': 'No entries yet.',

  /* -------------------------------------------------------------- map */
  'map.title': 'The Map',
  'map.description':
    'The world maps of World of Vikings — Midgard and the Workshop — rendered straight from the world the server actually runs.',
  'map.heading': 'The Map',
  'map.intro':
    'This is what Midgard looks like from above. The image is no drawing — it is the world itself: the same terrain calculation the server runs when you step ashore. When the world changes, the map changes.',
  'map.hint.bold': 'No JavaScript, no viewer.',
  'map.hint.text': 'But the maps are also there as plain images:',
  'map.hint.link_midgard': 'Midgard',
  'map.hint.and': 'and',
  'map.hint.link_workshop': 'Workshop',
  'map.cta': 'Sail there yourself',

  /* Heading above the biome legend next to the map. */
  'map.legend.title': 'Realms',
  /* ------------------------------ map_viewer (Kartenbetrachter.svelte) */
  'map_viewer.loading': 'Fetching maps …',
  'map_viewer.error.maps': 'The maps are unreachable right now.',
  'map_viewer.error.map': 'This map is unreachable right now.',
  'map_viewer.area.aria': 'World map — drag to pan, scroll wheel to zoom',
  'map_viewer.image.alt_prefix': 'World map of',
  'map_viewer.image.alt_suffix': 'kilometres to a side',
  'map_viewer.zoom_in': 'Zoom in',
  'map_viewer.zoom_out': 'Zoom out',
  'map_viewer.whole_world': 'Whole world',
  'map_viewer.pointer': 'Pointer:',
  'map_viewer.status.regions': 'regions',
  'map_viewer.status.km_side': 'km to a side',
  'map_viewer.status.as_of': 'as of',
  'map_viewer.status.loading': 'loading …',
  'map_viewer.colors.title': 'What the colours mean',
  'map_viewer.colors.text':
    'Darker areas within a land are forest, lighter ones are higher ground. The hillshading shows slopes — that is how you read the valleys and ridges a flat colour fill would swallow.',
  'map_viewer.two.title': 'Two worlds, two maps',
  'map_viewer.two.midgard.name': 'Midgard',
  'map_viewer.two.midgard.text':
    'is the lasting world. What stands there stays standing — and the map only changes when the land itself is rebuilt.',
  'map_viewer.two.workshop.name': 'The Workshop',
  'map_viewer.two.workshop.text':
    'is the building site. New islands and stretches of land take shape there before they move on to Midgard; it gets reset without warning.',

  /* ----------------------------------------------------------- armory */
  'armory.title': 'Armory',
  'armory.description':
    'Look up heroes from Midgard: gear, skills, guardians defeated, and trophies.',
  'armory.heading': 'Armory',
  'armory.intro':
    'Who moves through Midgard, and how: gear, skills, guardians defeated, and trophies. Search for a hero, a clan, or a byname.',
  'armory.hint.bold': 'Sample data for now.',
  'armory.hint.text':
    "The game doesn't have accounts yet, so there are no real heroes to show. But the armory itself is finished and will fill up on its own once the server starts saving characters.",
  'armory.back': '‹ Back to search',
  'armory.search.label': 'Search for a hero',
  'armory.search.placeholder': 'Name, byname, or clan …',
  'armory.search.button': 'Search',
  'armory.state.error': "The armory is locked right now — the list of heroes couldn't be loaded.",
  'armory.state.loading': 'Unlocking the armory …',
  'armory.state.empty': 'No hero by that name in the armory.',
  'armory.card.rune_rank': 'Rune rank',
  'armory.card.last_seen': 'last seen',

  /* ---------------------------------------------------- hall_of_fame */
  'hall_of_fame.title': 'Hall of Fame',
  'hall_of_fame.description':
    'The leaderboards of Midgard: rune rank, guardians defeated, time spent voyaging.',
  'hall_of_fame.heading': 'Hall of Fame',
  'hall_of_fame.intro':
    'Who has made a name for themselves in Midgard. The boards are recalculated every time the world is saved.',
  'hall_of_fame.hint.bold': 'Sample data for now.',
  'hall_of_fame.hint.text':
    'As long as there are no accounts, the heroes shown here are made up — but the boards themselves are finished.',
  'hall_of_fame.table.hash': '#',
  'hall_of_fame.table.character': 'Hero',
  'hall_of_fame.table.clan': 'Clan',
  'hall_of_fame.state.error': 'The boards are covered up right now.',
  'hall_of_fame.state.loading': 'fetching …',

  /* ------------------------------------------ characters (recken.ts) */
  'characters.board.rank.title': 'Rune Rank',
  'characters.board.rank.column': 'Rank',
  'characters.board.guardian.title': 'Guardians Defeated',
  'characters.board.guardian.column': 'Guardians',
  'characters.board.voyage.title': 'Time Voyaging',
  'characters.board.voyage.column': 'Hours',
  'characters.board.hel.title': 'Rarely Fallen',
  'characters.board.hel.column': 'Trips to Hel',

  /* ------------------------ character_profile (Reckenprofil.svelte) */
  'character_profile.slot.head': 'Head',
  'character_profile.slot.chest': 'Chest',
  'character_profile.slot.legs': 'Legs',
  'character_profile.slot.cape': 'Cape',
  'character_profile.slot.weapon': 'Weapon',
  'character_profile.slot.off_hand': 'Off-hand',
  'character_profile.slot.tool': 'Tool',
  'character_profile.slot.belt': 'Belt',
  'character_profile.slot.quality': 'Quality',
  'character_profile.slot.empty': '— empty —',
  'character_profile.rune_rank': 'Rune rank',
  'character_profile.last_seen': 'last seen',
  'character_profile.value.health': 'Health',
  'character_profile.value.stamina': 'Stamina',
  'character_profile.value.eitr': 'Eitr',
  'character_profile.value.carry_weight': 'Carry weight',
  'character_profile.value.underway': 'underway',
  'character_profile.value.hel': 'Trips to Hel',
  'character_profile.gear.title': 'Gear',
  'character_profile.figure.aria': 'Outline of a hero',
  'character_profile.skills.title': 'Skills',
  'character_profile.guardian.title': 'Guardians defeated',
  'character_profile.guardian.of': 'of',
  'character_profile.lands.title': 'Lands travelled',
  'character_profile.trophies.title': 'Trophies',
  'character_profile.created': 'Created on',

  /* Sits under the character preview and says what can be done with it.
     The preview itself stays the existing Babylon bundle. */
  'character_profile.preview.hint': 'Character preview · drag to rotate',
  /* ------------------------------------------------------------ thing */
  'thing.title': 'The Thing',
  'thing.description':
    'The Thing will be the forum of World of Vikings: boards for buildings, voyages, gear, and clans.',
  'thing.heading': 'The Thing',
  'thing.intro.name': 'Thing',
  'thing.intro.prefix': 'Among the Norse, the',
  'thing.intro.suffix':
    "was the assembly of free men: a place to debate, argue, and pass judgment — everyone had a voice, no one had the final word. That's exactly what the World of Vikings forum is meant to become.",
  'thing.hint.bold': 'Not yet convened.',
  'thing.hint.text':
    'Below is a list of the boards that are planned. No one can post here yet — this page just holds the place and look ready.',
  'thing.boards.heading': 'The planned boards',
  'thing.boards.table.board': 'Board',
  'thing.boards.table.purpose': 'What for',
  'thing.boards.table.posts': 'Posts',
  'thing.boards.mead_hall.name': 'The Mead Hall',
  'thing.boards.mead_hall.description':
    "Anything that doesn't have its own place. Introductions, small talk, arguments.",
  'thing.boards.steadings.name': 'Steadings & Longhouses',
  'thing.boards.steadings.description':
    'Show off your buildings, share structural tricks, swap floor plans.',
  'thing.boards.voyages.name': 'Voyages & Finds',
  'thing.boards.voyages.description':
    'What lies where. Maps, dungeons, good spots for the next harbor.',
  'thing.boards.weapons.name': 'Weapons & Armor',
  'thing.boards.weapons.description': 'What to wear against whom. A direct line to the armory.',
  'thing.boards.clans.name': 'Clans & Meetups',
  'thing.boards.clans.description': 'Find companions, found clans, plan the march on Moder.',
  'thing.boards.forge.name': 'The Forge',
  'thing.boards.forge.description': 'Report bugs, suggest ideas, talk about the tech.',
  'thing.connection.heading': 'How it will be connected',
  'thing.connection.location.title': 'Its own location, same shell',
  'thing.connection.location.text_1': 'The forum will get its own service under',
  'thing.connection.location.text_2':
    '. The Nginx in the container already has the location set up — all that is missing is the',
  'thing.connection.location.text_3':
    'to the software. Header, footer, and colour palette come from',
  'thing.connection.location.text_4': ", so the forum doesn't feel like a foreign body.",
  'thing.connection.account.title': 'One account for everything',
  'thing.connection.account.text':
    "Once the game has accounts, you'll sign in once — for the game, the armory, and the Thing. Until then, there's deliberately no login, because a forum account that later doesn't match the game account would cause more trouble than it's worth.",
  'thing.connection.character.title': 'Hero on every post',
  'thing.connection.character.text_1':
    'Every post should show the hero of its writer — name, clan, rune rank — linked to the armory. The data for this already exists in the right format at',
  'thing.connection.character.text_2': '.',
  'thing.connection.reading.title': 'Read first, then write',
  'thing.connection.reading.text':
    'The Thing will be readable without logging in. Anyone who wants to post needs an account — that keeps search engines in and spam out.',
  'thing.cta': 'Better go voyaging in the meantime',

  /* ------------------------------------------------------------- wiki */
  /* The draft adds a wiki. No route exists for it yet — the texts come
     first, so that both catalogues stay in step with each other.
     `wiki.description` is not from the draft; it is the meta description
     every other page here has, shortened from `wiki.intro`. */
  'wiki.title': 'The Wiki',
  'wiki.description':
    'How Midgard works: lands and weather, the five guardians, building and structural load, dungeons and their seed.',
  'wiki.heading': 'The Wiki',
  'wiki.intro':
    'How Midgard actually works: lands and weather, the five guardians, building and structural load, dungeons and their seed. Looked up, not guessed — every entry describes what the server actually computes.',
  'wiki.hint.bold': 'Under construction.',
  'wiki.hint.text': 'Four books already stand; the entries beneath them grow with the game.',
  'wiki.books.lands.title': 'Nine Lands',
  'wiki.books.lands.text':
    'Meadows, Blackwood, Swamp, Mountains, Plains, Mistlands, Ashlands — weather, inhabitants and building materials per land, with the transitions between them.',
  'wiki.books.lands.image_alt': 'Painted round shield bearing a raven sigil',
  'wiki.books.guardians.title': 'Five Guardians',
  'wiki.books.guardians.text':
    'Eikthyr, the Elder, the Bonemass, Moder, Yagluth: summoning, attack patterns, loot — and what each fallen guardian unlocks.',
  'wiki.books.guardians.image_alt': 'Stone skull marked with a glowing rune',
  'wiki.books.building.title': 'Building & Structure',
  'wiki.books.building.text':
    "Load-bearing frames, spans, workbench radius, upgrades up to tier 4. What isn't supported falls — this is where it says what holds.",
  'wiki.books.building.image_alt': "Smith's hammer crossed over timber beams",
  'wiki.books.dungeons.title': 'Dungeons & Seed',
  'wiki.books.dungeons.text':
    'Crypts and caves are generated from a placed seed with real doors and room chains — new for everyone, but the same for everyone.',
  'wiki.books.dungeons.image_alt': 'Moss-covered cave entrance lit by torches',
  /* --------------------------------------------- create (/erstellen) */
  'create.meta.title': 'Create Character',
  'create.meta.description': 'Choose the appearance and gear of your shieldmaiden, then set sail.',
  'create.title': 'Create Character',
  'create.intro':
    "Choose your appearance and gear — the preview shows how you'll stand in Midgard.",
  'create.appearance.title': 'Appearance',
  'create.appearance.figure.label': 'Figure',
  'create.appearance.hair.label': 'Hair',
  'create.appearance.hair.previous': 'Previous hairstyle',
  'create.appearance.hair.next': 'Next hairstyle',
  'create.appearance.haircolor.label': 'Hair colour',
  'create.appearance.haircolor.previous': 'Previous hair colour',
  'create.appearance.haircolor.next': 'Next hair colour',
  'create.appearance.chest.label': 'Chest',
  'create.appearance.chest.previous': 'Previous piece',
  'create.appearance.chest.none': '— none —',
  'create.appearance.chest.next': 'Next piece',
  'create.appearance.legs.label': 'Legs',
  'create.appearance.legs.previous': 'Previous piece',
  'create.appearance.legs.none': '— none —',
  'create.appearance.legs.next': 'Next piece',
  'create.stage.hint.loading': 'Loading figure …',
  'create.stage.hint.file_reachable':
    'File reachable ({status}), but the loader could not handle it.',
  'create.stage.hint.server_status': 'Server responded with {status}.',
  'create.stage.hint.no_access': 'No access across the domain boundary ({fehler}).',
  'create.stage.hint.not_loaded': 'Figure not loaded — {grund}',
  'create.stage.hint.lists_missing':
    'The selection lists are missing — assets/appearance.json is unreachable.',
  'create.stage.hint.module_missing': 'Preview module could not be loaded — {fehler}',
  'create.stage.rotate_left': 'Rotate',
  'create.stage.rotate_right': 'Rotate',
  'create.stage.reset_view': 'Reset view',
  'create.voyage.title': 'Voyage',
  'create.voyage.name.label': 'Name',
  'create.voyage.name.placeholder': 'What they will call you',
  'create.voyage.name.hint': '2 to 24 characters. Each name exists only once on a server.',
  'create.voyage.shore.label': 'Server',
  'create.voyage.shore.dev': 'Test Server — under construction',
  'create.voyage.shore.live': 'Midgard — the open land',
  'create.voyage.shore.hint.dev':
    'Under construction — the world and your progress may be reset at any time.',
  'create.voyage.shore.hint.live': 'The open land. What you build here stays.',
  'create.voyage.time.label': 'Time of Day',
  'create.voyage.time.server_time': 'Use server time',
  'create.voyage.time.hint':
    'Sets the world time for everyone on the Test Server — there, everyone is an admin.',
  'create.footer.hint': 'Drag to rotate the figure, scroll to zoom.',
  'create.footer.back': 'Back',
  'create.button.set_sail': 'Set Sail',
  'create.button.loading': 'Creating your hero …',
  'create.gate.title': 'Sign in first',
  'create.gate.text':
    'A hero belongs to an account, so the stage only opens once you are signed in. An account takes a minute: username, e-mail, password — the address is never verified, the account works right away.',
  'create.gate.login': 'Sign in',
  'create.gate.register': 'Create an account',
  'create.to_account': 'Your heroes',

  /* ---------------------------------------------------------- account */
  /*
    "Server", not "shore" — since 26.08.2026, and in both languages. The
    key names still read `shore`, as does the code and the stored
    `wov-gestade`: that key already sits in visitors' browsers, and
    renaming it would silently throw away every remembered choice. The
    word is translated here and nowhere else.
  */
  'account.shore.hint':
    'Every server keeps its own accounts — an account from the Test Server does not exist on Midgard.',
  'account.shore.short.dev': 'Test Server',
  'account.shore.short.live': 'Midgard',
  'account.shore.closed': 'not open yet',
  'account.shore.closed.hint':
    'Midgard does not take accounts yet — until it does, the Test Server is where you play.',
  'account.without_js':
    'Submitting this form needs JavaScript. Without scripting the page stays readable — it simply shows no button that would do nothing anyway.',
  'account.logout': 'Sign out',

  'account.error.username_invalid': 'Username: 3 to 24 characters, only letters, digits, _ or -.',
  'account.error.email_invalid': 'That does not look like a valid e-mail address.',
  'account.error.password_too_short': 'The password must be at least 8 characters long.',
  'account.error.username_taken': 'Somebody already carries that username.',
  'account.error.login_failed': 'Username or password is wrong.',
  'account.error.too_many_attempts':
    'Too many failed attempts — please try again in a few minutes.',
  'account.error.not_logged_in': 'Your session has expired — please sign in again.',
  'account.error.name_invalid': "Hero's name: 2 to 24 characters, letters, digits, spaces, _ or -.",
  'account.error.name_taken': 'Another hero already carries that name.',
  'account.error.unknown':
    'That hero is gone — already deleted, or they belong to a different account.',
  'account.error.broken_body': 'The request arrived damaged — please try again.',
  'account.error.server_error': 'The server answered with an error — please try again later.',
  'account.error.network': 'The server cannot be reached — please check your connection.',
  'account.error.unexpected': 'Unexpected answer from the server — please reload the page.',

  /* ------------------------------------------ register (/registrieren) */
  'register.meta.title': 'Create an account',
  'register.meta.description':
    'Create an account on a World of Vikings server — username, e-mail, password, done.',
  'register.heading': 'Create an account',
  'register.intro':
    'An account keeps your heroes. It works immediately: the e-mail address is stored, but never verified.',
  'register.username.label': 'Username',
  'register.username.placeholder': 'How you sign in',
  'register.username.hint': '3 to 24 characters: letters, digits, _ or -.',
  'register.email.label': 'E-mail',
  'register.email.placeholder': 'you@example.com',
  'register.email.hint':
    'Stored, but neither checked nor confirmed. It is therefore no proof of anything and cannot on its own reset a password.',
  'register.password.label': 'Password',
  'register.password.hint': 'At least 8 characters.',
  'register.password_repeat.label': 'Repeat password',
  'register.password_repeat.hint': 'Compared here in the browser only, and never sent.',
  'register.error.mismatch': 'The two passwords do not match.',
  'register.button': 'Create account',
  'register.button.loading': 'Creating account …',
  'register.switch.text': 'Already have an account?',
  'register.switch.link': 'Sign in here',

  /* ------------------------------------------------ login (/anmelden) */
  'login.meta.title': 'Sign in',
  'login.meta.description': 'Sign in to your server and set sail with your heroes.',
  'login.heading': 'Sign in',
  'login.intro': 'Sign in to see your heroes and set sail.',
  'login.username.label': 'Username',
  'login.password.label': 'Password',
  'login.button': 'Sign in',
  'login.button.loading': 'Signing in …',
  'login.switch.text': 'No account yet?',
  'login.switch.link': 'Create one',
  'login.session_expired': 'Your session has expired — please sign in again.',
  // Shown only when the selected shore reports a standard account
  // (KontoApi.status(), field `standardKonto`) — name and password are
  // fixed text here because the API never sends the password (server.yml).
  // The English page names `guest`, the German one `gast`: the shore
  // creates both, so nobody has to sign in with the other language's word.
  'login.try_it_out': 'To try it out: user guest, password guest.',

  /* -------------------------------------------- account.page (/konto) */
  'account.page.meta.title': 'Your heroes',
  'account.page.meta.description':
    'Your heroes at a glance: set sail, create new ones, let old ones go.',
  'account.page.heading': 'Your heroes',
  'account.page.intro': 'Your characters on this server. Pick one or create a new one.',
  'account.page.unreachable.title': 'The server is not answering',
  'account.page.unreachable.retry': 'Try again',
  'account.page.locked.title': 'Not signed in',
  'account.page.locked.text':
    'Once signed in, you see your heroes here. This page is built once at build time and therefore knows nothing about you until your browser asks the server.',
  'account.page.locked.login': 'Sign in',
  'account.page.locked.register': 'Create an account',
  'account.page.loading': 'Fetching your heroes …',
  'account.page.logged_in_as': 'Signed in as',
  'account.page.email': 'E-mail',
  'account.page.empty': 'No hero stands on this server yet. Create the first one.',
  'account.page.created': 'created on',
  'account.page.last_seen': 'last voyage',
  'account.page.never_sailed': 'never sailed',
  'account.page.button.new': 'Create a new hero',
  'account.page.button.delete': 'Delete',
  'account.page.delete.question': 'Delete this hero for good? This cannot be undone.',
  'account.page.delete.yes': 'Yes, delete',
  'account.page.delete.no': 'Never mind',
  'account.page.delete.already_gone': 'That hero was already deleted.',
  'account.page.play.loading': 'Fetching a ticket …',
};
