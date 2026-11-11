<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Autodarts integration

Before changing the Autodarts integration, read [docs/AUTODARTS_SCHNITTSTELLE.md](docs/AUTODARTS_SCHNITTSTELLE.md). It documents the implemented cloud protocol, recorded V2 payloads, coordinate conventions, takeout safeguards, image transport, source modules and remaining hardware checks. Reuse the existing parser, sanitized fixtures and diagnostic tool. Treat observed provider endpoints as version-dependent; do not replace event parsing with guessed scores from board counts or match state. Update the guide when changing the integration.
