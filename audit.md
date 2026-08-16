# Security policy

## Supported versions

Only the latest release on the default branch is supported with security updates. Older releases and unmaintained forks are unsupported.

## Reporting a vulnerability

Report vulnerabilities privately through the repository's GitHub Security Advisory **Report a vulnerability** flow. If that is unavailable, contact the maintainer privately using the contact method in the repository metadata. Do not disclose vulnerabilities, proofs of concept, credentials, or sensitive data through public GitHub issues.

Reports should include affected versions, reproduction steps, impact, and any suggested mitigation. Reporters should avoid accessing data that is not their own, disrupting service, or retaining sensitive data. Maintainers should acknowledge reports promptly, validate them against source, rotate any exposed credential, and coordinate disclosure only after remediation is available.

Security expectations include authentication before any non-loopback deployment, strict authorization for each registered brain, containment of all filesystem operations inside the selected brain root, origin validation for WebSockets, least-privilege child processes, secret-safe logging, pinned and reviewed dependencies, and deployment defaults that do not expose local-only capabilities.

# Security & Privacy Remediation Backlog

- [ ] **BRN-001 — HIGH — Authentication / excessive privilege**
  - **Affected files/lines:** `packages/web/src/server/custom-server.ts:132-166`, `packages/web/src/server/custom-server.ts:179-200`, `render.yaml:8-20`
  - **Description:** The publicly deployable custom server accepts WebSocket connections and `chat-request` messages without authentication, origin validation, or authorization, then launches the locally installed Claude CLI with the server process environment and a registered brain as its working directory.
  - **Exposure path:** A remote visitor connects to `/ws` on the Render web service and submits an arbitrary prompt and brain identifier; the server passes that prompt to `claude -p` and streams tool/result data back to the visitor.
  - **Impact:** Unauthorized use of the host's AI agent and its ambient credentials/capabilities can expose brain data, consume paid resources, and potentially cause agent-mediated actions with the server account's privileges.
  - **Confidence:** HIGH — the unauthenticated WebSocket handler, attacker-controlled prompt, inherited environment, child-process launch, and public deployment configuration are directly present in source. Exact downstream tool privileges depend on the installed Claude configuration.
  - **Remediation:** Keep the service loopback-only unless a hardened remote mode is explicitly enabled; require strong authentication and per-brain authorization, validate `Origin`, use a narrowly allowlisted agent capability set, strip credentials from the child environment, rate-limit requests, and disable chat entirely in hosted deployments by default.
  - **Status:** OPEN

- [ ] **BRN-002 — HIGH — Broken access control / sensitive data exposure**
  - **Affected files/lines:** `packages/web/src/app/api/brains/route.ts:5-40`, `packages/web/src/app/api/brains/[brainId]/route.ts:4-41`, `packages/web/src/app/api/brain-file/[brainId]/route.ts:4-35`, `packages/web/src/app/api/brain-file/[brainId]/route.ts:37-70`, `packages/web/src/app/api/brain-step/[brainId]/route.ts:7-97`, `render.yaml:8-20`
  - **Description:** Brain discovery, metadata, Markdown contents, file writes, and execution-plan state changes are exposed without authentication or authorization. The repository also provides a public web-service deployment that registers committed brain content.
  - **Exposure path:** An unauthenticated remote client enumerates `/api/brains`, obtains a brain ID and file paths, reads files through the `brain-file` GET endpoint, or modifies files through its PATCH endpoint and the `brain-step` PATCH endpoint.
  - **Impact:** Confidential project notes and handoffs can be disclosed, modified, or corrupted, including any personal or operational information stored in registered brains.
  - **Confidence:** HIGH — each route directly performs the read or write without an access-control check, and the deployment binds the application as a hosted web service.
  - **Remediation:** Add mandatory authentication and deny-by-default per-brain authorization to every HTTP and WebSocket operation; avoid returning absolute brain paths; separate read and write capabilities; make hosted deployments read-only unless explicitly configured; add CSRF protections where cookie authentication is used.
  - **Status:** OPEN

- [ ] **BRN-003 — MEDIUM — Path traversal**
  - **Affected files/lines:** `packages/web/src/lib/local-data.ts:281-299`, `packages/web/src/app/api/brain-file/[brainId]/route.ts:9-27`, `packages/web/src/app/api/brain-file/[brainId]/route.ts:53-65`
  - **Description:** File containment is checked with a raw string prefix (`resolved.startsWith(path.resolve(brainPath))`). A sibling path whose name begins with the brain directory name passes this test (for example, a root ending in `brain` and a resolved sibling beginning `brain-backup`).
  - **Exposure path:** A caller supplies a traversal path such as `../brain-backup/file.md`; `path.resolve` reaches the sibling, and the prefix comparison accepts it before `readFileSync` or `writeFileSync` executes.
  - **Impact:** Read or overwrite of files outside the authorized brain root when a suitably named sibling exists, compounding the unauthenticated API exposure.
  - **Confidence:** HIGH — the bypass follows directly from Node path normalization and the boundary-insensitive prefix comparison; exploitation requires a readable or writable sibling with the matching prefix.
  - **Remediation:** Resolve the root once and require `resolved === root` or `resolved.startsWith(root + path.sep)`; preferably use `path.relative` and reject absolute results, `..` segments, and symlink escapes. Restrict operations to scanned Markdown files and add regression tests for prefix-collision siblings and symlinks.
  - **Status:** OPEN
