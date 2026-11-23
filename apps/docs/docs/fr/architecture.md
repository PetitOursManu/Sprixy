---
title: Architecture
description: Comment Sprixy est construit : paquets, chaîne de génération, modèle de données et sécurité.
audience: [dev]
source_hash: b78155414dec
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

## Paquets

| Paquet | Rôle | Remarques |
| --- | --- | --- |
| `@sprixy/core` | Moteur de pixel art déterministe | Aucune dépendance, travaille sur `RGBAImage {width,height,data}`. Le même code dans le serveur, le navigateur (éditeur, extraction de palette) et le MCP. |
| `@sprixy/client` | Client REST | Basé sur `fetch`, transport interchangeable (utilisé par l'endpoint MCP hébergé par le serveur via `app.inject`). |
| `@sprixy/mcp` | Serveur MCP | `createSprixyMcpServer(client)` + CLI stdio (`sprixy-mcp`). |
| `@sprixy/server` | API | Fastify 5, `fastify-type-provider-zod`, `node:sqlite`, `sharp` pour les codecs, `gifenc` pour le GIF, `fflate` pour le ZIP, `ffmpeg` pour les images des vidéos. |
| `@sprixy/web` | Interface | React 19, React Router 7, TanStack Query, design system CSS écrit à la main, éditeur sur canvas. |

## Chaîne de génération

1. **Planifier** (`services/jobs.ts → planJob`) : valider la spécification de la tâche, charger la direction
   artistique du projet, choisir le modèle (explicite → préférence du projet → défaut), résoudre les LoRA (uniquement
   celles dont la *famille* correspond au modèle), construire le prompt final
   (`services/artDirection.ts → buildPrompt`), préparer les images de référence (agrandies au plus proche voisin et
   aplaties sur une couleur clé), et calculer une estimation du coût de chaque appel au fournisseur.
2. **Contrôler** : présence de la clé de fournisseur (BYOK), limites de budget (`services/budget.ts`, HTTP 402).
3. **Exécuter** de façon asynchrone : la ligne de génération passe par `queued → running → succeeded | failed | canceled`.
   Les tâches fal passent par l'API de file d'attente ; l'identifiant de requête est conservé pour que les tâches en un
   seul appel reprennent après un redémarrage.
4. **Post-traiter de façon déterministe** (`toSprite`) : suppression du fond par remplissage (ou BiRefNet sur
   demande), recadrage sur le contenu, pixellisation sur la grille native par échantillonnage à vote majoritaire,
   application / réduction de la palette (+ tramage), durcissement de l'alpha, nettoyage des pixels isolés, contour
   optionnel.
5. **Stocker** le résultat comme asset (PNG) et conserver la sortie brute de l'IA comme sa *source*, pour pouvoir la
   retraiter plus tard gratuitement.

Tâches en plusieurs étapes :

- **directions** – un appel d'édition par direction non symétrisable ; les vues orientées vers l'ouest sont des
  retournements horizontaux ; un asset planche est assemblé.
- **animate / video** – le sprite est complété par des marges, agrandi et aplati, puis envoyé à un modèle
  image-vers-vidéo ; les images sont extraites avec ffmpeg, nettoyées, pixellisées à la taille avec marges,
  verrouillées sur la palette, recadrées sur l'union de leurs contours et assemblées.
- **animate / sheet** – un modèle d'édition dessine une grille d'images ; les images sont découpées automatiquement
  (composantes connexes), ramenées à la densité de pixels de la source, alignées sur la ligne de base et assemblées.
- **train** – les images du jeu de données sont agrandies (plus proche voisin), légendées et zippées, envoyées sur le
  stockage fal puis à un entraîneur ; la LoRA obtenue est enregistrée avec la famille de l'entraîneur.

## Modèle de données (SQLite)

`users`, `sessions`, `api_tokens`, `provider_keys` (chiffrées), `user_settings` (budgets), `projects` (direction
artistique en JSON), `assets` (fichier, fichier source, images en JSON, métadonnées en JSON, parent pour les
variantes), `asset_tags`, `collections`, `collection_assets`, `generations` (tâche, modèle, prompts, statut,
identifiants côté fournisseur, coûts estimé et réel), `loras`, `datasets`, `dataset_images` (avec `rights_confirmed`).

Les migrations sont uniquement additives (`apps/server/src/db/migrations.ts`, suivies avec `PRAGMA user_version`).

## Sécurité

- Clés de fournisseur : AES-256-GCM avec `SPRIXY_MASTER_KEY` ; seuls les 4 derniers caractères sont renvoyés,
  jamais la clé entière.
- Mots de passe : scrypt. Sessions : jetons aléatoires stockés hachés (SHA-256), cookies `HttpOnly; SameSite=Lax`.
- Jetons d'API (`spx_…`) : stockés hachés, ne peuvent être créés que depuis une session de navigateur, révocables.
- Chaque requête est limitée par `user_id` ; les chemins de fichiers sont résolus à l'intérieur de la racine de
  stockage.
- Les imports d'images distantes n'acceptent que des URL `https://` ou des URI `data:image/…`, avec des limites de
  taille.
