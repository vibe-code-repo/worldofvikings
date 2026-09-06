/**
 * Where this checkout is, resolved from this file so a script can be started
 * from any working directory.
 *
 * It lives in `tooling/` and not in `@wov/content-build`, because "the
 * repository" is a thing a *command* knows about. The package is the shared
 * core the API runs too, and a service has a `CONTENT_DIR`, not a checkout
 * (ADR-0033).
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
