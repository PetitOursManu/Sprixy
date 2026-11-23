---
title: Analyse concurrentielle
description: PixelLab, Retro Diffusion et SpriteKiln comparés à Sprixy, et ce que Sprixy leur a emprunté.
source_hash: 8735f19234e4
---

Étude réalisée le 23/11/2026 à partir des sites publics, de la documentation, des références d'API et des dépôts de
ces outils (sources à la fin). L'objectif était d'identifier les fonctionnalités pertinentes, **pas** de copier du code
propriétaire : Sprixy ne contient aucun code de ces produits.

## Positionnement en un coup d'œil

| | PixelLab | Retro Diffusion | SpriteKiln (brunocpf) | **Sprixy** |
| --- | --- | --- | --- | --- |
| Hébergement | SaaS | SaaS (+ extension Aseprite locale payante) | Local uniquement (ComfyUI) | **Auto-hébergé, sans GPU** |
| Tarification | Abonnement + API facturée à l'appel | Solde prépayé, à l'appel | Gratuit, demande ~24 Go de VRAM | **BYOK** (vos clés fal.ai / OpenRouter) |
| Modèles | Propriétaires | Propriétaires (styles personnalisés entraînables) | Z-Image Turbo, FLUX.2 klein, Qwen-Image-Edit, Wan 2.2 | **Tous** : catalogue fal.ai sélectionné + tous les modèles d'image OpenRouter |
| API / MCP | REST v2 + MCP hébergé | REST v2 + MCP hébergé | CLI / interface locale | **REST + OpenAPI + MCP (distant et stdio) + client TS + webhooks** |

« SpriteKiln » n'a pas de site produit officiel ; le projet le plus proche est le pack ComfyUI open source
`brunocpf/spritekiln`. Il existe aussi un autre `spritekiln` sans rapport (moteur de rendu procédural de la 3D vers des
sprites, MCP, exports vers les moteurs).

## Matrice des fonctionnalités

| Fonctionnalité | PixelLab | Retro Diffusion | SpriteKiln | Sprixy |
| --- | --- | --- | --- | --- |
| Texte → sprite, préréglages de style | ✓ | ✓ (80–100 styles) | ✓ (37 préréglages) | ✓ types + direction artistique par projet |
| Vraie grille de pixels / palette verrouillée | ✓ | ✓ (« true grid ») | ✓ | ✓ moteur déterministe (gratuit) |
| Références de style | ✓ | ✓ (jusqu'à 9) | ✓ | ✓ (jusqu'à 4, modèles d'édition) |
| 4 / 8 directions | ✓ | ✓ (8) | ✓ | ✓ (vues ouest obtenues gratuitement par symétrie) |
| Animation à partir d'une image | ✓ (texte, squelette) | ✓ (préréglages de 4 à 16 images) | ✓ (Wan 2.2) | ✓ vidéo (Wan) ou méthode planche de sprites, palette verrouillée |
| Animation par squelette / points clés | ✓ | — | parties articulées | — (feuille de route) |
| Tilesets en autotiles de Wang | ✓ (coins, 16 tuiles, lower/upper) | ✓ (inside/outside) | ✓ (wang16, blob47) | ✓ jeu de coins de 16 tuiles à partir de 2 textures (gratuit) + terrains Godot + wangsets Tiled |
| Tuiles blob-47 / hexagonales / isométriques | ✓ (Tiles Pro) | ✓ | blob47 | — (feuille de route) |
| Inpainting / retouche de zone | ✓ | ✓ | ✓ | ✓ retouche IA d'une sélection (pixels extérieurs intacts) |
| Suppression du fond | ✓ | ✓ | — | ✓ remplissage / couleur clé gratuits + BiRefNet |
| Outils de palette (réduction, conversion, Lospec) | ✓ | ✓ | ✓ | ✓ 9 préréglages, extraction, import .hex/.gpl, tramage |
| Entraînement de styles personnalisés | — | ✓ « My Styles » | — | ✓ entraînement de LoRA (fal.ai) + export pour entraînement externe |
| Éditeur de pixels intégré | ✓ (Pixelorama) | — | — | ✓ éditeur à calques avec images et pelure d'oignon |
| Intégration Aseprite | extension | extension | JSON Aseprite | ✓ export natif `.aseprite` (calques conservés) |
| Exports vers les moteurs | disposition de tileset Godot | — | normal maps Godot / Unity / Unreal | ✓ Godot (SpriteFrames, TileSet + terrains), Unity (.meta), Phaser, Tiled |
| Normal maps | ✓ | — | ✓ | — (feuille de route) |
| Coût avant chaque appel | grille de prix par appel | `check_cost` | n/a | ✓ estimations en direct + budgets / limites (HTTP 402) |

## Ce que Sprixy a retenu de l'étude

- **Le vocabulaire de terrains lower/upper et le jeu de coins de 16 tuiles** — le standard de fait (PixelLab, Godot
  « Match Corners », wangsets de coins Tiled). Implémenté sous forme de générateur déterministe gratuit.
- **Retouche de zone / inpainting** — tous les concurrents l'ont ; implémenté avec une garantie stricte « rien ne
  change hors de la sélection » et le verrouillage de la palette.
- **Aseprite** — l'outil courant des artistes ; pris en charge par un export de fichier natif plutôt que par un
  plugin.
- **Transparence des coûts** — la vérification gratuite du coût de Retro Diffusion a conforté l'endpoint d'estimation
  de Sprixy, complété par des budgets.

## Lacunes à combler ensuite (voir la feuille de route)

1. Animation pilotée par squelette / points clés (l'élément différenciant de PixelLab).
2. Autotiles blob-47, tuiles isométriques et hexagonales.
3. Normal maps pour l'éclairage 2D (Godot, Unity URP 2D).
4. Fonctionnalités de persistance des personnages (tenues, états) construites sur les variantes.

## Sources

- PixelLab : https://www.pixellab.ai/ · https://www.pixellab.ai/docs · https://www.pixellab.ai/docs/tools/create-tileset · https://www.pixellab.ai/pixellab-api · https://www.pixellab.ai/mcp
- Retro Diffusion : https://www.retrodiffusion.ai/ · https://www.retrodiffusion.ai/pricing · https://www.retrodiffusion.ai/styles/ · https://retrodiffusion.ai/app/guide/api · https://github.com/Retro-Diffusion/retro-diffusion-mcp
- SpriteKiln : https://github.com/brunocpf/spritekiln · https://github.com/LucasJRamos/spritekiln
