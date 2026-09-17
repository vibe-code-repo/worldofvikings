/*
  Die Meldungsliste ist eine Moderationsseite: Ihre Daten holt der Browser
  (dort liegt das Kontotoken). Deshalb NICHT vorrendern — der Vorrenderer
  fände sie beim Crawlen ohnehin nicht (sie steht in keiner Navigation),
  und festes HTML wäre nur die leere Hülle.
*/
export const prerender = false;
