# Execution Plan — Build & Deploy BrainOS

Full runbook lives at repo root: **`BRAINOS.md`**.

## Phase 1 — Validate ✅
- [x] Clone brain-tree-os, build (CLI + web), run prod server, confirm viewer + demo brain render on Node 25.

## Phase 2 — Hosting scaffolding ✅
- [x] `deploy/register-brain.mjs` (registers [[Deployment|this brain]])
- [x] `Dockerfile` + `.dockerignore` (portable)
- [x] `render.yaml` (Render free web service)

## Phase 3 — Content ✅
- [x] Author Claude OS brain v1 ([[Projects]], [[Agents]], [[Skills]], [[Plugins]], [[MCP-Connectors]], [[Hosting]])
- [ ] Expand per-project detail + wire more wikilinks (ongoing)

## Phase 4 — Fork, push & CI/CD ✅
- [x] Create public `nilpost/brainos`, add `upstream`, push.
- [x] CI/CD: `deploy.yml` publishes `ghcr.io/nilpost/brainos:latest` on push (green).

## Phase 5 — Deploy ⏳
- [ ] Make GHCR package public.
- [ ] Render/Fly/Koyeb → live URL (see [[Hosting]]).
- [ ] [[Cloudflare]] CNAME → [[Domains|BrainOs.postiusgroup.com]] + SSL.

Back to [[BRAIN-INDEX]] · latest [[Session-02]].
