---
title: Glossary
description: The words Sprixy uses, in one place.
---

## Art direction {#art-direction}

The settings of a project — palette, sizes, perspective, lighting, shading, detail, outline, references, preferred
models and LoRAs — that Sprixy writes into every prompt and applies to every result.

## BYOK {#byok}

*Bring your own key.* You store your own fal.ai or OpenRouter key; jobs are billed on your account at the provider's
price, and the key is encrypted on your server.

## Character sheet {#character-sheet}

A 6×4 sheet of 32×48 frames — 3 walk, 2 attack and 1 hurt frame for each of four directions — drawn in one call by
Qwen Image Edit 2511 with a pixel-art sprite-sheet LoRA.

## LoRA {#lora}

A small add-on to an image model that teaches it a style or a subject. A LoRA only works with the model family it was
trained for (Z-Image, FLUX.2 klein, FLUX.2 dev, Qwen Image, FLUX.1).

## MCP {#mcp}

*Model Context Protocol.* The standard that lets an AI assistant such as Claude use tools. Sprixy's MCP server lets it
create projects, generate, animate and export assets.

## Native size {#native-size}

The real pixel size of an asset in the game (for example 32×32). AI images are generated larger, then snapped back to
this grid.

## Pixelize {#pixelize}

Turning a large image into true pixel art at the native size: one colour per cell, chosen by majority vote, so edges
stay crisp.

## Wang tiles {#wang}

A set of 16 tiles, one per combination of terrain at the four corners, so any map of two terrains joins seamlessly.
Godot calls it "Match Corners", Tiled a corner wangset.
