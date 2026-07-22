# Deployment — BrainOS

BrainOS = the real **brain-tree-os** Node app, hosted so it stays in sync with
upstream (merge `upstream/main`, redeploy).

## Pipeline
1. Fork `brain-tree-dev/brain-tree-os` → `nilpost/brainos` (keep `upstream` remote).
2. Additive files only: `Dockerfile`, `render.yaml`, `deploy/register-brain.mjs`, `brain/`.
3. Render free web service builds on push (`npm ci && npm run build`) and starts
   `register-brain.mjs` (registers this brain) then the custom server.
4. [[Cloudflare]] CNAME `BrainOs` → the Render host. See [[Domains]].

"Dynamic" = every push (new content **or** upstream merge) auto-redeploys.

Back to [[Hosting]] · [[BRAIN-INDEX]].
