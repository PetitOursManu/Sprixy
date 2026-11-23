---
title: Serveur MCP
description: Laissez Claude Code ou n'importe quel client MCP créer, générer, retoucher, animer et exporter des assets.
audience: [dev]
source_hash: 27ec142f8fe3
---

Sprixy fournit un serveur [Model Context Protocol](https://modelcontextprotocol.io) officiel pour que des agents d'IA
(Claude Code, Claude Desktop, n'importe quel client MCP) puissent créer des projets, générer, retoucher, animer,
rechercher et exporter des assets de jeu.

Créez d'abord un jeton d'API : **Settings → API tokens** (Paramètres → Jetons d'API).

## Option A — à distance (hébergé par votre instance Sprixy)

Chaque serveur Sprixy expose un endpoint Streamable HTTP sans état sur `/mcp` :

```bash
claude mcp add --transport http sprixy https://sprixy.example.com/mcp \
  --header "Authorization: Bearer spx_YOUR_TOKEN"
```

## Option B — stdio en local

Depuis un clone de ce dépôt :

```bash
pnpm install && pnpm --filter @sprixy/mcp build
claude mcp add sprixy \
  --env SPRIXY_URL=https://sprixy.example.com \
  --env SPRIXY_TOKEN=spx_YOUR_TOKEN \
  -- node /path/to/Sprixy/packages/mcp/dist/cli.js
```

Une fois `@sprixy/mcp` publié sur npm (voir la feuille de route), la dernière ligne devient `-- npx -y @sprixy/mcp`.
En mode stdio, `sprixy_export_asset` peut écrire des fichiers directement sur le disque (`outputDir`) ; définissez
`SPRIXY_MCP_ALLOW_WRITE=false` pour le désactiver.

## Outils

| Outil | Coût | Description |
| --- | --- | --- |
| `sprixy_list_projects` | gratuit | Projets avec leur nombre d'assets et leurs palettes |
| `sprixy_get_project` | gratuit | Direction artistique complète d'un projet |
| `sprixy_create_project` | gratuit | Créer un projet avec une direction artistique |
| `sprixy_update_art_direction` | gratuit | Fusionner des modifications de la direction artistique |
| `sprixy_list_models` | gratuit | Modèles avec capacités, prix, qualité, vitesse, disponibilité de la clé |
| `sprixy_estimate_cost` | gratuit | Estimer n'importe quelle tâche avant de la lancer |
| `sprixy_get_usage` | gratuit | Dépenses et budgets |
| `sprixy_get_capabilities` | gratuit | Opérations de traitement, palettes, types, formats d'export |
| `sprixy_list_loras` | gratuit | LoRA préréglées, importées et entraînées |
| `sprixy_generate_asset` | payant | Générer des assets selon la direction artistique (renvoie des aperçus) |
| `sprixy_create_variant` | payant | Variantes IA d'un asset (palette verrouillée) |
| `sprixy_generate_directions` | payant | Vues du personnage en 4/8 directions + planche |
| `sprixy_animate_asset` | payant | Animation par modèle vidéo, méthode planche de sprites ou fiche personnage complète en 4 directions (marche / attaque / dégâts) |
| `sprixy_remove_background_ai` | payant | Détourage BiRefNet |
| `sprixy_edit_region` | payant | Repeindre un rectangle (inpainting), palette verrouillée |
| `sprixy_get_generation` / `sprixy_list_generations` / `sprixy_cancel_generation` | gratuit | Suivi des tâches |
| `sprixy_search_assets` / `sprixy_get_asset` / `sprixy_update_asset` | gratuit | Bibliothèque |
| `sprixy_import_image` | gratuit | Import + conversion optionnelle en pixel art |
| `sprixy_process_asset` | gratuit | Chaîne de traitement déterministe |
| `sprixy_slice_spritesheet` | gratuit | Découper et aligner les images |
| `sprixy_build_autotile` | gratuit | Jeu de terrains Wang de 16 tuiles à partir de deux textures |
| `sprixy_export_asset` | gratuit | PNG / GIF / WebP / planche de sprites / ZIP / Godot / Unity / Phaser |

Les outils payants s'exécutent avec les propres clés de fournisseur de l'utilisateur et respectent les budgets
configurés dans Sprixy (une tâche qui les dépasserait échoue avec `BUDGET_EXCEEDED`). Les outils de génération
attendent la fin de la tâche par défaut (`wait: false` pour rendre la main immédiatement) et renvoient des aperçus PNG
agrandis sous forme de contenu image.

## Exemples de prompts pour Claude Code

- « Crée un projet Sprixy *Neon Runner* avec la palette Sweetie 16 et des sprites 32×32 en vue de côté, puis génère un
  personnage de coursier à capuche et exporte-le pour Godot dans `./assets/sprites`. »
- « Estime le coût d'un cycle de marche pour l'asset ast_… avec la méthode vidéo, puis lance-le s'il coûte moins de
  0,50 $. »
- « Trouve tous mes assets `enemy`, applique-leur la palette du projet et un contour noir, et exporte-les en atlas
  Phaser. »
