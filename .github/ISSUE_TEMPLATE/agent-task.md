---
name: Agent task
about: A task written so a coding agent can execute it without private knowledge
title: ''
labels: agent-task
---

<!--
Read AGENTS.md before starting. This template is the form in which tasks are
handed to an agent: goal, scope, acceptance criteria, and the failing test that
must exist first.
-->

## Goal

<!-- One or two sentences. What must be true afterwards, in observable terms. -->

## Affected packages

<!-- Exact paths. Anything not listed here is out of scope. -->

- [ ] `apps/website`
- [ ] `apps/game`
- [ ] `apps/editor`
- [ ] `services/api`
- [ ] `packages/engine`
- [ ] `packages/gameplay`
- [ ] `packages/world-schema`
- [ ] `packages/asset-system`
- [ ] `packages/editor-core`
- [ ] `packages/ui`
- [ ] `packages/shared`
- [ ] `content/` / `assets/` / `tooling/` / `docs/`

## Out of scope

<!-- What must NOT be touched or "improved" along the way. -->

## Red-first test

<!--
Name the test that must exist and must FAIL before the implementation.
File path, what it asserts, and how to run it.
-->

- File:
- Asserts:
- Run: `pnpm test` / `pnpm smoke` / `pnpm validate`

## Acceptance criteria

- [ ] The red-first test above passes
- [ ] `pnpm check` passes
- [ ] `pnpm build` passes
- [ ] `pnpm smoke` passes (if anything visible changed)
- [ ] <!-- task-specific criterion -->
- [ ] <!-- task-specific criterion -->

## Architecture notes

<!--
Which boundary rules apply? Does this need an ADR? Any decision the agent must
NOT make on its own?
-->

## Context and references

<!-- Docs, ADRs, related issues, spec sections. -->
