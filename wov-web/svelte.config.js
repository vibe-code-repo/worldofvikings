import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * SvelteKit-Konfiguration von world-of-vikings.com.
 *
 * ── Warum adapter-static und nicht der Node-Adapter ──────────────────
 * Die Seite wird von nginx im Container CT 103 aus /var/www/wov
 * ausgeliefert — ohne Node-Prozess, ohne Reverse-Proxy dahinter. Genau so
 * soll es bleiben: Ein Schaufenster, das einen laufenden Dienst braucht,
 * fällt aus, wenn der Dienst ausfällt. Der Build wirft deshalb fertige
 * HTML-Dateien aus, und alles, was danach passiert, ist Dateien
 * ausliefern.
 *
 * ── Warum ALLES vorgerendert wird ────────────────────────────────────
 * Die Seite war vor dem Umbau ohne JavaScript vollständig lesbar. Das war
 * kein Zufall, sondern die ausdrückliche Begründung im Kopf der alten
 * index.html, und Block H der Roadmap führt es als Stärke. Ein
 * clientseitig gerendertes Svelte (so macht es World of ClaudeCraft)
 * hätte das aufgegeben — und mit ihm die Link-Vorschauen und die
 * Suchmaschinen, für die H2 und H9 gerade erst Arbeit vorsehen.
 *
 * Vorgerendert heißt: Svelte baut die Seiten zur Bauzeit einmal zu HTML.
 * Im Browser übernimmt danach nur noch, was Bewegung braucht (Kartenbetrachter,
 * Weltstatus, Ruhmestafel) — und wo das ausfällt, steht trotzdem der Text.
 *
 * ── Warum keine Schrägstriche am Ende ────────────────────────────────
 * trailingSlash bleibt auf 'never' (Vorgabe). Damit schreibt der Adapter
 * `build/saga.html` statt `build/saga/index.html`, und die Dateinamen sind
 * Zeichen für Zeichen dieselben wie vor dem Umbau. Alte Links auf
 * `/saga.html` gehen weiter, `/saga` ebenso (nginx: try_files $uri $uri.html).
 * Welche der beiden die richtige ist, sagt das <link rel="canonical"> je
 * Seite — das ist der Duplicate-Content-Teil von Roadmap H2.
 */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      // Kein Fallback: Jede Adresse dieser Seite ist zur Bauzeit bekannt.
      // Ein SPA-Fallback würde für Tippfehler eine 200 statt einer 404
      // liefern und damit Suchmaschinen Seiten vorgaukeln, die es nicht gibt.
      fallback: undefined,
      strict: true,
    }),
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
    },
  },
};
