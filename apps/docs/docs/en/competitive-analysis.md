---
title: Competitive analysis
description: PixelLab, Retro Diffusion and SpriteKiln compared with Sprixy, and what Sprixy took from them.
---

Study done on 2026-11-23 from the tools' public sites, documentation, API references and repositories
(sources at the end). The goal was to identify relevant features, **not** to copy any proprietary code: Sprixy
contains no code from these products.

## Positioning at a glance

| | PixelLab | Retro Diffusion | SpriteKiln (brunocpf) | **Sprixy** |
| --- | --- | --- | --- | --- |
| Hosting | SaaS | SaaS (+ paid local Aseprite extension) | Local only (ComfyUI) | **Self-hosted, no GPU** |
| Pricing | Subscription + per-call API | Prepaid balance, per-call | Free, needs ~24 GB VRAM | **BYOK** (your fal.ai / OpenRouter keys) |
| Models | Proprietary | Proprietary (custom styles trainable) | Z-Image Turbo, FLUX.2 klein, Qwen-Image-Edit, Wan 2.2 | **Any**: curated fal.ai catalogue + every OpenRouter image model |
| API / MCP | REST v2 + hosted MCP | REST v2 + hosted MCP | CLI / local UI | **REST + OpenAPI + MCP (remote & stdio) + TS client + webhooks** |

“SpriteKiln” has no official product site; the closest project is the open-source ComfyUI pack
`brunocpf/spritekiln`. Another unrelated `spritekiln` (procedural 3D-to-sprite renderer, MCP, engine exports) also exists.

## Feature matrix

| Feature | PixelLab | Retro Diffusion | SpriteKiln | Sprixy |
| --- | --- | --- | --- | --- |
| Text → sprite, style presets | ✓ | ✓ (80–100 styles) | ✓ (37 presets) | ✓ kinds + per-project art direction |
| True pixel grid / palette lock | ✓ | ✓ (“true grid”) | ✓ | ✓ deterministic engine (free) |
| Style references | ✓ | ✓ (up to 9) | ✓ | ✓ (up to 4, edit models) |
| 4 / 8 directions | ✓ | ✓ (8) | ✓ | ✓ (west views mirrored for free) |
| Animation from one image | ✓ (text, skeleton) | ✓ (presets 4–16 frames) | ✓ (Wan 2.2) | ✓ video (Wan) or sprite-sheet method, palette-locked |
| Skeleton / keypoint animation | ✓ | — | rig parts | — (roadmap) |
| Wang autotile tilesets | ✓ (16-tile corner, lower/upper) | ✓ (inside/outside) | ✓ (wang16, blob47) | ✓ 16-tile corner set from 2 textures (free) + Godot terrains + Tiled wangsets |
| Blob-47 / hex / isometric tiles | ✓ (Tiles Pro) | ✓ | blob47 | — (roadmap) |
| Inpainting / region edit | ✓ | ✓ | ✓ | ✓ selection-based AI edit (pixels outside untouched) |
| Background removal | ✓ | ✓ | — | ✓ free flood/key-color + BiRefNet |
| Palette tools (reduce, convert, Lospec) | ✓ | ✓ | ✓ | ✓ 9 presets, extraction, .hex/.gpl import, dithering |
| Custom style training | — | ✓ “My Styles” | — | ✓ LoRA training (fal.ai) + export for external training |
| In-app pixel editor | ✓ (Pixelorama) | — | — | ✓ layered editor with frames & onion skin |
| Aseprite integration | extension | extension | Aseprite JSON | ✓ native `.aseprite` export (layers kept) |
| Engine exports | Godot tileset layout | — | Godot / Unity / Unreal normal maps | ✓ Godot (SpriteFrames, TileSet + terrains), Unity (.meta), Phaser, Tiled |
| Normal maps | ✓ | — | ✓ | — (roadmap) |
| Cost before each call | per-call price list | `check_cost` | n/a | ✓ live estimates + budgets / limits (HTTP 402) |

## What Sprixy took from the study

- **Lower/upper terrain wording and the 16-tile corner set** — the de-facto standard (PixelLab, Godot “Match Corners”,
  Tiled corner wangsets). Implemented as a free deterministic generator.
- **Region edit / inpainting** — every competitor has it; implemented with a strict “nothing outside the selection
  changes” guarantee and palette lock.
- **Aseprite** — the common artist tool; covered with a native file export instead of a plugin.
- **Cost transparency** — Retro Diffusion’s free cost check validated Sprixy’s estimate endpoint, extended with budgets.

## Gaps worth closing next (see roadmap)

1. Skeleton / keypoint-driven animation (PixelLab’s differentiator).
2. Blob-47 autotiles, isometric and hex tiles.
3. Normal maps for 2D lighting (Godot, Unity URP 2D).
4. Character persistence features (outfits, states) built on variants.

## Sources

- PixelLab: https://www.pixellab.ai/ · https://www.pixellab.ai/docs · https://www.pixellab.ai/docs/tools/create-tileset · https://www.pixellab.ai/pixellab-api · https://www.pixellab.ai/mcp
- Retro Diffusion: https://www.retrodiffusion.ai/ · https://www.retrodiffusion.ai/pricing · https://www.retrodiffusion.ai/styles/ · https://retrodiffusion.ai/app/guide/api · https://github.com/Retro-Diffusion/retro-diffusion-mcp
- SpriteKiln: https://github.com/brunocpf/spritekiln · https://github.com/LucasJRamos/spritekiln
