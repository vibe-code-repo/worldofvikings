/**
 * Gilt für alle Seiten: vorrendern, nicht clientseitig nachbauen.
 *
 * `prerender = true` erzeugt die HTML-Datei zur Bauzeit. `ssr` bleibt an
 * (Vorgabe) — das IST das Vorrendern. `csr` bleibt ebenfalls an, damit die
 * Seiten mit Bewegung (Karte, Weltstatus) im Browser arbeiten können; wo
 * kein Skript läuft, steht der vorgerenderte Text trotzdem.
 */
export const prerender = true;
