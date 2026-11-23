# REST API & integration guide

The full, always up-to-date reference is generated from the server’s schemas: **`/api/docs`** (Swagger UI) and
**`/api/docs/json`** (OpenAPI 3.1).

## Authentication

Create a token in **Settings → API tokens** and send it as a bearer token:

```
Authorization: Bearer spx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Errors always look like `{ "error": { "code": "…", "message": "…", "details"?: … } }`. Notable codes:
`MISSING_API_KEY` (no provider key configured), `BUDGET_EXCEEDED` (HTTP 402), `PROVIDER_ERROR`, `VALIDATION_ERROR`.

## Typical flow for an external tool (Mocky, Muse…)

```bash
H='Authorization: Bearer spx_…'

# 1. A project carries the art direction
curl -s -X POST $SPRIXY/api/v1/projects -H "$H" -H 'Content-Type: application/json' -d '{
  "name": "Mocky demo",
  "artDirection": { "palette": { "presetId": "endesga-32" }, "spriteSize": { "width": 32, "height": 32 }, "perspective": "side" }
}'

# 2. Estimate (no cost) then start a job
curl -s -X POST $SPRIXY/api/v1/generations/estimate -H "$H" -H 'Content-Type: application/json' \
  -d '{"task":"generate","projectId":"prj_…","kind":"icon","prompt":"a golden key","count":2}'
curl -s -X POST $SPRIXY/api/v1/generations -H "$H" -H 'Content-Type: application/json' \
  -d '{"task":"generate","projectId":"prj_…","kind":"icon","prompt":"a golden key","count":2}'
# → 202 { "id": "gen_…", "status": "queued", "estimatedCost": 0.0105, … }

# 3. Poll until succeeded / failed
curl -s $SPRIXY/api/v1/generations/gen_… -H "$H"
# → { "status": "succeeded", "outputAssetIds": ["ast_…", "ast_…"], "actualCost": 0.0105, … }

# 4. Download in the format you need
curl -s -o key.png      "$SPRIXY/api/v1/assets/ast_…/export?format=png&scale=4" -H "$H"
curl -s -o key_godot.zip "$SPRIXY/api/v1/assets/ast_…/export?format=godot" -H "$H"
```

With the TypeScript client:

```ts
import { SprixyClient } from '@sprixy/client';

