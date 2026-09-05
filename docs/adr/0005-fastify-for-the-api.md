# ADR-0005: Fastify for the API service

- **Status:** accepted
- **Date:** 2026-09-05
- **Deciders:** project maintainers

## Context

`services/api` will later own accounts, save synchronisation, published world
versions, editor permissions and telemetry (spec §35). It must not be required
for local rendering or editor work, and Phase 0 only needs `/health`. Whatever we
pick has to be testable without binding a port, and must not drag in a pile of
extra packages for logging, validation and typing.

## Decision

Use **Fastify** (`fastify`, plus `@fastify/cors` because the three dev apps run
on their own origins).

## Alternatives considered

| Alternative      | Why not                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Hono             | Smaller and elegant, but optimised for edge runtimes we do not target; the plugin ecosystem for session/auth on Node is thinner.           |
| Express          | Would need separate packages for logging, schema validation and types; its middleware model gives weaker typing.                           |
| Node `http` only | Fine for the current `/health` endpoint, but routing, validation and auth would be hand-written exactly when the service starts to matter. |

## Consequences

**Positive** — structured logging, JSON-schema validation and `app.inject()` for
port-free tests come from the core package; the unit test for `/health` needs no
network.

**Negative** — one more framework for contributors to learn; Fastify plugin
encapsulation is unfamiliar to Express users.

**Follow-ups** — add schema definitions for every route as soon as a second route
exists; revisit if the service is ever deployed to an edge runtime.
