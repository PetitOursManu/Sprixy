---
title: API REST
description: Tous les endpoints, l'authentification, les spécifications de tâches, les webhooks et les outils de traitement gratuits — pour Mocky, Muse ou n'importe quel client.
audience: [dev]
source_hash: ba9ff051ec6d
---

La référence complète et toujours à jour est générée à partir des schémas du serveur : **`/api/docs`** (Swagger UI)
et **`/api/docs/json`** (OpenAPI 3.1).

## Authentification

Créez un jeton dans **Settings → API tokens** (Paramètres → Jetons d'API) et envoyez-le comme jeton bearer :

```
Authorization: Bearer spx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Les erreurs ont toujours la forme `{ "error": { "code": "…", "message": "…", "details"?: … } }`. Codes notables :
`MISSING_API_KEY` (aucune clé de fournisseur configurée), `BUDGET_EXCEEDED` (HTTP 402), `PROVIDER_ERROR`,
`VALIDATION_ERROR`.

## Parcours type pour un outil externe (Mocky, Muse…)

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

Avec le client TypeScript :

```ts
import { SprixyClient } from '@sprixy/client';

const sprixy = new SprixyClient({ baseUrl: process.env.SPRIXY_URL!, token: process.env.SPRIXY_TOKEN! });
const job = await sprixy.run({ task: 'generate', projectId, kind: 'character', prompt: 'a goblin archer', count: 1 });
if (job.status === 'succeeded') {
  const png = await sprixy.download(`/api/v1/assets/${job.outputAssetIds[0]}/export?format=png&scale=4`);
}
```

## Spécifications des tâches (`POST /api/v1/generations`)

| task | Obligatoire | Options principales |
| --- | --- | --- |
| `generate` | `projectId`, `kind` (`sprite` `character` `object` `environment` `tileset` `texture` `ui` `icon`), `prompt` | `count` 1–4, `modelId`, `width`/`height` (px natifs), `referenceAssetIds`, `loras` `[{loraId, scale}]`, `seed`, `postprocess` `{removeBackground: flood\|ai\|none, pixelize, palette: project\|auto\|none, maxColors, dither, outline, cleanup}`, `tags`, `name` |
| `variant` | `assetId`, `prompt` | `count`, `modelId`, `strength` (modèles img2img), `lockPalette` (true par défaut), `loras`, `seed` |
| `directions` | `assetId` | `directions` 4\|8, `baseDirection` south\|east, `modelId`, `lockPalette` |
| `animate` | `assetId`, `action` (inutile pour `charsheet`) | `method` video\|sheet\|charsheet (planche marche / attaque / dégâts en 4 directions en un seul appel, voir [Fournisseurs](providers.md#character-sheet-method-qwen-image-edit-2511-lora)), `frames` 2–24, `fps`, `modelId`, `resolution`, `lockPalette` |
| `removeBg` | `assetId` | `modelId` |
| `inpaint` | `assetId`, `prompt`, `rect` `{x,y,w,h}` | `image` (URI data PNG des pixels non enregistrés), `modelId`, `lockPalette`, `seed` — les pixels hors de `rect` ne sont jamais modifiés |
| `train` | `name`, `datasetId` | `modelId` (entraîneur), `steps`, `learningRate`, `triggerWord`, `trainingType`, `projectId` |

## Webhooks

Ajoutez `"webhookUrl": "https://…"` à `POST /api/v1/generations` pour être appelé à la fin de la tâche au lieu
d'interroger le serveur. Sprixy envoie en POST `{ "event": "generation.finished", "data": <generation> }` avec les
en-têtes `X-Sprixy-Event`, `X-Sprixy-Timestamp` et `X-Sprixy-Signature: sha256=<hex>`, où la signature vaut
`HMAC_SHA256(secret, timestamp + "." + rawBody)`. Obtenez (ou renouvelez) votre secret avec
`GET /api/v1/webhooks/secret`. La livraison est retentée 4 fois avec un délai croissant ; le résultat est enregistré
sur la génération.

```js
// Node verification example
const expected = crypto.createHmac('sha256', SECRET).update(`${req.headers['x-sprixy-timestamp']}.${rawBody}`).digest('hex');
const ok = req.headers['x-sprixy-signature'] === `sha256=${expected}`;
```

## Solde des fournisseurs

`GET /api/v1/providers/balance` renvoie le solde prépayé restant de chaque fournisseur (`status` : `ok`,
`needs_billing_key`, `unavailable`, `not_configured`, `shared` quand le compte utilise la clé d'un administrateur),
mis en cache 60 s (`?fresh=true` pour l'actualiser) et
actualisé après chaque tâche. fal.ai ne montre la facturation qu'aux clés de portée ADMIN : enregistrez-en une avec
`PUT /api/v1/keys/fal/billing {"key": "…"}` — elle est vérifiée, chiffrée et sert uniquement à lire le solde
(`DELETE` la supprime). OpenRouter indique les crédits du compte ou la limite restante de la clé.

## Administration {#administration}

Réservé aux administrateurs (`403` sinon). Voir [Utilisateurs et enveloppes](users.md).

| Endpoint | Rôle |
| --- | --- |
| `GET /api/v1/admin/users` | Les comptes avec leur rôle, leur enveloppe, leurs clés, leurs dépenses du jour et du mois, et les totaux |
| `POST /api/v1/admin/users` | Créer un compte : `email`, `name`, `password`, `role`, `monthlyCapUsd`, `dailyCapUsd`, `sharedKeys` |
| `PATCH /api/v1/admin/users/:id` | Modifier `name`, `role`, `password`, `disabled`, `monthlyCapUsd`, `dailyCapUsd`, `sharedKeys` |
| `DELETE /api/v1/admin/users/:id` | Supprimer le compte et tout ce qu'il possède (`409` tant qu'une tâche est en cours) |

`GET /api/v1/usage` renvoie l'enveloppe du compte dans `limits` ; une tâche qui la dépasserait échoue avec
`402 BUDGET_EXCEEDED`.

## Catalogue pour les applications reliées

Vue en lecture seule des projets partagés avec des applications (Mocky…), pour les jetons de catalogue
(`scope: "catalog"`). Voir [Utiliser vos assets dans Mocky](connected-apps.md#lapi-du-catalogue).

## Endpoints gratuits (sans appel à l'IA)

| Endpoint | Rôle |
| --- | --- |
| `POST /api/v1/tools/process` | Sans état : `{ image: https URL or data URI, steps: [...] }` → URI data PNG. Idéal pour convertir n'importe quelle image en pixel art. |
| `POST /api/v1/tools/detect-grid` | Détecter la grille de pseudo-pixels d'une image agrandie. |
| `POST /api/v1/assets/import` | Importer depuis une URL / un URI data avec une chaîne de traitement optionnelle. |
| `POST /api/v1/assets/:id/process` | Chaîne de traitement sur un asset : `preview`, `replace` ou `new` (variante). |
| `POST /api/v1/assets/:id/slice` | Découpage de planche de sprites (grille / auto) + alignement des images. |
| `POST /api/v1/animations` | Construire une animation à partir de plusieurs assets. |
| `POST /api/v1/tilesets/wang` | Jeu d'autotiles de coins Wang de 16 tuiles à partir de deux assets de texture (`lowerAssetId`, `upperAssetId`, `tileSize`, `seed`, `roughness`, `edge` ; `preview: true` renvoie un URI data). |
| `GET /api/v1/datasets/:id/export` | ZIP du jeu de données pour l'entraînement de LoRA externe (images + légendes + metadata.jsonl). |
| `POST /api/v1/assets/batch` | Actions groupées : tag / favori / déplacement / collection / suppression / traitement. |
| `GET /api/v1/meta` | Opérations de traitement avec leurs paramètres, préréglages de palette, types, formats d'export. |

Les étapes de la chaîne de traitement s'écrivent `{ "op": "...", ...params }`, par exemple :

```json
[
  { "op": "removeBackground", "tolerance": 14 },
  { "op": "pixelize", "width": 48, "height": 48 },
  { "op": "applyPalette", "presetId": "db32", "dither": "bayer4", "ditherStrength": 0.5 },
  { "op": "removeOrphans" },
  { "op": "outline", "color": "#1a1c2c" }
]
```

## Formats d'export (`GET /api/v1/assets/:id/export?format=…&scale=…`)

`png`, `gif`, `webp`, `aseprite` (calques conservés s'il a été modifié dans Sprixy), `json` (atlas), `spritesheet`
(zip : PNG + atlas JSON), `zip` (tout + images), `godot` (PNG + `.import` + SpriteFrames ou TileSet `.tres`), `unity`
(PNG + `.meta` avec rectangles de sprites, filtre Point), `phaser` (PNG + atlas JSON + JSON d'animations + extrait de
code de chargement). `POST /api/v1/exports` exporte plusieurs assets d'un coup.

## Indépendance

Sprixy ne dépend ni de Mocky ni de Muse. Ils s'intègrent via cette API publique comme n'importe quel autre client ;
tout logiciel capable d'envoyer des requêtes HTTP peut utiliser Sprixy comme moteur de génération d'assets.
