/**
 * What a body does when a wall is in the way (ADR-0038).
 *
 * A pure function over an {@link ObstacleQuery} and a {@link GroundQuery}, with
 * no renderer, no physics backend and no state: the same arguments give the
 * same answer on every machine, which is what lets the movement system stay
 * reproducible (ADR-0009).
 *
 * **The rule.** A move that meets a surface is not thrown away — it is dropped
 * onto that surface's plane. The component *into* the face goes, the component
 * *along* it survives, and the shortened move is asked about again. Walking at
 * a house therefore keeps whatever part of the walk was parallel to the house,
 * which is the difference between walking along a wall and sticking to it.
 *
 * **Why two attempts and not more.** Each attempt costs an obstacle query, and
 * a query is six raycasts in the real game. Two deflections already cover the
 * shapes a village has — a wall, and a wall met while sliding along another —
 * and the third case is a corner, where the honest answer is to stop. Iterating
 * further would spend rays to arrive at the same place.
 *
 * **Why a corner stops rather than picks a side.** Two faces whose free
 * directions contradict each other leave nothing to slide along in the
 * horizontal plane. Choosing one anyway is how a body ends up inside the other
 * wall, so the solver gives the move up entirely — and, because a surface only
 * blocks a move that *approaches* it (`ObstacleQuery.firstHit`), backing out of
 * that corner is never blocked.
 */
import type { GroundQuery } from './ground.js';
import type { ObstacleQuery } from './obstacles.js';
import { horizontalLength, type Vec3 } from './vector.js';

/**
 * How often a blocked move may be dropped onto a face before it is given up.
 *
 * Three obstacle queries at most, therefore: the move as asked for, and one
 * after each deflection.
 */
export const MAX_SLIDE_ATTEMPTS = 2;

/**
 * The shortest move that is worth asking about again, in metres.
 *
 * A deflection that leaves less than this is a move into a wall met head-on:
 * there is nothing along the face left to walk. A micrometre also happens to be
 * the resolution below which "approaches the face" stops meaning anything in
 * single-precision collision geometry.
 */
const MIN_SLIDE_METRES = 1e-6;

/** One horizontal move to solve. */
export interface SlideRequest {
  /** Where the body is now — at its feet, like the transform. */
  readonly from: Vec3;
  /** Where it would like to be, if nothing were in the way. */
  readonly toX: number;
  readonly toZ: number;
  /** Half the body's width, in metres. */
  readonly radius: number;
  /** Supplies the height each probe is aimed at, so a probe follows the slope. */
  readonly ground: GroundQuery;
  readonly obstacles: ObstacleQuery;
}

/** Where the move ended up, and what it met on the way. */
export interface SlideOutcome {
  readonly x: number;
  readonly z: number;
  /**
   * The faces met, in the order they were met — empty for an unobstructed move.
   *
   * Handed back rather than swallowed: the movement system takes the speed a
   * body was pushing into a wall with off its velocity, and the dev build shows
   * the last one on `window.__wov.player` so a walk in the browser can say
   * *which* surface stopped it.
   */
  readonly normals: readonly Vec3[];
  /** True when nothing of the move survived and the body stayed where it was. */
  readonly blocked: boolean;
}

/**
 * The face as the horizontal plane sees it: a unit vector in `x`/`z`, or `null`
 * for a surface a horizontal move cannot run into at all.
 *
 * `null` is a floor or a ceiling. Its normal points up or down, so no
 * horizontal move approaches it and there is no direction along it to prefer —
 * whatever such a surface is doing in the way, sliding is not the answer to it.
 */
function horizontalFace(normal: Vec3): Vec3 | null {
  const length = horizontalLength(normal.x, normal.z);
  return length === 0 ? null : { x: normal.x / length, y: 0, z: normal.z / length };
}

/**
 * The part of `(x, z)` that runs along `face`, or `null` when nothing does.
 *
 * `null` is either a move that is already leaving the face — nothing to take
 * off it — or one met head-on, whose along-face part is nothing.
 */
function alongFace(x: number, z: number, face: Vec3): { x: number; z: number } | null {
  const into = x * face.x + z * face.z;
  if (into >= 0) {
    return null;
  }
  const slidX = x - into * face.x;
  const slidZ = z - into * face.z;
  return horizontalLength(slidX, slidZ) < MIN_SLIDE_METRES ? null : { x: slidX, z: slidZ };
}

/** Whether `(x, z)` would push back into a face that already stopped this move. */
function pushesInto(x: number, z: number, faces: readonly Vec3[]): boolean {
  return faces.some((face) => x * face.x + z * face.z < -MIN_SLIDE_METRES);
}

/**
 * Solves one horizontal move against the obstacles beside the body.
 *
 * The returned position is always one the obstacle query accepted, or the
 * position the body started from. It never reports a place the query refused,
 * which is what keeps a body out of the wall it walked into.
 */
export function slideMove(request: SlideRequest): SlideOutcome {
  const { from, radius, ground, obstacles } = request;
  let moveX = request.toX - from.x;
  let moveZ = request.toZ - from.z;
  const normals: Vec3[] = [];

  for (let attempt = 0; ; attempt += 1) {
    if (moveX === 0 && moveZ === 0) {
      return { x: from.x, z: from.z, normals, blocked: false };
    }

    const x = from.x + moveX;
    const z = from.z + moveZ;
    const hit = obstacles.firstHit(from, { x, y: ground.heightAt(x, z) ?? from.y, z }, radius);
    if (hit === null) {
      return { x, z, normals, blocked: false };
    }

    // Every face met is reported, including the one the solver gives up on:
    // the caller needs the last of them to stop pushing into it. Reported as
    // the horizontal plane sees it, so a caller can take a component off a
    // velocity without normalising anything itself.
    const met = normals.length;
    const face = horizontalFace(hit.normal);
    normals.push(face ?? hit.normal);
    if (attempt >= MAX_SLIDE_ATTEMPTS || face === null) {
      break;
    }

    const along = alongFace(moveX, moveZ, face);
    // A deflection that runs into a face this move was already stopped by is a
    // corner. There is no horizontal direction left, so the move is given up
    // rather than resolved into one of its two walls.
    if (along === null || pushesInto(along.x, along.z, normals.slice(0, met))) {
      break;
    }
    moveX = along.x;
    moveZ = along.z;
  }

  return { x: from.x, z: from.z, normals, blocked: true };
}
