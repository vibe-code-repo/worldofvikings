<script lang="ts">
  import { FAHRT } from './seiten';
</script>

<footer class="fuss">
  <div class="mitte">
    <div>
      <div class="fuss-marke">WORLD OF VIKINGS</div>
      <p>Ein Wikinger-Browserspiel auf eigenem Grund.<br />world-of-vikings.com</p>
    </div>
    <div>
      <h3>Halle</h3>
      <ul>
        <li><a href="/">Startseite</a></li>
        <li><a href="/saga">Die Saga</a></li>
        <li><a href="/karte">Die Karte</a></li>
        <li><a class="fuss-spielen" href={FAHRT}>Spielen ›</a></li>
      </ul>
    </div>
    <div>
      <h3>Recken</h3>
      <ul>
        <li><a href="/ruestkammer">Rüstkammer</a></li>
        <li><a href="/ruhmeshalle">Ruhmeshalle</a></li>
        <li><a href="/thing">Das Thing</a></li>
      </ul>
    </div>
  </div>
  <p class="fuss-schluss">
    © 865–2026 World of Vikings. Gefertigt in den Hallen von Midgard. Keine Installation
    erforderlich.
  </p>
</footer>
