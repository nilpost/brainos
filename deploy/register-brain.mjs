#!/usr/bin/env node
/**
 * register-brain.mjs — additive deploy helper (not part of upstream).
 *
 * A hosted brain-tree-os instance reads registered brains from
 * ~/.braintree-os/brains.json (see packages/web/src/lib/local-data.ts).
 * On a fresh host that file doesn't exist, so only the bundled demo brain
 * shows. This script registers the brain committed in the repo (BRAIN_PATH,
 * default ./brain) before the server starts, mirroring the app's own
 * registerBrain() logic. It is idempotent and never modifies viewer source,
 * so `git merge upstream/main` stays clean.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const brainPath = path.resolve(process.env.BRAIN_PATH || path.join(process.cwd(), 'brain'))
const CONFIG_DIR = path.join(os.homedir(), '.braintree-os')
const CONFIG_FILE = path.join(CONFIG_DIR, 'brains.json')

if (!fs.existsSync(brainPath)) {
  console.warn(`[register-brain] BRAIN_PATH not found: ${brainPath} — starting with demo brain only.`)
  process.exit(0)
}

let meta = {}
const metaFile = path.join(brainPath, '.braintree', 'brain.json')
try {
  if (fs.existsSync(metaFile)) meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
} catch (err) {
  console.warn(`[register-brain] Could not parse ${metaFile}: ${err.message}`)
}

let config = { brains: [] }
try {
  if (fs.existsSync(CONFIG_FILE)) config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
} catch {
  config = { brains: [] }
}
if (!Array.isArray(config.brains)) config.brains = []

const name = meta.name || path.basename(brainPath)
const existing = config.brains.find((b) => b.path === brainPath)
if (existing) {
  console.log(`[register-brain] Already registered: "${existing.name}" at ${brainPath}`)
  process.exit(0)
}

config.brains.push({
  id: meta.id || crypto.randomUUID(),
  name,
  description: meta.description || '',
  path: brainPath,
  createdAt: new Date().toISOString(),
})

fs.mkdirSync(CONFIG_DIR, { recursive: true })
fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
console.log(`[register-brain] Registered "${name}" at ${brainPath}`)
