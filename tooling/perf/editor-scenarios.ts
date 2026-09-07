/**
 * What `pnpm perf:editor` measures, and the parts of it that are decisions.
 *
 * The script next door (`editor-profile.ts`) drives a browser; this module
 * holds the things that can be wrong without a browser noticing: which
 * scenarios a command line asked for, which entity the `edit` scenario picks
 * up, and the shape of the report the three builders will diff their runs
 * against. All of it is free of Playwright and of the DOM, so a unit test can
 * hold it still.
 */
import type { DurationSummary, LongTaskSummary } from './long-tasks.js';
import type { ProfileRow } from './profile-summary.js';

/** The scenarios the rig knows. */
export const EDITOR_SCENARIOS = ['load', 'dial', 'rebuild', 'edit'] as const;

export type EditorScenarioId = (typeof EDITOR_SCENARIOS)[number];

/**
 * The world every scenario opens, and the zone inside it.
 *
 * A constant rather than an option, for the reason `views.ts` gives for the
 * game: a number without a scene is not a number, and the scene these three
 * scenarios exist for is the one the author reported — 5273 entities in
 * `village`, 3473 of them a single grass clump.
 */
export const EDITOR_WORLD_ID = 'village1';

/**
 * The entity the `edit` scenario selects and nudges.
 *
 * Fixed and written down, because "select something and move it" is not
 * reproducible: a grass clump is one tiny mesh and a house is thirty, and the
 * two do not cost the same to select, outline or re-transform. This one is the
 * second entity of the zone in `content/worlds/village1.json` — near the top of
 * the hierarchy, so clicking its row needs no long scroll — and it is a
 * building, not vegetation, so it is representative of what an author actually
 * drags around.
 */
export const EDIT_ENTITY_ID = 'environment-sm-bld-roof-long-01_0001';

/** How many ground-dial changes the `dial` scenario makes. */
export const DIAL_CHANGES = 10;

/** The two values `dial` alternates between, on layer 0's metallic. */
export const DIAL_VALUES = [0.2, 0.8] as const;

/**
 * How many times the `rebuild` scenario flips the facet switch.
 *
 * `dial` measures the gesture that must *not* rebuild the tile; this one
 * measures the gesture that must. Ticking `flatNormals` compiles a different
 * program (`terrain.ts` puts the facet switch in the shader key), so it is the
 * one ground edit that can never be a uniform — which makes it the honest
 * measurement of what a rebuild costs, and the shader key is the witness that
 * one really happened.
 *
 * An even number, so the scenario leaves the ground the way it found it and the
 * `edit` scenario after it is not looking at a different tile.
 */
export const REBUILD_TOGGLES = 4;

/** How many position nudges the `edit` scenario makes, in metres each. */
export const EDIT_NUDGES = 5;
export const EDIT_NUDGE_METRES = 1;

/**
 * Reads `--scenario` off a command line.
 *
 * Accepts a comma-separated list (`--scenario dial,edit`), the word `all`, and
 * nothing at all, which means `all`. An unknown name is an error rather than a
 * silently empty run: a typo that measures nothing and reports success is the
 * one failure mode a measuring rig must not have.
 *
 * `load` is always in the result whether it was asked for or not — every other
 * scenario is a gesture *on an open village*, so the load always happens, and a
 * report that hid its cost would be hiding the run's own preconditions.
 */
export function parseScenarios(raw: string | undefined): readonly EditorScenarioId[] {
  const requested = (raw ?? 'all')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
  if (requested.length === 0 || requested.includes('all')) {
    return EDITOR_SCENARIOS;
  }
  const known = new Set<string>(EDITOR_SCENARIOS);
  const unknown = requested.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `unknown scenario "${unknown.join('", "')}"; known: ${EDITOR_SCENARIOS.join(', ')}, all`,
    );
  }
  const chosen = new Set<EditorScenarioId>(requested as EditorScenarioId[]);
  chosen.add('load');
  return EDITOR_SCENARIOS.filter((id) => chosen.has(id));
}

/** The value the `dial` scenario writes on change `index`, starting at 0. */
export function dialValueAt(index: number): number {
  return DIAL_VALUES[index % DIAL_VALUES.length] ?? DIAL_VALUES[0];
}

