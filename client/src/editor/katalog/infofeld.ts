/**
 * Info block under the stage: the block of a prefab entry and the block of
 * a store entry, built from DOM elements. The two functions were methods of
 * GegenstandsKatalog and moved here as functions with a context: `kat` is
 * the instance itself, `this` became `kat`, nothing else changed. The class
 * keeps one forwarding method per function. Calls to other methods of the
 * class go through `kat`, so a stub set on the instance stays in effect.
 */

import { istEigenesModell, uploadedModelRegistry } from '@wov/shared';
import { F, M, PFAD, SCHRIFT, beschriftungStil, el, knopf, luecke, stil } from '../design';
import { fmt, fmtBytes } from './format';
import { ITEMS_NACH_NAME, ITEM_TYP_TEXT } from './kategorien';
import type { PrefabDef } from '@wov/shared';
import type { StoreEintrag } from '../StoreKatalogDaten';
import type { Kennzahlen } from './konstanten';
import type { KatalogKontext } from './kontext';

/** What this module uses of the class: six fields and five methods, 11 members. */
type InfofeldKontext = KatalogKontext<
  | 'infoBlock'
  | 'aufPlatzieren'
  | 'rasterSchritt'
  | 'schliesse'
  | 'hochgeladenesModellEntfernen'
  | 'grundskalaZeileBauen'
  | 'letzteMasse'
  | 'storeContainer'
  | 'bildMasse'
  | 'tonSpieler'
  | 'statusSetzen'
>;

/**
 * Der Block unter der Bühne: Name, Herkunftsmarke, Dateiname, und
 * darunter die gemessenen Kennzahlen als Spalten (Beschriftung in
 * Versalien, Wert in Mono — alles Gemessene steht im Editor in Mono).
 *
 * Der Entwurf zeigt hier rechts noch eine Platzierungsart (Einzeln /
 * Pinsel / Streuen) und „Auf Karte platzieren". Beides gibt es im
 * Katalog nicht: Er kennt das Weltdokument nicht und setzt nichts — ein
 * toter Umschalter wäre ein Versprechen, das die Datei nicht halten
 * kann. An seiner Stelle steht das, was hier wirklich zu melden ist:
 * die Warnung, wenn das Modell fehlt.
 */
