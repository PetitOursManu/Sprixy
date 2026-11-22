# Roadmap & development phases

Sprixy is organised in functional phases. Each phase ships working features (no mock buttons, no simulated
generations), tests and documentation.

## Phase 1 — Deterministic engine ✅
`@sprixy/core`: RGBA image model, OKLab color science, median-cut + k-means palette extraction, palette mapping with
Floyd–Steinberg / Atkinson / Bayer dithering, true-grid pixelization with automatic grid detection, nearest-neighbour
resize, flood-fill / chroma-key background removal, alpha hardening, orphan / pinhole / speckle cleanup, outlines,
spritesheet slicing (grid & automatic), frame alignment, packing, recoloring, seamless tiles, declarative pipeline,
9 palette presets. Unit tests.

## Phase 2 — Server, BYOK & providers ✅
Fastify + SQLite, accounts, sessions, API tokens, encrypted provider keys, fal.ai & OpenRouter adapters, curated model
catalogue with live pricing, art direction & prompt builder, asynchronous jobs (generate, variant, directions,
animate, AI cutout, LoRA training) with resumable fal jobs, budgets and usage analytics.

## Phase 3 — Library, processing & exports ✅
Assets, variants, tags, favorites, collections, batch actions, import with conversion, processing endpoints,
slicing, animation builder, exports (PNG, GIF, WebP, spritesheet + JSON, ZIP, Godot, Unity, Phaser), OpenAPI docs.

## Phase 4 — Integrations ✅
`@sprixy/client`, official MCP server (remote `/mcp` + stdio CLI), integration docs for Mocky / Muse / any client.

## Phase 5 — Web app & editor ✅
Dark workbench UI, generation with live estimates, art-direction editor (palette extraction, .hex/.gpl import),
asset detail with animation player, layered pixel editor with frames & onion skin, LoRAs & datasets, usage & budgets,
settings.

## Phase 6 — Deployment ✅
Dockerfile (Node 24 + ffmpeg, non-root, health check), docker compose, Coolify guide, CI.

## Next
- Publish `@sprixy/mcp`, `@sprixy/client` and `@sprixy/core` to npm.
- More providers (Replicate, Together, self-hosted ComfyUI endpoint) through the `ProviderAdapter` interface.
- Inpainting / masked edits in the editor (send a selection to an edit model).
- Tileset autotiling templates (Wang / blob 47) and Godot terrain sets.
- Webhooks for job completion (fal supports `fal_webhook`) instead of polling.
- Team workspaces and shared projects; per-user quotas set by the admin.
- Aseprite `.ase` import/export.
- Palette-aware AI upscaling and "pixel cleanup" model option.