/** A CPU profile, as it appears in a report. */
export interface ProfileReport {
  readonly samples: number;
  readonly totalMs: number;
  /** Sampling interval the profiler was asked for, in microseconds. */
  readonly samplingIntervalUs: number;
  /** Heaviest inclusive time first. */
  readonly top: readonly ProfileRow[];
  /** The same rows ordered by self time, which is where the CPU actually was. */
  readonly topSelf: readonly ProfileRow[];
}

/** The counters one bridge reading takes. */
export interface EditorCounters {
  readonly drawCalls: number;
  readonly activeMeshes: number;
  readonly triangles: number;
  readonly shadowCasters: number;
  readonly sceneTextures: number;
}

/** Whether the `longtask` observer could be installed at all. */
export interface LongTaskReport extends LongTaskSummary {
  /**
   * `false` when this browser has no `longtask` entry type.
   *
   * Reported rather than left out: a zero from a browser that never observed
   * anything and a zero from a thread that was never blocked are the same
   * number and opposite results.
   */
  readonly supported: boolean;
}

/** What the `load` scenario reports. */
export interface LoadReport {
  /** Milliseconds from the click on the world to the milestone. */
  readonly documentMs: number | null;
  readonly modelsMs: number | null;
  readonly texturesMs: number | null;
  readonly entityCount: number;
  readonly loadedCount: number;
  readonly loadedTextureCount: number;
  readonly longTasks: LongTaskReport;
  readonly profile: ProfileReport;
  /** The frame after the camera framed the zone and the picture settled. */
  readonly settled: SettledFrameReport;
  /**
   * The same frame from a camera an author would actually be sitting at.
   *
   * {@link SettledFrameReport} is measured where `F` with nothing selected puts
   * the camera, which for the village is 1 967 m up — about 4 m per pixel, with
   * the entities covering roughly 3.5 % of the canvas and a 6 m building
   * one and a half pixels wide. That is the right camera for a *frame time*,
   * because it contains the whole zone and nothing is culled, and the wrong one
   * for every claim about the *picture*: two builds could differ in every prop
   * in the village and the canvas would still compare equal.
   *
   * So a second frame is taken with {@link EDIT_ENTITY_ID} framed, and the
   * canvas at that camera is written beside the other one. `null` when the
   * entity could not be framed.
   */
  readonly working: WorkingFrameReport | null;
}

/**
 * A frame at a camera an author would work at, without a CPU profile.
 *
 * Deliberately smaller than {@link SettledFrameReport}: the run already has a
 * profile of the settled frame, and what this one exists for is the counters
 * that depend on the *view* — how many meshes the camera finds worth drawing —
 * and a canvas that shows the village rather than the backdrop behind it.
 */
export interface WorkingFrameReport {
  /** The entity that was framed. */
  readonly entityId: string;
  /** `false` when its row could not be clicked; the numbers are then the old view. */
  readonly framed: boolean;
  readonly seconds: number;
  readonly elapsedSeconds: number;
  readonly frames: number;
  readonly framesPerSecond: number;
  readonly sceneRenderMs: number | null;
  readonly counters: EditorCounters;
  readonly camera: readonly [number, number, number];
  readonly cameraTarget: readonly [number, number, number];
}

/** The settled frame: what one frame of the open village costs the editor. */
export interface SettledFrameReport {
  /** The window the run asked for. */
  readonly seconds: number;
  /**
   * The window it actually got, in page time.
   *
   * Not the same number: starting and stopping a CPU profile of a page holding
   * a village takes over a second of its own, and a frame rate divided by the
   * nominal window is a frame rate the run never had.
   */
  readonly elapsedSeconds: number;
  readonly frames: number;
  readonly framesPerSecond: number;
  /** Mean `scene.render` over the window, or `null` when no frame was drawn. */
  readonly sceneRenderMs: number | null;
  readonly counters: EditorCounters;
  /** Where the camera stood, so another run can be compared to this one. */
  readonly camera: readonly [number, number, number];
  readonly cameraTarget: readonly [number, number, number];
  readonly profile: ProfileReport;
}

