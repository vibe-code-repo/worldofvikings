# ADR-0018: The editor viewport derives the scene from the document

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** World of Vikings maintainers

## Context

`@wov/editor-core` owns what an edit _is_: a document
(`{ world, selection, activeZoneId, dirty }`), commands with inverses, and an
undo history — all pure functions of a value, all tested without a browser
(ADR-0016). What it does not own, and cannot, is the picture: the Babylon scene
the author actually clicks on.

That leaves one question, and it decides the shape of the whole editor: **when
an author drags a prop, what changes first?**

Two answers are possible, and only one of them scales:

1. The scene changes, and the document is updated from it afterwards. This is
   what a viewport that "just moves the mesh" does. It is the shorter path and
   it makes every other feature harder: undo has to reverse a mesh instead of a
   command, the inspector has to poll the scene to stay honest, and two ways of
   moving a prop — the gizmo and the number field — become two code paths that
   drift.
2. The document changes, and the scene is made to match. Every edit is a
   command, from every source, and the viewport is a projection.

The second answer has one obvious cost: making the scene match a new document
naively means rebuilding it, and rebuilding means re-instantiating every model
in the zone. Dragging one barrel would stall on a hundred trees.

## Decision

**The document is the truth and the scene follows it.** Every gesture — a click,
a gizmo drag, a number typed into the inspector, a drop out of the asset
browser — becomes an `EditorCommand` against the document held in the React
reducer. Nothing edits the scene directly.

The viewport reconciles instead of rebuilding: `entity-diff.ts` compares the
previous entity list with the new one and answers which entities were added,
removed, replaced (a different prefab) or merely moved. `scene-sync.ts`
translates that answer into Babylon nodes and touches nothing else.

A gizmo drag becomes **one** command, applied when the drag ends.

## Alternatives considered

| Alternative                                             | Why not                                                                                                                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scene is the truth, document written back on save       | Undo would have to reverse meshes, and every panel would need to poll the scene. Two ways to move a prop become two implementations of moving a prop.                                          |
| Document is the truth, scene rebuilt after every change | Correct and unusable: one drag re-instantiates the zone. The rebuild also destroys the node a gizmo is attached to, mid-gesture.                                                               |
| One command per gizmo frame instead of one per gesture  | A single drag would leave several hundred entries in the undo stack, so Ctrl+Z would undo a pixel. Babylon's `onDragEndObservable` is exactly the boundary the author perceives as "one move". |
| Babylon `GizmoManager` instead of three separate gizmos | It also brings the bounding-box gizmo and its own attachment policy, neither of which this editor uses, and it costs bundle weight for handles that are never shown (ADR-0006).                |

## Consequences

**Positive**

- Undo is uniform. A gizmo drag, a Delete keystroke and a typed coordinate all
  produce commands, so they all undo with the same Ctrl+Z and are all tested by
  the same tests in `@wov/editor-core`.
- The panels have no private copy of an entity. The hierarchy, the inspector and
  the scene are three renderings of one value, so they cannot disagree.
- Saving is `serializeDocument` on a value that was validated the whole time,
  not a scrape of the scene graph.
- The reconciler is testable: the diff is a pure function, and the Babylon side
  is a straight translation of its answer.

**Negative**

- Every gesture pays a round trip through React. For a drag this is one dispatch
  at the end, which is free; for anything that wanted per-frame document
  updates, it would not be, and such a feature would need its own design.
- The scene holds state the document does not: which models have finished
  loading. An entity therefore appears as a stand-in cube first and keeps it if
  the load fails — deliberately, so an entity that is in the file is always
  selectable, movable and deletable.
- Two counts have to be published for the smoke test to be able to tell the two
  layers apart (`entityCount` from the document, `meshCount` from the scene).
  That is a cost, and it is the point: a viewport that quietly stopped following
  the document fails a test instead of looking fine.

**Follow-ups**

- Zone streaming will make "the active zone" more than one zone; the reconciler
  currently clears everything when the active zone changes.
- Multi-selection gizmos move every selected entity by the primary's delta.
  Rotating a multi-selection around its common centre is a different rule and
  needs its own decision.
- There is no optimistic locking on save (ADR-0017): two editors on one world
  are last-write-wins.
