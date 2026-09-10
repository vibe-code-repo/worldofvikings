// Gemeinsame Kollisionsformen fuer Client (Havok) und Server (eigene Abfrage).
// Alle Koordinaten sind LOKAL zur Instanz: Weltachsen des Clients nach der
// glTF-Spiegelung, VOR Rotation und Skalierung der Instanz. y zeigt nach oben.
// Shared collision shapes for client (Havok) and server (own query). Local to
// the instance: client world axes after the glTF flip, before instance
// rotation and scale.
export interface Vek3 { x: number; y: number; z: number }

export type KollisionsForm =
  | { art: 'kiste'; min: Vek3; max: Vek3 }
  | { art: 'kapsel'; x: number; z: number; radius: number; yMin: number; yMax: number }
  | { art: 'netz'; positionen: Float32Array; indizes: Uint32Array; min: Vek3; max: Vek3 };

/** Liefert die Form eines Prefabs oder null (kein fester Koerper). */
export interface FormQuelle {
  formFuer(prefabName: string): KollisionsForm | null;
}
