// ESLint 9/10 Flat Config (G6).
//
// Vorgehen laut Auftrag: klein anfangen, ZÄHLEN, bei > ~50 Meldungen Regeln
// herausnehmen statt den Bestand zu bereinigen (36 Dateien sind gerade
// woanders in Arbeit — s. `git status`). Stand der Zählung: 2026-08-20,
// vor jedem Regelblock unten notiert.
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    languageOptions: {
      // Client laeuft im Browser, Server/Shared/Admin/Tools unter Node —
      // eine gemeinsame Konfiguration, deshalb beide Globals-Saetze. Das
      // schwaecht no-undef nicht (der ist ohnehin nur fuer .js/.mjs aktiv,
      // s.u.), es verhindert nur Fehlalarme auf `window` in Client- bzw.
      // `process` in Server-Dateien.
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // kein `any` wo vermeidbar — 0 Treffer im gepflegten Bestand
      // (shared/server/client/admin src+test), alle 9 urspruenglichen
      // Treffer lagen in zwei ausdruecklich als "One-off diagnostic"
      // markierten tools/-Skripten (s. ignores unten).
      '@typescript-eslint/no-explicit-any': 'error',

      // keine leeren catch-Bloecke (u.a. die Ursache der Stunde in der
      // Nacht auf den 20.08.) — 0 Treffer im gesamten Bestand.
      'no-empty': 'error',

      // kein `==`/`!=` statt `===`/`!==`, ausser dem im Bestand ueblichen
      // `== null`/`!= null`-Idiom (faengt null UND undefined in einem
      // Schritt) — 0 echte Treffer, alle Fund-Kandidaten lagen in
      // Kommentaren/Template-Strings (GLSL-Quelltext).
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // keine ungenutzten Variablen — Regel bewusst auf 'warn' statt
      // 'error': ~50 Altfunde im gepflegten Bestand (WovServer.ts,
      // ZoneManager.ts u.a.), keiner davon in den tools/-Skripten. 'warn'
      // laesst npm run lint / den Pre-Commit-Hook gruen, zeigt den Fund
      // aber genau dann, wenn jemand die betroffene Datei ohnehin
      // anfasst — die Ausbaustufe ist, das nach einer Aufraeumrunde auf
      // 'error' zu drehen. _-Praefix ist die im Bestand bereits gelebte
      // Markierung fuer absichtlich Ungenutztes (Interface-Konformitaet
      // bei Babylon-Material-Plugins u.ae.).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Ausbaustufe (nicht aktiviert): @typescript-eslint/no-floating-promises
      // und no-misused-promises (feuer-und-vergiss-Promises ohne catch).
      // Beide brauchen typisiertes Linting (parserOptions.projectService),
      // das ESLint fuer JEDE gelintete Datei ein volles TS-Programm bauen
      // laesst — auf diesem Bestand macht allein das schon ~70s
      // (s. `npm run typecheck`-Laufzeit), dazu kommt eine Luecke: die
      // tsconfigs von shared/ und server/ schliessen test/ gar nicht ein
      // (anders als client/ und admin/), muessten also zuerst nachgezogen
      // werden. Fuer den Pre-Commit-Hook waere das zu teuer (Faustregel im
      // Auftrag: 2 Minuten). Reihenfolge fuer die Ausbaustufe: 1. test/ in
      // shared/tsconfig.json und server/tsconfig.json aufnehmen, 2. eigenen
      // eslint-Lauf mit projectService NUR in CI (nicht im Hook) ergaenzen.
    },
  },
  {
    // no-undef auf .ts/.tsx abschalten: der TS-Compiler prueft das bereits
    // (staerker, mit echten Typen und Ambient-Types wie NodeJS.Timeout, die
    // ESLint sonst faelschlich als unbekannt meldet). Fuer die losen
    // .mjs-Werkzeugskripte unten bleibt no-undef aktiv — die laufen nie
    // durch tsc.
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser: tseslint.parser },
    rules: { 'no-undef': 'off' },
  },
  // Schaltet Stil-Regeln ab, die sich mit Prettier beissen wuerden. Aktuell
  // wirkungslos (unsere Regelliste oben enthaelt keine Formatierregeln),
  // aber billige Absicherung fuer jede kuenftige Erweiterung der Liste.
  prettierConfig,
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      'tools/asset-extractor/extract.js',
      'tools/asset-extractor/extract.d.ts',
      'tools/out/**',
      'assets/**',
      'screenshots/**',
      'mess/**',
      'server/data/**',
      // Lose Diagnose-/Wegwerfskripte direkt unter tools/ (pw-*.mjs,
      // dump-*.ts, test-*.ts u.ae.) — keine npm-Workspaces (anders als
      // tools/asset-extractor, tools/prefab-parser, tools/worldlayout-mcp,
      // die deshalb NICHT hier landen), nicht Teil von npm run typecheck,
      // nicht Teil der Testliste. `*` statt `**` bewusst: trifft nur die
      // Dateien direkt in tools/, nicht die drei echten Workspaces darin.
      'tools/*.ts',
      'tools/*.mjs',
      // Gebaute Bundles der Web-Vorschau: tools/web/vorschau.js ist ein
      // 2,8 MB grosses, minifiziertes Babylon-Bundle. Es allein brachte
      // 302 der 302 Lint-Fehler (208x '==', 83x '!=', 11 leere Bloecke)
      // und liess die Regel damit als gerissen erscheinen, obwohl im
      // gepflegten Bestand kein einziger Treffer steht. Ein Build-
      // Ergebnis wird nicht nachgebessert, sondern nicht geprueft.
      'tools/web/*.js',
    ],
  },
);
