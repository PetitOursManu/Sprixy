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
Studio UI (light theme from the Mocky redesign: navy rail, white cards on a pixel grid, orange accents, official logo), generation with live estimates, art-direction editor (palette extraction, .hex/.gpl import),
asset detail with animation player, layered pixel editor with frames & onion skin, LoRAs & datasets, usage & budgets,
settings.

## Phase 6 — Deployment ✅
Dockerfile (Node 24 + ffmpeg, non-root, health check), docker compose, Coolify guide, CI.

## Phase 7 — Real-world validation & competitive features ✅
All AI jobs tested against real fal.ai calls (generation, variants, directions, video & sheet animations, AI cutout,
region edit) and fixed accordingly (key-color shadows, cutout masks, animation facing). Added from the competitive
study ([competitive-analysis.md](competitive-analysis.md)): selection-based AI edit, Wang autotile terrain sets with
Godot terrains and Tiled wangsets, native `.aseprite` export, job webhooks, dataset export for external LoRA training,
mobile layout fixes.

Also validated on real runs: larger models (FLUX.2 dev 32B, FLUX.2 pro, Qwen Image 2512, Qwen Image Edit 2511) with
comparisons in [providers.md](providers.md), new LoRA families and presets, and the one-call **character sheet**
animation method (4 directions × walk / attack / hurt) through a community sprite-sheet LoRA.

## Next
- Publish `@sprixy/mcp`, `@sprixy/client` and `@sprixy/core` to npm.
- Real-run validation of LoRA training on fal.ai.
- More providers (Replicate, Together, self-hosted ComfyUI endpoint) through the `ProviderAdapter` interface.
- Skeleton / keypoint-driven animation; blob-47, isometric and hex tiles; normal maps.
- Team workspaces and shared projects; per-user quotas set by the admin.
- Aseprite `.aseprite` import.
- Palette-aware AI upscaling and "pixel cleanup" model option.
