/**
 * Constants of the game server that more than one module in this folder needs.
 *
 * Moved here unchanged from `../WovServer.ts` (refactoring I1, step 0b).
 */

/** `spielerIdFuerName` found several players of that name: the admin command must do nothing. */
const NAME_NICHT_EINDEUTIG = 'nicht-eindeutig' as const;

export { NAME_NICHT_EINDEUTIG };