function infoSchreiben(
  kat: InfofeldKontext,
  name: string,
  def: PrefabDef | null,
  masse: Kennzahlen | null,
  warnung: string | null
): void {
  kat.infoBlock.innerHTML = '';

  const kopf = el('div', stil({ display: 'flex', 'align-items': 'center', gap: '11px', 'flex-wrap': 'wrap' }));
  const item = ITEMS_NACH_NAME.get(name);
  // Icon, wo es eines gibt: Für Gegenstände ist das Inventarbild oft
  // aussagekräftiger als das Modell (viele Item-GLBs sind winzig).
  const iconDatei = item?.icon ?? def?.sprite ?? null;
  if (iconDatei) {
    const bild = el(
      'img',
      stil({
        width: '30px',
        height: '30px',
        'object-fit': 'contain',
        border: `1px solid ${F.randFeld}`,
        'border-radius': `${M.radiusFeld}px`,
        background: F.feld,
      })
    );
    bild.src = `/assets/sprites/${iconDatei}.png`;
    // Die Sprite-Sammlung ist unvollständig; ein kaputtes Bild-Symbol
    // wäre irreführender als gar keines.
    bild.onerror = () => bild.remove();
    kopf.appendChild(bild);
  }
  kopf.appendChild(
    el(
      'span',
      stil({ 'font-size': '15px', 'font-weight': '600', color: F.textHell }),
      item?.label ? `${item.label} (${name})` : name
    )
  );

  // Die Marke spricht in BEIDE Richtungen. Vorher stand bei fremden
  // Prefabs gar nichts — und „nichts" liest sich wie „normal", nicht
  // wie „das gibt es im Spiel nicht mehr".
  const eigen = istEigenesModell(name);
  kopf.appendChild(
    el(
      'span',
      stil({
        display: 'flex',
        'align-items': 'center',
        gap: '5px',
        padding: '3px 9px',
        'border-radius': '999px',
        background: eigen ? F.warnFlaeche : F.feld,
        border: `1px solid ${eigen ? F.warnRand : F.randFeld}`,
        'font-size': '10.5px',
        color: eigen ? F.warnText : F.fehler,
      }),
      eigen ? '★ eigenes Modell' : '⊘ kein eigenes Modell — entfällt'
    )
  );
  kopf.appendChild(
    el(
      'span',
      stil({ 'font-family': SCHRIFT.mono, 'font-size': '11px', color: F.gedimmt2 }),
      def?.model ? `${def.model}.glb` : 'ohne Modelldatei'
    )
  );
  kopf.appendChild(luecke());
  if (warnung) {
    const w = el(
      'span',
      stil({
        padding: '5px 10px',
        'border-radius': `${M.radiusKlein}px`,
        background: F.feld,
        // `F` führt keine eigene Fehlerfläche — der Warnrand ist der
        // nächstliegende Ton, die Schrift trägt das Signal.
        border: `1px solid ${F.warnRand}`,
        'font-size': '11.5px',
        color: F.fehler,
      }),
      `⚠ ${warnung}`
    );
    kopf.appendChild(w);
  }
  // Die Handlung des Entwurfs (Mockup 500): der einzige bronzene Knopf
  // dieser Ansicht. Er erscheint nur, wenn ein Rückruf gesetzt IST und
  // das Prefab ein eigenes Modell hat — was die Whitelist ausschließt,
  // wird nicht platziert, und ein Knopf, der stillschweigend nichts
  // bewirkt, ist schlimmer als keiner.
  if (kat.aufPlatzieren && eigen) {
    const setzen = knopf(
      'Auf Karte platzieren',
      () => {
        kat.aufPlatzieren?.(name);
        kat.schliesse();
      },
      { art: 'bronze', pfad: PFAD.platzieren, titel: `${name} als Platzierung setzen` }
    );
    kopf.appendChild(setzen);
  }
  // U1: nur bei einem per Editor hochgeladenen Prefab — die Whitelist
  // (EIGENE_MODELLE) kennt sonst keinen Unterschied zwischen einem
  // Upload und einem handgebauten Modell, aber nur Ersteres lässt sich
  // hier wieder zurückziehen (Datei beiseiteschieben + Registry-Eintrag
  // entfernen, s. `hochgeladenesModellEntfernen`).
  const hochgeladenerEintrag = uploadedModelRegistry.uploadedModelEntry(name);
  if (hochgeladenerEintrag) {
    kopf.appendChild(
      knopf('Entfernen', () => void kat.hochgeladenesModellEntfernen(hochgeladenerEintrag.name), {
        art: 'leise',
        pfad: PFAD.muelleimer,
        randHover: F.warnRand,
        titel: `'${hochgeladenerEintrag.anzeigename}' zurückziehen — Datei wird beiseitegeschoben, nicht gelöscht`,
      })
    );
  }
  kat.infoBlock.appendChild(kopf);

  // Grundskala nachträglich ändern (Karte „Editor Upload-Größe",
  // Auftrag Punkt 5) — dieselbe Maske, nur für ein SCHON registriertes
  // Modell statt für die gerade gewählte Datei. Gesetzte Platzierungen
  // behalten ihre `scale`; sie werden dadurch größer/kleiner, und genau
  // das ist gewollt (Auftrag).
  if (hochgeladenerEintrag) {
    kat.infoBlock.appendChild(kat.grundskalaZeileBauen(hochgeladenerEintrag));
  }

  // Kennzahlen als Spalten — nur, was der Katalog wirklich gemessen
  // oder aus der Registry gelesen hat.
  const felder: [string, string][] = [];
  if (masse) {
    felder.push(
      ['Maße B×H×T', `${fmt(masse.breite)} × ${fmt(masse.hoehe)} × ${fmt(masse.tiefe)} m`],
      ['Dreiecke', masse.dreiecke.toLocaleString('de-DE')],
      ['Meshes', String(masse.meshes)],
      ['Materialien', String(masse.materialien)]
    );
  }
  if (def) {
    const ls = def.localScale;
    if (ls.x !== 1 || ls.y !== 1 || ls.z !== 1) {
      felder.push(['localScale', `${fmt(ls.x)} / ${fmt(ls.y)} / ${fmt(ls.z)}`]);
    }
    felder.push(['Platzhaltermaß', `${fmt(def.renderScale.w)} × ${fmt(def.renderScale.h)} m`]);
    if (def.animation) felder.push(['Animation', def.animation]);
    if (def.light) felder.push(['Lichtquelle', `Reichweite ${def.light.range} m`]);
  }
  if (item) {
    felder.push(
      ['Typ', ITEM_TYP_TEXT[item.itemType] ?? String(item.itemType)],
      ['Gewicht', fmt(item.weight)],
      ['Stapel', String(item.maxStackSize)]
    );
    if (item.pieceTable) felder.push(['Bau-Tafel', item.pieceTable]);
  }
  felder.push(['Raster', `${fmt(kat.rasterSchritt)} m`]);

  const gitter = el('div', stil({ display: 'flex', gap: '26px', 'flex-wrap': 'wrap' }));
  for (const [k, v] of felder) {
    const spalte = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '3px' }));
    spalte.append(
      el('span', beschriftungStil(), k),
      el('span', stil({ 'font-family': SCHRIFT.mono, 'font-size': '12px', color: F.textRuhig }), v)
    );
    gitter.appendChild(spalte);
  }
  kat.infoBlock.appendChild(gitter);
}