/** What the `dial` scenario reports. */
export interface DialReport {
  readonly changes: number;
  /**
   * How long an ordinary frame took just before the gestures, in milliseconds.
   *
   * The floor every latency below sits on. Without it the numbers cannot be
   * read: the same "890 ms to the next frame" is a stall at 60 fps and two
   * ordinary frames at 2 fps.
   */
  readonly idleFrameMs: DurationSummary;
  /** Milliseconds from the input event to the next rendered frame. */
  readonly toNextFrameMs: readonly number[];
  readonly summary: DurationSummary;
  readonly longTasks: LongTaskReport;
  /** The terrain shader key before and after, and whether it changed. */
  readonly programBefore: string | null;
  readonly programAfter: string | null;
  readonly programChanged: boolean;
  /** `scene.textures.length` before and after the ten changes. */
  readonly sceneTexturesBefore: number;
  readonly sceneTexturesAfter: number;
  /** Textures the terrain tile itself holds, before and after. */
  readonly terrainTexturesBefore: number | null;
  readonly terrainTexturesAfter: number | null;
}

/** What the `rebuild` scenario reports. */
export interface RebuildReport {
  readonly toggles: number;
  /** How long an ordinary frame took just before the gestures. */
  readonly idleFrameMs: DurationSummary;
  /**
   * Milliseconds from the click on `flatNormals` to the tile on screen carrying
   * the new program, `null` when it never arrived inside the budget.
   *
   * Read off the material rather than off the document: a command that reaches
   * the document while the viewport keeps its old tile is exactly the failure
   * this scenario exists to catch.
   */
  readonly toNewProgramMs: readonly (number | null)[];
  readonly summary: DurationSummary;
  readonly longTasks: LongTaskReport;
  /** The shader keys the toggles walked through, in order. */
  readonly programs: readonly (string | null)[];
  /** `scene.textures.length` before and after — a leaking rebuild shows here. */
  readonly sceneTexturesBefore: number;
  readonly sceneTexturesAfter: number;
  /** Textures the tile itself holds, before and after. */
  readonly terrainTexturesBefore: number | null;
  readonly terrainTexturesAfter: number | null;
  /** Meshes the tile holds, before and after — a reused height field is equal. */
  readonly terrainMeshesBefore: number | null;
  readonly terrainMeshesAfter: number | null;
}

/** What the `edit` scenario reports. */
export interface EditReport {
  readonly entityId: string;
  /** `true` when the click on the row actually selected that entity. */
  readonly selected: boolean;
  /** How long an ordinary frame took just before the gestures. */
  readonly idleFrameMs: DurationSummary;
  /** Milliseconds from each position change to the next rendered frame. */
  readonly toNextFrameMs: readonly number[];
  readonly summary: DurationSummary;
  readonly longTasks: LongTaskReport;
  /** Milliseconds the canvas `pointerup` listeners took, the pick included. */
  readonly pointerUpMs: number | null;
  /** Long tasks during that one click, which is where the pick shows up. */
  readonly clickLongTasks: LongTaskReport;
}

/** One run of the rig, as a report file holds it. */
export interface EditorPerfReport {
  readonly label: string;
  readonly rig: 'editor';
  readonly takenAt: string;
  readonly url: string;
  readonly worldId: string;
  readonly zoneId: string | null;
  readonly backend: string;
  readonly scenarios: readonly EditorScenarioId[];
  readonly viewport: { readonly width: number; readonly height: number };
  readonly assetStore: string | null;
  /**
   * The servers this run started, and the origins the page actually used.
   *
   * The rig serves whatever is in `apps/editor/dist`, and that bundle carries
   * the API and asset URLs it was *built* with. With `--skip-build` after
   * somebody else built the editor on other ports, the page then talks to
   * another run's servers against another checkout's content — and the report
   * looks entirely normal. It happened: a run died at the ten-minute model
   * timeout because the page was fetching from ports this run never started,
   * with nothing in the output saying so.
   *
   * `origins` is every origin the page requested from during the run, so a
   * report can be checked afterwards instead of trusted.
   */
  readonly servers: {
    readonly editorUrl: string;
    readonly apiUrl: string;
    readonly assetUrl: string;
    readonly origins: readonly string[];
  };
  readonly load: LoadReport;
  readonly dial: DialReport | null;
  readonly rebuild: RebuildReport | null;
  readonly edit: EditReport | null;
}
