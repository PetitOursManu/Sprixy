---
title: Getting started
description: From an empty server to your first pixel-perfect sprite in five minutes.
---

:::steps id=start
1. **Deploy Sprixy.** With Coolify or Docker Compose — see [Deploy](deployment.md). Everything runs in one container.
2. **Create the admin account.** Open your instance: the first account created becomes the admin, then sign-ups
   close.
3. **Add a provider key.** **Settings → Provider keys**: paste a [fal.ai key](https://fal.ai/dashboard/keys) (recommended)
   and/or an [OpenRouter key](https://openrouter.ai/keys). Sprixy checks it, then stores it encrypted.
4. **Create a project.** **+ New project**: pick a palette preset, a native sprite size (32×32 is a good start) and a
   perspective. This is the project's [[art direction]].
5. **Generate.** In the project, **Generate**: choose a kind (Character, Object, Tileset…), describe the subject only —
   "a goblin archer with a hooded green cloak" — and press **Generate**. The estimate is shown before you start.
6. **Use it.** Open the result: animate it, make a [[character sheet|character-sheet]], edit pixels, then **Export** for
   Godot, Unity, Phaser or Aseprite.
:::

:::tip Start cheap
Z-Image Turbo costs about $0.005 per image and gives the cleanest 16–32 px sprites. Bigger models only pay off at
64 px and above — see the [model comparison](providers.md#model-comparison-real-runs-2026-11-23).
:::

## What it costs

You pay your provider directly; Sprixy adds nothing. Typical prices on fal.ai:

| Job | Typical cost |
| --- | --- |
| A 32×32 sprite (Z-Image Turbo) | ~$0.005 |
| 4 sprites at once | ~$0.021 |
| Character sheet, 24 frames (Qwen Image Edit 2511 + LoRA) | ~$0.021 |
| 4-direction views (FLUX.2 klein 9B) | ~$0.02 |
| Video animation, 2 s (Wan 2.2) | ~$0.04–0.08 |
| AI background removal (BiRefNet) | ~$0.002 |

Pixelization, palettes, cutouts by colour, autotiles, slicing and exports are always free: they run on your server.

:::note Budgets
Set a monthly, daily or per-job limit in **Usage & budget**: a job that would go over is refused before anything is
billed. Your remaining fal.ai balance can be shown in the top bar — see [Providers](providers.md#balance-in-the-top-bar).
:::
