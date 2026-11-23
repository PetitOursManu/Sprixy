---
title: Architecture
description: How Sprixy is built: packages, generation pipeline, data model and security.
audience: [dev]
---

```
                 ┌───────────────────────────── apps/server (Fastify) ─────────────────────────────┐
 Browser ──────► │ /api/v1/*  REST (zod-validated, OpenAPI at /api/docs)                             │
 (apps/web)      │ /mcp       MCP Streamable HTTP (stateless) ─► @sprixy/mcp tools ─► REST (in-process)│
 Claude Code ──► │                                                                                  │
 Mocky / Muse ─► │  auth (session cookie | Bearer spx_ token)                                       │
                 │  services: assets · jobs · exports · budget · keys · artDirection · video        │
                 │  providers/: registry ─► fal.ts · openrouter.ts  (ProviderAdapter interface)     │
                 │  db/: node:sqlite + migrations          lib/: crypto · images (sharp, gifenc)    │
                 └──────────────────────┬────────────────────────────────┬──────────────────────────┘
                                        │                                │
                               @sprixy/core (pure TS)          DATA_DIR/  sprixy.db · files/<user>/…
```

## Packages

| Package | Role | Notes |
| --- | --- | --- |
| `@sprixy/core` | Deterministic pixel-art engine | Zero dependencies, operates on `RGBAImage {width,height,data}`. Same code in the server, the browser (editor, palette extraction) and MCP. |
| `@sprixy/client` | REST client | `fetch`-based, pluggable transport (used by the server-hosted MCP endpoint through `app.inject`). |
| `@sprixy/mcp` | MCP server | `createSprixyMcpServer(client)` + stdio CLI (`sprixy-mcp`). |
| `@sprixy/server` | API | Fastify 5, `fastify-type-provider-zod`, `node:sqlite`, `sharp` for codecs, `gifenc` for GIF, `fflate` for ZIP, `ffmpeg` for video frames. |
| `@sprixy/web` | UI | React 19, React Router 7, TanStack Query, hand-written CSS design system, canvas editor. |

## Generation pipeline

1. **Plan** (`services/jobs.ts → planJob`): validate the job spec, load the project art direction, pick the model
   (explicit → project preference → default), resolve LoRAs (only those whose *family* matches the model), build the
   final prompt (`services/artDirection.ts → buildPrompt`), prepare reference images (nearest-neighbour upscaled and
   flattened on a key color), and compute a cost estimate for every provider call.
2. **Guard**: provider key present (BYOK), budget limits (`services/budget.ts`, HTTP 402).
3. **Execute** asynchronously: the generation row moves `queued → running → succeeded | failed | canceled`.
   fal jobs go through the queue API; the request handle is stored so single-call jobs resume after a restart.
4. **Post-process deterministically** (`toSprite`): flood-fill background removal (or BiRefNet if requested), crop to
   content, pixelize onto the native grid with majority-vote sampling, palette mapping/reduction (+ dithering),
   alpha hardening, orphan cleanup, optional outline.
5. **Store** the result as an asset (PNG) and keep the raw AI output as its *source*, so it can be re-processed later
   for free.

Multi-step jobs:

- **directions** – one edit call per non-mirrorable direction; west-facing views are horizontal flips; a sheet asset is packed.
- **animate / video** – the sprite is padded, upscaled and flattened, sent to an image-to-video model; frames are
  extracted with ffmpeg, cleaned, pixelized to the padded size, palette-locked, cropped to the union bounds and packed.
- **animate / sheet** – an edit model draws a grid of frames; frames are auto-sliced (connected components), scaled
  back to the source pixel density, aligned on the baseline and packed.
- **train** – dataset images are upscaled (nearest), captioned and zipped, uploaded to fal storage and sent to a trainer;
  the resulting LoRA is registered with the trainer’s family.

## Data model (SQLite)

`users`, `sessions`, `api_tokens`, `provider_keys` (encrypted), `user_settings` (budgets), `projects` (art direction JSON),
`assets` (file, source file, frames JSON, meta JSON, parent for variants), `asset_tags`, `collections`,
`collection_assets`, `generations` (task, model, prompts, status, provider handles, estimated & actual cost),
`loras`, `datasets`, `dataset_images` (with `rights_confirmed`).

Migrations are append-only (`apps/server/src/db/migrations.ts`, tracked with `PRAGMA user_version`).

## Security

- Provider keys: AES-256-GCM with `SPRIXY_MASTER_KEY`; only the last 4 characters are ever returned.
- Passwords: scrypt. Sessions: random tokens stored hashed (SHA-256), `HttpOnly; SameSite=Lax` cookies.
- API tokens (`spx_…`): stored hashed, can only be created from a browser session, revocable.
- Every query is scoped by `user_id`; file paths are resolved inside the storage root.
- Remote image imports only accept `https://` URLs or `data:image/…` URIs, with size limits.
