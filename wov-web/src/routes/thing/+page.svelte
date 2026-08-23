<script lang="ts">
  import Kopfdaten from '$lib/Kopfdaten.svelte';
</script>

<Kopfdaten
  titel="Das Thing"
  beschreibung="Das Thing wird das Forum von World of Vikings: Bretter für Bauwerke, Fahrten, Ausrüstung und Sippen."
/>

<main class="mitte seite">

  <h1 style="font-size:clamp(1.8rem,5vw,2.8rem)">Das Thing</h1>
  <p style="color:var(--matt);max-width:46rem">
    Das <i>Thing</i> war bei den Nordleuten die Versammlung der Freien: Dort wurde
    beraten, gestritten und Recht gesprochen — jeder mit Stimme, keiner mit
    letztem Wort. Genau das soll das Forum von World of Vikings werden.
  </p>

  <div class="hinweis" style="margin:1.5rem 0">
    <b>Noch nicht einberufen.</b> Unten steht, welche Bretter geplant sind. Schreiben
    kann hier noch niemand — die Seite hält den Platz und das Aussehen bereit.
  </div>

  <div class="runen-trenner" aria-hidden="true">ᚦᛁᛜ</div>

  <h2>Die geplanten Bretter</h2>

  <div class="tafel" style="margin-top:1.2rem">
    <div class="rollbar">
      <table class="tabelle">
        <thead>
          <tr><th>Brett</th><th>Wofür</th><th class="zahl">Beiträge</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><b style="color:var(--gold);font-weight:normal">Die Met-Halle</b></td>
            <td style="color:var(--matt)">Alles, was keinen eigenen Platz hat. Vorstellen, plaudern, streiten.</td>
            <td class="zahl" style="color:var(--matt)">—</td>
          </tr>
          <tr>
            <td><b style="color:var(--gold);font-weight:normal">Höfe &amp; Langhäuser</b></td>
            <td style="color:var(--matt)">Bauwerke zeigen, Statik-Kniffe teilen, Grundrisse tauschen.</td>
            <td class="zahl" style="color:var(--matt)">—</td>
          </tr>
          <tr>
            <td><b style="color:var(--gold);font-weight:normal">Fahrten &amp; Fundstücke</b></td>
            <td style="color:var(--matt)">Wo liegt was. Karten, Verliese, gute Plätze für den nächsten Hafen.</td>
            <td class="zahl" style="color:var(--matt)">—</td>
          </tr>
          <tr>
            <td><b style="color:var(--gold);font-weight:normal">Waffen &amp; Rüstung</b></td>
            <td style="color:var(--matt)">Was trägt man gegen wen. Direkter Draht zur Rüstkammer.</td>
            <td class="zahl" style="color:var(--matt)">—</td>
          </tr>
          <tr>
            <td><b style="color:var(--gold);font-weight:normal">Sippen &amp; Verabredungen</b></td>
            <td style="color:var(--matt)">Mitstreiter suchen, Sippen gründen, den Zug gegen Moder planen.</td>
            <td class="zahl" style="color:var(--matt)">—</td>
          </tr>
          <tr>
            <td><b style="color:var(--gold);font-weight:normal">Die Schmiede</b></td>
            <td style="color:var(--matt)">Fehler melden, Vorschläge machen, über die Technik reden.</td>
            <td class="zahl" style="color:var(--matt)">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="runen-trenner" aria-hidden="true">ᚹᛖᚷ</div>

  <h2>Wie es angeschlossen wird</h2>

  <div class="gitter gitter-2" style="margin-top:1.2rem">

    <article class="tafel">
      <h3>Eigener Ort, gleiche Hülle</h3>
      <p style="color:var(--matt);font-size:.95rem;margin:0">
        Das Forum bekommt einen eigenen Dienst unter <code>/thing/</code>. Der
        Nginx im Container hat den Ort bereits vorgesehen — es fehlt nur das
        <code>proxy_pass</code> auf die Software. Kopf, Fuß und Palette kommen
        aus <code>/assets/css/wov.css</code>, damit das Forum nicht wie ein
        Fremdkörper aussieht.
      </p>
    </article>

    <article class="tafel">
      <h3>Ein Konto für alles</h3>
      <p style="color:var(--matt);font-size:.95rem;margin:0">
        Sobald das Spiel Konten kennt, meldet man sich einmal an — für Spiel,
        Rüstkammer und Thing. Bis dahin gibt es bewusst keine Anmeldung, denn ein
        Forumskonto, das später nicht zum Spielkonto passt, macht mehr Ärger als
        es wert ist.
      </p>
    </article>

    <article class="tafel">
      <h3>Recke am Beitrag</h3>
      <p style="color:var(--matt);font-size:.95rem;margin:0">
        Jeder Beitrag soll den Recken des Schreibers zeigen — Name, Sippe,
        Runenrang — verlinkt in die Rüstkammer. Die Daten dafür liegen schon im
        richtigen Format unter <code>/api/recken.json</code>.
      </p>
    </article>

    <article class="tafel">
      <h3>Erst lesen, dann schreiben</h3>
      <p style="color:var(--matt);font-size:.95rem;margin:0">
        Das Thing wird ohne Anmeldung lesbar sein. Wer schreiben will, braucht ein
        Konto — das hält Suchmaschinen drin und Werbemüll draußen.
      </p>
    </article>

  </div>

  <p style="margin-top:2.5rem;text-align:center">
    <a class="knopf" href="https://play.world-of-vikings.com/">Solange lieber auf Fahrt gehen</a>
  </p>

</main>