const sprixy = new SprixyClient({ baseUrl: process.env.SPRIXY_URL!, token: process.env.SPRIXY_TOKEN! });
const job = await sprixy.run({ task: 'generate', projectId, kind: 'character', prompt: 'a goblin archer', count: 1 });
if (job.status === 'succeeded') {
  const png = await sprixy.download(`/api/v1/assets/${job.outputAssetIds[0]}/export?format=png&scale=4`);
}
```

## Job specs (`POST /api/v1/generations`)

| task | Required | Main options |
| --- | --- | --- |
| `generate` | `projectId`, `kind` (`sprite` `character` `object` `environment` `tileset` `texture` `ui` `icon`), `prompt` | `count` 1–4, `modelId`, `width`/`height` (native px), `referenceAssetIds`, `loras` `[{loraId, scale}]`, `seed`, `postprocess` `{removeBackground: flood\|ai\|none, pixelize, palette: project\|auto\|none, maxColors, dither, outline, cleanup}`, `tags`, `name` |
| `variant` | `assetId`, `prompt` | `count`, `modelId`, `strength` (img2img models), `lockPalette` (default true), `loras`, `seed` |
| `directions` | `assetId` | `directions` 4\|8, `baseDirection` south\|east, `modelId`, `lockPalette` |
| `animate` | `assetId`, `action` (not needed for `charsheet`) | `method` video\|sheet\|charsheet (one-call 4-direction walk / attack / hurt sheet, see providers.md), `frames` 2–24, `fps`, `modelId`, `resolution`, `lockPalette` |
| `removeBg` | `assetId` | `modelId` |
| `inpaint` | `assetId`, `prompt`, `rect` `{x,y,w,h}` | `image` (PNG data URI of unsaved pixels), `modelId`, `lockPalette`, `seed` — pixels outside `rect` are never modified |
| `train` | `name`, `datasetId` | `modelId` (trainer), `steps`, `learningRate`, `triggerWord`, `trainingType`, `projectId` |

## Webhooks

Add `"webhookUrl": "https://…"` to `POST /api/v1/generations` to be called when the job finishes instead of polling.
Sprixy POSTs `{ "event": "generation.finished", "data": <generation> }` with headers `X-Sprixy-Event`,
`X-Sprixy-Timestamp` and `X-Sprixy-Signature: sha256=<hex>` where the signature is
`HMAC_SHA256(secret, timestamp + "." + rawBody)`. Get (or rotate) your secret with `GET /api/v1/webhooks/secret`.
Delivery is retried 4 times with backoff; the outcome is stored on the generation.

```js
// Node verification example
const expected = crypto.createHmac('sha256', SECRET).update(`${req.headers['x-sprixy-timestamp']}.${rawBody}`).digest('hex');
const ok = req.headers['x-sprixy-signature'] === `sha256=${expected}`;
```

## Provider balance

`GET /api/v1/providers/balance` returns the remaining prepaid balance of each provider (`status`: `ok`, `needs_billing_key`,
`unavailable`, `not_configured`), cached 60 s (`?fresh=true` to refresh) and refreshed after every job. fal.ai only
shows billing to ADMIN-scope keys: store one with `PUT /api/v1/keys/fal/billing {"key": "…"}` — it is checked, encrypted,
and used only to read the balance (`DELETE` removes it). OpenRouter reports account credits or the key's remaining limit.

## Free endpoints (no AI call)

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/tools/process` | Stateless: `{ image: https URL or data URI, steps: [...] }` → PNG data URI. Ideal to convert any picture to pixel art. |
| `POST /api/v1/tools/detect-grid` | Detect the pseudo-pixel grid of an upscaled image. |
| `POST /api/v1/assets/import` | Import from URL / data URI with an optional pipeline. |
| `POST /api/v1/assets/:id/process` | Pipeline on an asset: `preview`, `replace`, or `new` (variant). |
| `POST /api/v1/assets/:id/slice` | Spritesheet slicing (grid / auto) + frame alignment. |
| `POST /api/v1/animations` | Build an animation from several assets. |
| `POST /api/v1/tilesets/wang` | 16-tile Wang corner autotile set from two texture assets (`lowerAssetId`, `upperAssetId`, `tileSize`, `seed`, `roughness`, `edge`; `preview: true` returns a data URI). |
| `GET /api/v1/datasets/:id/export` | Dataset ZIP for external LoRA training (images + captions + metadata.jsonl). |
| `POST /api/v1/assets/batch` | Batch tag / favorite / move / collection / delete / process. |
| `GET /api/v1/meta` | Processing ops with parameters, palette presets, kinds, export formats. |

Pipeline steps are `{ "op": "...", ...params }`, e.g.

```json
[
  { "op": "removeBackground", "tolerance": 14 },
  { "op": "pixelize", "width": 48, "height": 48 },
  { "op": "applyPalette", "presetId": "db32", "dither": "bayer4", "ditherStrength": 0.5 },
  { "op": "removeOrphans" },
  { "op": "outline", "color": "#1a1c2c" }
]
```

## Export formats (`GET /api/v1/assets/:id/export?format=…&scale=…`)

`png`, `gif`, `webp`, `aseprite` (layers kept when edited in Sprixy), `json` (atlas), `spritesheet` (zip: PNG + JSON atlas), `zip` (everything + frames),
`godot` (PNG + `.import` + SpriteFrames or TileSet `.tres`), `unity` (PNG + `.meta` with sprite rects, Point filter),
`phaser` (PNG + atlas JSON + animations JSON + loader snippet). `POST /api/v1/exports` exports many assets at once.

## Independence

Sprixy has no dependency on Mocky or Muse. They integrate through this public API like any other client; any
software able to send HTTP requests can use Sprixy as its asset generation backend.
