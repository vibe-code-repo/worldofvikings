# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately:

- GitHub → **Security** tab → _Report a vulnerability_ (private advisory), or
- e-mail **security@world-of-vikings.com**

Please include: what you found, how to reproduce it, the affected version or
commit, and the impact you expect. We aim to acknowledge within 72 hours and to
keep you updated until the issue is resolved. We will credit you in the advisory
unless you prefer otherwise.

## Supported versions

The project is pre-release. Only the current `main` branch is supported.

## Secrets

Never commit production API keys, deployment credentials, private certificates,
passwords or service tokens (spec §47). Use a local `.env` (git-ignored) and
repository secrets in CI. Only `.env.example` files with non-secret local
defaults are committed. Local development must never require a secret.

If a secret is committed by accident: rotate it first, then remove it from the
history, then tell the maintainers. Rotation comes first — assume anything pushed
is compromised.

## Scope

In scope: this repository's source code, build and CI configuration, and the
services it defines. Out of scope: third-party dependencies (report upstream, but
tell us so we can pin or patch) and any deployment not run by the project.
