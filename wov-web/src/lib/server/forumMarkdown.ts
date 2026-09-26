/**
 * Markdown fuer Beitraege des Things — serverseitig gerendert.
 *
 * ── Warum eine Bibliothek und nicht ein eigener Mini-Renderer ────────
 * Markdown ist eine Falle, sobald man es selbst schreibt: Verweise,
 * Verschachtelung, Entwertung. `markdown-it` ist die verbreitete,
 * gepflegte Wahl, ist schnell und bringt die Sicherheitsentscheidungen
 * schon mit. Das Projekt ist abhaengigkeitsscheu, aber hier ist die
 * Abhaengigkeit der kleinere Preis als selbstgeschriebene Escaping-Logik.
 *
 * ── Warum `html: false` die tragende Zeile ist ───────────────────────
 * Rohes HTML im Beitrag wird damit NICHT ausgefuehrt, sondern als Text
 * gezeigt. Ohne sie koennte ein Beitrag `<script>` oder ein `onerror`-
 * Bild einschleusen. Das ist die erste und wichtigste Schranke; alles
 * Weitere ist Guertel und Hosentraeger.
 *
 * ── Links und Bilder ─────────────────────────────────────────────────
 * `rel="nofollow ugc noopener"` an jedem Link: Links aus Beitraegen sind
 * von Nutzern, sollen Suchmaschinen nicht hochstufen (nofollow) und
 * zu erkennen geben, dass sie von Nutzern stammen (ugc). Bilder bekommen
 * `loading="lazy"` und `referrerpolicy="no-referrer"`, damit ein
 * eingebundenes Fremdbild nicht die Adresse des Lesers verraet.
 *
 * Serverseitig, weil die fertige HTML-Zeichenkette in die Seite geht:
 * Der Browser bekommt kein Markdown und keine Bibliothek zu sehen.
 *
 * Server-side Markdown for forum posts. `html: false` is the load-bearing
 * line; links and images get safe attributes.
 */
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  // Rohes HTML im Beitrag wird escaped, nicht ausgefuehrt.
  html: false,
  // Nackte URLs werden zu Links.
  linkify: true,
  // Ein einzelner Zeilenumbruch ist ein <br> — so tippt man in ein Forum.
  breaks: true,
  typographer: false,
});

/** Der Vorgabe-Renderer fuer ein Token, den die eigenen Regeln aufrufen. */
const tokenRenderer =
  md.renderer.rules.link_open ??
  ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));

md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
  tokens[idx]!.attrSet('rel', 'nofollow ugc noopener');
  return tokenRenderer(tokens, idx, opts, env, self);
};

const bildRenderer =
  md.renderer.rules.image ??
  ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));

md.renderer.rules.image = (tokens, idx, opts, env, self) => {
  tokens[idx]!.attrSet('loading', 'lazy');
  tokens[idx]!.attrSet('referrerpolicy', 'no-referrer');
  return bildRenderer(tokens, idx, opts, env, self);
};

/** Rendert Markdown eines Beitrags zu HTML. Leerer Text ergibt leeres HTML. */
export function renderMarkdown(text: string): string {
  const t = text.trim();
  return t.length === 0 ? '' : md.render(t);
}
