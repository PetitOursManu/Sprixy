# Sprixy MCP server

Sprixy ships an official [Model Context Protocol](https://modelcontextprotocol.io) server so AI agents (Claude Code,
Claude Desktop, any MCP client) can create projects, generate, edit, animate, search and export game assets.

Create an API token first: **Settings → API tokens**.

## Option A — remote (hosted by your Sprixy instance)

Every Sprixy server exposes a stateless Streamable HTTP endpoint at `/mcp`:

```bash
claude mcp add --transport http sprixy https://sprixy.example.com/mcp \
  --header "Authorization: Bearer spx_YOUR_TOKEN"
```

## Option B — local stdio

From a clone of this repository:

```bash
pnpm install && pnpm --filter @sprixy/mcp build
claude mcp add sprixy \
  --env SPRIXY_URL=https://sprixy.example.com \
  --env SPRIXY_TOKEN=spx_YOUR_TOKEN \
  -- node /path/to/Sprixy/packages/mcp/dist/cli.js
```

Once `@sprixy/mcp` is published on npm (see the roadmap), the last line becomes `-- npx -y @sprixy/mcp`. In stdio mode, `sprixy_export_asset` can write files
directly to disk (`outputDir`); set `SPRIXY_MCP_ALLOW_WRITE=false` to disable that.

## Tools

| Tool | Cost | Description |
| --- | --- | --- |
| `sprixy_list_projects` | free | Projects with asset counts and palettes |
| `sprixy_get_project` | free | Full art direction of a project |
| `sprixy_create_project` | free | Create a project with an art direction |
| `sprixy_update_art_direction` | free | Merge art-direction changes |
| `sprixy_list_models` | free | Models with capabilities, prices, quality, speed, key availability |
| `sprixy_estimate_cost` | free | Estimate any job before running it |
| `sprixy_get_usage` | free | Spending and budgets |
| `sprixy_get_capabilities` | free | Processing ops, palettes, kinds, export formats |
| `sprixy_list_loras` | free | Presets, imported and trained LoRAs |
| `sprixy_generate_asset` | paid | Generate assets following the art direction (returns previews) |
| `sprixy_create_variant` | paid | AI variants of an asset (palette locked) |
| `sprixy_generate_directions` | paid | 4/8-direction character views + sheet |
| `sprixy_animate_asset` | paid | Animation via video model, sprite-sheet method, or full 4-direction character sheet (walk / attack / hurt) |
| `sprixy_remove_background_ai` | paid | BiRefNet cutout |
| `sprixy_edit_region` | paid | Repaint a rectangle (inpainting), palette-locked |
| `sprixy_get_generation` / `sprixy_list_generations` / `sprixy_cancel_generation` | free | Job tracking |
| `sprixy_search_assets` / `sprixy_get_asset` / `sprixy_update_asset` | free | Library |
| `sprixy_import_image` | free | Import + optional pixel-art conversion |
| `sprixy_process_asset` | free | Deterministic processing pipeline |
| `sprixy_slice_spritesheet` | free | Slice & align frames |
| `sprixy_build_autotile` | free | 16-tile Wang terrain set from two textures |
| `sprixy_export_asset` | free | PNG / GIF / WebP / spritesheet / ZIP / Godot / Unity / Phaser |

Paid tools run on the user’s own provider keys and respect the budgets configured in Sprixy (a job that would exceed
them fails with `BUDGET_EXCEEDED`). Generation tools wait for completion by default (`wait: false` to return
immediately) and return upscaled PNG previews as image content.

## Example prompts for Claude Code

- “Create a Sprixy project *Neon Runner* with the Sweetie 16 palette, 32×32 side-view sprites, then generate a hooded
  courier character and export it for Godot into `./assets/sprites`.”
- “Estimate the cost of a walk cycle for asset ast_… with the video method, then run it if it’s under $0.50.”
- “Find all my `enemy` assets, apply the project palette and a black outline, and export them as a Phaser atlas.”
