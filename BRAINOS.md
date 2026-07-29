# BrainOS — project runbook

> **What this is:** a fork of [`brain-tree-dev/brain-tree-os`](https://github.com/brain-tree-dev/brain-tree-os)
> that hosts the real BrainTree OS viewer to visualize **Nil's "Claude OS"** —
> projects, agents, skills, plugins, MCP connectors, and infrastructure — as one
> navigable brain, published at **BrainOs.postiusgroup.com**.
>
> This file is the single source of truth for resuming the work in a new session.
> Everything below is current as of **Session 01–02 (2026-07-22)**.

---

## 1. TL;DR status

| Area | State |
|---|---|
| App builds & runs | ✅ validated locally (Node 25, viewer renders, no console errors) |
| Repo | ✅ **public** `nilpost/brainos`, default branch `main`, `upstream` remote set |
| Hosting scaffolding | ✅ `deploy/register-brain.mjs`, `render.yaml`, `Dockerfile`, `.dockerignore` |
| Brain content | ✅ `brain/` — "Claude OS" (32 md), verified rendering as brain id `claude-os` |
| CI/CD | ✅ `.github/workflows/deploy.yml` builds & publishes `ghcr.io/nilpost/brainos:latest` on push to `main` (first run green) |
| **Deploy to a host** | ⏳ pending — needs a Render/Fly/Koyeb account action |
| **Custom domain** | ⏳ pending — Cloudflare CNAME for `BrainOs.postiusgroup.com` |
| GHCR package visibility | ⏳ pending — currently private; make public to pull without creds |

**Resume by doing §6 (Deploy) then §7 (Domain).**

---

## 2. Key decisions & rationale (do not re-litigate)

- **Host the REAL Node app, not a static site.** brain-tree-os is a Next.js
  `output: 'standalone'` app with a **custom Node server + WebSocket (`ws`) +
  filesystem watcher (`chokidar`)** and API routes that read the local disk with
  `node:fs`. It therefore **cannot** run on static/edge hosts
  (Cloudflare Pages, Vercel, GitHub Pages). It needs a **persistent Node process**.
- **Chosen host: Render free web service** (persistent process, custom domain,
  free SSL, no credit card). Alternatives that work identically: **Fly.io, Koyeb**.
  Caveat: Render free sleeps after ~15 min idle (~50s cold start).
- **Cloudflare = DNS only** (the domain's nameservers are on Cloudflare). It does
  **not** host the app.
- **Obsidian rejected for hosting** — Obsidian Publish is $8–10/mo. Cost target is **$0**.
- **Kept as an unmodified fork** with an `upstream` remote, and **all our changes
  are additive files** (new paths only, no edits to upstream source) so
  `git merge upstream/main` stays conflict-free. This satisfies "dynamic, stays in
  sync with the original."
- **Public repo + fully public site** (user's choice). The deployed site exposes
  the brain content to anyone with the URL; there is no built-in auth. If that
  changes, gate the domain with **Cloudflare Access** (free) — not yet done.

---

## 3. What we added (additive files — the whole delta from upstream)

```
BRAINOS.md                     ← this runbook
Dockerfile                     ← multi-stage build → Node standalone runtime
.dockerignore
render.yaml                    ← Render Blueprint (free Node web service)
deploy/register-brain.mjs      ← registers brain/ into ~/.braintree-os/brains.json at startup
.github/workflows/deploy.yml   ← CI/CD: build & push image to GHCR on push to main
brain/                         ← the "Claude OS" brain content (32 markdown files)
  .braintree/brain.json        ← brain metadata (id: claude-os)
  BRAIN-INDEX.md               ← top index / hub
  00_Overview/ 01_Projects/ 02_Agents/ 03_Skills/ 04_Plugins/ 05_MCP/ 06_Infra/
  .claude/agents/              ← agent personas
  Handoffs/ Execution-Plan.md
```

Nothing under `packages/`, `demo/`, `scripts/`, or upstream's `.github/workflows/{ci,release}.yml`
was modified.

### How brain registration works (the one non-obvious piece)
The viewer lists brains from `~/.braintree-os/brains.json` (see
`packages/web/src/lib/local-data.ts`) — there is **no env var** for the brain path.
On a fresh host that file doesn't exist, so `deploy/register-brain.mjs` runs
**before** the server and writes that file, registering the repo's `brain/`
folder (path from `$BRAIN_PATH`, default `./brain`). It mirrors the app's own
`registerBrain()` and is idempotent. The bundled demo brain always shows too.

---

## 4. Repository & remotes

- **origin** → `https://github.com/nilpost/brainos.git` (our repo, deploy from here)
- **upstream** → `https://github.com/brain-tree-dev/brain-tree-os.git` (for updates)
- Default branch: `main`.
- Note: Dependabot (inherited from upstream config) opens/merges GitHub-Actions
  version-bump PRs on this repo — harmless. Upstream's `Release` workflow runs on
  push and **fails** on the fork (it targets their npm release); ignore it or
  disable it in **Actions → Release → Disable workflow**.

---

## 5. Local development

```bash
git clone https://github.com/nilpost/brainos.git
cd brainos
npm install
npm run build                              # builds packages/cli + packages/web
# Register the repo brain, then start the real server:
node deploy/register-brain.mjs
PORT=3005 NODE_ENV=production node packages/web/dist/server/custom-server.js
# open http://localhost:3005/brains/claude-os
```
Dev mode (hot reload) instead of prod: `npm run dev --workspace=packages/web`.
Requires **Node ≥ 20** (validated on Node 25).

> ⚠️ `register-brain.mjs` writes an absolute path into
> `~/.braintree-os/brains.json`. During Session 01 it was pointed at a temporary
> scratchpad path; if a stale `claude-os` entry shows a dead path, delete that
> entry from `~/.braintree-os/brains.json` and re-run `register-brain.mjs` from
> the repo root.

---

## 6. Deploy (pick ONE path)

### Path A — Render Blueprint (build on Render)
1. dashboard.render.com → **New → Blueprint** → connect **`nilpost/brainos`** → **Apply**.
   Render reads `render.yaml` (free Node web service; build `npm ci && npm run build`;
   start `node deploy/register-brain.mjs && node packages/web/dist/server/custom-server.js`;
   env `NODE_ENV=production`, `BRAIN_PATH=./brain`).
2. First build ~5–10 min → you get `https://brainos.onrender.com`.
3. If the free build ever OOMs on `next build`, use **Path B** (image is prebuilt on GitHub).

### Path B — Deploy the prebuilt GHCR image (recommended; no build on the host)
1. Make the package pullable: repo → **Packages → `brainos` → Package settings →
   Change visibility → Public** (or configure registry credentials on the host).
2. On Render: **New → Web Service → Deploy an existing image** →
   `ghcr.io/nilpost/brainos:latest`. Set env `BRAIN_PATH=/app/brain`
   (`PORT` is injected by the host; the Dockerfile also defaults it).
   Fly.io / Koyeb: deploy the same image reference.
3. The image is rebuilt automatically on every push to `main` (see `deploy.yml`).

---

## 7. Custom domain (Cloudflare — DNS already here)

1. In the host (Render service → **Settings → Custom Domains**), add
   `BrainOs.postiusgroup.com`; it shows a CNAME target (`…onrender.com`).
2. Cloudflare → `postiusgroup.com` → **DNS → Add record**:
   ```
   Type: CNAME   Name: BrainOs   Target: <host>.onrender.com   Proxy: DNS only (grey)
   ```
3. Keep **DNS only** until the host shows **Verified + SSL issued**, then optionally
   switch to **Proxied** for Cloudflare's CDN.
4. *(Optional privacy)* gate the domain with **Cloudflare Access** (Zero Trust, free,
   email OTP) if you don't want it fully public.

---

## 8. Keeping in sync with upstream

```bash
git fetch upstream
git merge upstream/main      # additive-only changes → expected to be conflict-free
git push
```
Any push (upstream merge **or** new brain content) triggers `deploy.yml` and, if a
host is connected with autodeploy, redeploys.

---

## 9. Editing / growing the brain

The brain is plain markdown under `brain/`. To add a node: create a new `.md` in
the right `NN_Section/` folder and link it with `[[Wikilinks]]` — the graph edges
come from those links. `brain/.braintree/brain.json` holds the brain's id/name/
description. Re-deploy (push) to publish. You can also open `brain/` as an
**Obsidian vault** (free app) for graph-native editing — it's just files.

The content generator used to bootstrap v1 lived in the session scratchpad
(`gen-brain.mjs`) and is **not** in the repo — edit the markdown directly from now on.

---

## 10. Next-session checklist

- [ ] Make GHCR package `brainos` **public** (§6 Path B step 1).
- [ ] Deploy on Render/Fly/Koyeb (§6) → get the live URL.
- [ ] Add Cloudflare CNAME `BrainOs` → host; verify SSL (§7).
- [ ] Confirm the live site serves `brains/claude-os` (the Claude OS brain).
- [ ] (Optional) Expand brain content; wire live GitHub/health data; add a Render
      deploy-hook step to `deploy.yml`; gate with Cloudflare Access.

**References:** repo `nilpost/brainos` · upstream `brain-tree-dev/brain-tree-os` ·
domain `BrainOs.postiusgroup.com` · image `ghcr.io/nilpost/brainos:latest`.
