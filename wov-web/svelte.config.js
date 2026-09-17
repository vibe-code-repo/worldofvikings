import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * SvelteKit-Konfiguration von world-of-vikings.com.
 *
 * ── Warum adapter-node (geaendert am 16.09.2026) ─────────────────────
 * Bis hierher war die Seite mit `adapter-static` vollstaendig vorgerendert
 * und wurde von nginx als Dateien ausgeliefert — ein Schaufenster, das
 * keinen laufenden Dienst braucht. Mit dem Forum („Das Thing") aendert
 * sich EIN Bereich: Themenseiten entstehen aus der Datenbank und sollen
 * fuer Suchmaschinen als fertiges HTML ankommen. Das geht nur mit
 * Rendering bei der Anfrage.
 *
 * Der Node-Adapter kann beides: Die BESTEHENDEN Seiten bleiben
 * vorgerendert (`prerender = true` in `src/routes/+layout.ts`), nur die
 * Forum-Routen setzen `prerender = false` und rendern bei jeder Anfrage.
 * Preis der Umstellung: Die Seite haengt jetzt an einem kleinen,
 * ueberwachten Node-Dienst statt an statischen Dateien. Die Alternative —
 * ein zweites SvelteKit-Projekt nur fuers Forum — haette die gemeinsame
 * Huelle (Kopf/Fuss/i18n/account) dupliziert oder einen Paketumbau
 * verlangt; ein Projekt mit zwei Renderarten ist der kleinere Preis.
 *
 * ── Warum die Seiten weiter vorgerendert werden ──────────────────────
 * Die Seite war schon einmal ohne JavaScript vollstaendig lesbar, und das
 * ist eine Staerke (Roadmap H). Vorgerendert heisst: Svelte baut die
 * Seiten zur Bauzeit einmal zu HTML; der Node-Dienst liefert sie danach
 * als fertige Dateien aus. Nur das Forum rendert live.
 *
 * ── Warum keine Schraegstriche am Ende ───────────────────────────────
 * trailingSlash bleibt auf 'never'. Das <link rel="canonical"> je Seite
 * sagt, welche Adresse die richtige ist (Roadmap H2).
 */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ out: 'build' }),
    /**
     * Die Content-Security-Policy.
     *
     * ── Warum sie hier steht und nicht mehr in nginx ─────────────────
     * SvelteKit setzt für die Hydration ein Inline-Skript in jede Seite.
     * Ein CSP-Kopf mit `script-src 'self'` blockt das, und der Browser
     * erzwingt den DURCHSCHNITT aller Regelwerke — ein Hash im meta-Tag
     * hilft also nichts, solange der Kopf ihn nicht auch führt.
     *
     * `mode: 'hash'` schreibt je Seite den passenden Hash in ein
     * <meta http-equiv="content-security-policy">. Das pflegt sich selbst:
     * ändert sich das Skript, ändert sich der Hash im selben Build. Die
     * Alternative — die Hashes beim Ausrollen in die nginx-Konfiguration
     * nachtragen — wäre ein Wert, der an zwei Orten stimmen muss, und der
     * erste vergessene Nachtrag macht die Seite still kaputt.
     *
     * In nginx bleibt vom CSP-Kopf für HTML nur `frame-ancestors 'none'`
     * stehen: Diese eine Anweisung ignoriert der Browser im meta-Tag
     * ausdrücklich, sie MUSS ein Kopf sein. Alle übrigen Sicherheitsköpfe
     * (X-Content-Type-Options, Referrer-Policy, Permissions-Policy,
     * X-Frame-Options, HSTS) bleiben unangetastet.
     *
     * ── connect-src ─────────────────────────────────────────────────
     * Die Charaktervorschau holt Modelle von den Spielservern. Mit dem
     * bisherigen `connect-src 'self'` war sie nachweislich blockiert
     * („Refused to connect because it violates the document's Content
     * Security Policy“) — genau der offene Punkt „Vorschau ungeprüft im
     * Bild“. Erlaubt sind deshalb exakt diese beiden Hosts, sonst keiner.
     *
     * Seit dem Ein-Ursprung-Container (12.09.2026, `$lib/account.ts`,
     * `SHORES.dev`) ist "dev" kein zweiter Host mehr: Modelle,
     * Konten-API und Spiel kommen für dieses Gestade vom selben Ursprung
     * wie die Webseite, und dafür steht bereits `'self'`. Die alte
     * Dev-Subdomain bleibt hier trotzdem stehen — ein `WOV_DEV_ORIGIN`
     * kann `SHORES.dev` jederzeit wieder auf einen zweiten Host zeigen
     * lassen (Umgebungsschalter, s. dort), und ohne den Eintrag hier
     * bräche das lautlos an der CSP.
     */
    csp: {
      mode: 'hash',
      directives: {
        'default-src': ['self'],
        'base-uri': ['self'],
        'object-src': ['none'],
        'script-src': ['self'],
        // 'unsafe-inline' nur für Stile: Die Seiten tragen an vielen Stellen
        // ein style="…"-Attribut. Für Skripte gilt es ausdrücklich nicht.
        'style-src': ['self', 'unsafe-inline'],
        /*
          `blob:` ist fuer die Charaktervorschau noetig, nicht fuer die
          Seite: Babylon laedt Texturen aus einem GLB, legt sie als Blob im
          Speicher ab und reicht dem Browser eine blob:-Adresse. Ohne diese
          Erlaubnis blockt die CSP genau dort — am 23.08.2026 gemessen,
          nachdem die connect-src-Sperre gefallen war. Ein blob: entsteht
          nur im eigenen Dokument; es oeffnet keine fremde Quelle.
        */
        'img-src': ['self', 'data:', 'blob:'],
        // Babylon legt Dekodierarbeit in Worker, die es aus einem Blob baut.
        'worker-src': ['self', 'blob:'],
        'font-src': ['self'],
        'connect-src': [
          'self',
          'https://play.world-of-vikings.com',
          'https://play.dev.world-of-vikings.com',
        ],
        'form-action': ['self'],
        'upgrade-insecure-requests': true,
      },
    },
    prerender: {
      // Fehler beim Vorrendern sollen den Build anhalten. Eine Seite, die
      // still auf clientseitiges Rendern zurückfällt, wäre genau der
      // lautlose Rückschritt, den dieser Umbau vermeiden soll.
      handleHttpError: 'fail',
      handleMissingId: 'fail',
      /*
        `'*'` erfasst nur Routen OHNE dynamische Segmente — seit dem
        Sprachumbau liegt aber jede Seite unter `[lang=lang]`, und der
        Vorgabewert allein fände deshalb nur noch die Sprachweiche und die
        Sitemap. Die beiden Sprachwurzeln stehen darum ausdrücklich hier;
        alles Weitere findet der Crawler von dort aus über die Kopfleiste,
        die ihre Links bereits mit Sprachpräfix schreibt.

        Die drei englischen Kontoadressen stehen zusätzlich einzeln da, und
        zwar weil sie NICHT aus dem Dateibaum abzuleiten sind: Der Ordner
        heisst `konto`, die Adresse heisst `/en/account`. Die
        `entries`-Erzeuger in den `+page.ts` der Kontoseiten kennen nur
        Routenparameter und können deshalb nur `/en/konto` erzeugen — den
        Ordnernamen, nicht die veröffentlichte Adresse.

        `/en/login` und `/en/register` fände der Crawler zwar auch über die
        Anmeldesperre auf `/en/create`; sie stehen hier trotzdem, damit die
        englischen Adressen nicht davon abhängen, welcher Zweig einer Seite
        gerade vorgerendert wird.

        Diese Liste prüft sich selbst: Ändert sich ein Slug in der Tabelle in
        `src/lib/i18n/index.ts`, ohne dass die Zeile hier mitgeht, findet
        `reroute` (src/hooks.ts) keine Route mehr, der Vorrenderer bekommt
        eine 404 — und `handleHttpError: 'fail'` hält den Build an.
      */
      entries: ['*', '/de', '/en', '/en/login', '/en/register', '/en/account'],
    },
  },
};
