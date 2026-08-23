<script lang="ts">
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import Kartenbetrachter from '$lib/Kartenbetrachter.svelte';
</script>

<Kopfdaten
  titel="Die Karte"
  beschreibung="Die Weltkarten von World of Vikings: Midgard und die Werkstatt, gerechnet aus der Welt, die der Server wirklich fährt."
  bild="/assets/karten/live.webp"
/>

<main class="mitte seite">
  <h1 style="font-size:clamp(1.8rem,5vw,2.8rem)">Die Karte</h1>
  <p style="color:var(--matt);max-width:46rem">
    So sieht Midgard von oben aus. Das Bild ist keine Zeichnung, sondern die Welt selbst:
    dieselbe Geländeberechnung, die der Server fährt, wenn du an Land gehst. Ändert sich die
    Welt, ändert sich die Karte.
  </p>

  <Kartenbetrachter />

  <noscript>
    <div class="hinweis" style="margin:1.5rem 0">
      <b>Ohne JavaScript kein Betrachter.</b> Die Karten liegen aber als gewöhnliche Bilder
      bereit: <a href="/assets/karten/live.webp">Midgard</a> und
      <a href="/assets/karten/dev.webp">Werkstatt</a>.
    </div>
  </noscript>

  <p style="margin-top:2.5rem;text-align:center">
    <a class="knopf" href="/erstellen">Selbst hinfahren</a>
  </p>
</main>
