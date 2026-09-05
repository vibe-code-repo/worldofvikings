# infrastructure/

Deployment scaffolding. **Empty placeholders in Phase 0 on purpose**: local
development must work without Docker, Nginx or any production credential
(spec §5, §6, agent rules 18-20).

- `docker/` — optional Compose files for services the project may later need.
- `nginx/` — reverse-proxy configuration for the five production domains (§8).
- `deployment/` — deployment scripts and environment definitions (§9).

Real content is added in Phase 11 (Publishing) together with the world
build/publish pipeline (§36).