/**
 * Der Infoblock eines Speicher-Eintrags.
 *
 * Er beantwortet andere Fragen als der Prefab-Block darüber: Dort geht
 * es um Spielwerte (localScale, Item-Gewicht, Animation), hier um die
 * DATEI — wo sie liegt, wie gross sie ist, wie gross das Ding darin
 * ist, ob es eine Kollision hat und ob man es weitergeben darf.
 *
 * „Id kopieren" ist der einzige Knopf: Der Speicher-Name ist das, was
 * man gleich danach braucht — für eine Platzierung, eine Kuratierung
 * oder eine Nachfrage. Ihn von Hand abzutippen (`environment/
 * sm-bld-house-roof-thatch-peak-cap-beams-01`) ist eine Fehlerquelle
 * ohne Gegenwert.
 */
function speicherInfoSchreiben(kat: InfofeldKontext, eintrag: StoreEintrag, warnung: string | null): void {
  kat.infoBlock.innerHTML = '';

  const kopf = el('div', stil({ display: 'flex', 'align-items': 'center', gap: '11px', 'flex-wrap': 'wrap' }));
  kopf.appendChild(el('span', stil({ 'font-size': '15px', 'font-weight': '600', color: F.textHell }), eintrag.name));
  kopf.appendChild(
    el(
      'span',
      stil({
        display: 'flex',
        'align-items': 'center',
        gap: '5px',
        padding: '3px 9px',
        'border-radius': '999px',
        background: F.feld,
        border: `1px solid ${F.randFeld}`,
        'font-size': '10.5px',
        color: F.textRuhig,
      }),
      `${eintrag.art} · ${eintrag.gruppe} · ${eintrag.untergruppe}`
    )
  );
  for (const k of eintrag.kennzeichen) {
    kopf.appendChild(
      el(
        'span',
        stil({
          padding: '3px 8px',
          'border-radius': '999px',
          background: F.warnFlaeche,
          border: `1px solid ${F.warnRand}`,
          'font-size': '10.5px',
          color: F.warnText,
        }),
        k
      )
    );
  }
  kopf.appendChild(
    el('span', stil({ 'font-family': SCHRIFT.mono, 'font-size': '11px', color: F.gedimmt2 }), eintrag.pfad)
  );
  kopf.appendChild(luecke());
  if (warnung) {
    kopf.appendChild(
      el(
        'span',
        stil({
          padding: '5px 10px',
          'border-radius': `${M.radiusKlein}px`,
          background: F.feld,
          border: `1px solid ${F.warnRand}`,
          'font-size': '11.5px',
          color: F.fehler,
        }),
        `⚠ ${warnung}`
      )
    );
  }
  if (eintrag.kennzeichen.includes('Kollisionsnetz') && !eintrag.prefabName) {
    // Neun der zwoelf Netze sind verwaist. Das ist keine Warnung ueber
    // den Katalog, sondern eine Auskunft ueber den Speicher — und
    // genau die Sorte, die man beim Aufraeumen braucht.
    kopf.appendChild(
      el(
        'span',
        stil({
          padding: '5px 10px',
          'border-radius': `${M.radiusKlein}px`,
          background: F.feld,
          border: `1px solid ${F.warnRand}`,
          'font-size': '11.5px',
          color: F.warnText,
        }),
        'verwaist — kein Prefab verweist auf dieses Netz'
      )
    );
  }
  const kopieren = knopf(
    'Id kopieren',
    () => {
      void navigator.clipboard
        ?.writeText(eintrag.id)
        .then(() => kat.statusSetzen(`„${eintrag.id}" kopiert`, 'da'))
        // Ohne sicheren Kontext (http auf fremdem Host) gibt es keine
        // Zwischenablage. Statt eines stummen Nichts sagt die Plakette,
        // was los ist — und die Id steht im Kopf daneben zum Markieren.
        .catch(() => kat.statusSetzen('Zwischenablage nicht verfügbar', 'fehlt'));
    },
    { art: 'leise', hoehe: 30, pfad: PFAD.export, titel: eintrag.id }
  );
  kopf.appendChild(kopieren);
  kat.infoBlock.appendChild(kopf);

  const felder: [string, string][] = [['Id', eintrag.id]];
  felder.push(['Dateigröße', fmtBytes(eintrag.bytes)]);
  const h = eintrag.bounds;
  if (h) {
    felder.push([
      'Hüllbox B×H×T',
      `${fmt(h.max[0] - h.min[0])} × ${fmt(h.max[1] - h.min[1])} × ${fmt(h.max[2] - h.min[2])} m`,
    ]);
  }
  if (h && h.min[1] < -0.001) {
    /*
      Der Ursprung liegt bei 257 Modellen ueber der Unterkante — meist
      Absicht (Bodenkontaktpunkt), bei drei Ausreissern nicht:
      `sm-item-horn` reicht 15,2 m nach unten. Wer das nicht sieht,
      setzt das Ding auf die Karte und sucht es dann unter dem Gelände.
    */
    felder.push(['Unterkante', `${fmt(h.min[1])} m unter dem Ursprung`]);
  }
  if (kat.letzteMasse) {
    felder.push(['Dreiecke', kat.letzteMasse.dreiecke.toLocaleString('de-DE')], ['Meshes', String(kat.letzteMasse.meshes)]);
  }
  if (kat.storeContainer) {
    /*
      Materialien und Texturen sind hier keine Neugier, sondern die
      Kontrolle: 468 der Store-GLBs holen ihre Texturen RELATIV
      (`textures/<name>.png` neben der Datei). Stimmt die Wurzel-URL
      nicht, kommt das Modell trotzdem — nur grau, und niemand sagt
      etwas. Eine Texturzahl von 0 an einem Modell, das eine haben
      müsste, ist genau dieser Fall.
    */
    felder.push(
      ['Materialien', String(kat.storeContainer.materials.length)],
      ['Texturen geladen', String(kat.storeContainer.textures.length)]
    );
  }
  if (eintrag.kollisionsdatei) {
    felder.push(['Kollisionsnetz', eintrag.kollisionsdatei]);
  }
  if (eintrag.kollision) {
    felder.push([
      'Kollision',
      eintrag.kollision === 'box' ? 'Quader' : eintrag.kollision === 'mesh' ? 'Netz' : 'keine',
    ]);
  }
  if (eintrag.art === 'Texturen' || eintrag.art === 'Symbole') {
    felder.push(['Abmessung', kat.bildMasse ? `${kat.bildMasse.breite} × ${kat.bildMasse.hoehe} px` : '—']);
    if (eintrag.gruppe === 'Boden-Texturen') {
      // Die Bodentexturen liegen im Gelände auf einer festen Kachel;
      // ohne den Hinweis rät man an der Pixelzahl herum, wie gross ein
      // Grasbüschel im Spiel wird.
      felder.push(['Kachel', 'Boden-Textur — wird im Gelände gekachelt (Kachelansicht zeigt den Stoß)']);
    }
  }
  if (eintrag.art === 'Ton') {
    const dauer = Number.isFinite(kat.tonSpieler.duration) ? `${fmt(kat.tonSpieler.duration)} s` : '—';
    felder.push(['Dauer (gemessen)', dauer]);
    if (eintrag.herkunft) {
      /*
        `origin` beginnt bei Ton mit „1.18 s, mono, 48 kHz, …" und geht
        dann in die Werkzeugkette über. Getrennt wird deshalb am KOMMA
        und nicht am Punkt — der Punkt ist hier das Dezimalzeichen, und
        eine Trennung dort machte aus 1,18 s ein „1".
      */
      felder.push(['Manifest', eintrag.herkunft.split(',').slice(0, 3).join(',').trim()]);
    }
  }
  felder.push(['Lizenz', eintrag.lizenzstatus]);
  if (eintrag.prefabName) felder.push(['Prefab-Id', eintrag.prefabName]);

  const gitter = el('div', stil({ display: 'flex', gap: '26px', 'flex-wrap': 'wrap' }));
  for (const [k, v] of felder) {
    const spalte = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '3px' }));
    spalte.append(
      el('span', beschriftungStil(), k),
      el(
        'span',
        stil({ 'font-family': SCHRIFT.mono, 'font-size': '12px', color: F.textRuhig, 'max-width': '460px' }),
        v
      )
    );
    gitter.appendChild(spalte);
  }
  kat.infoBlock.appendChild(gitter);
}

export { infoSchreiben, speicherInfoSchreiben };
