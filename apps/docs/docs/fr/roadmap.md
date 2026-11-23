---
title: Feuille de route
description: Ce qui est fait, phase par phase, et ce qui vient ensuite.
source_hash: f01dce8e1566
---

Sprixy est organisé en phases fonctionnelles. Chaque phase livre des fonctionnalités qui marchent (pas de boutons
factices, pas de générations simulées), des tests et de la documentation.

## Phase 1 — Moteur déterministe ✅
`@sprixy/core` : modèle d'image RGBA, science des couleurs OKLab, extraction de palette par median-cut + k-means,
application de palette avec tramage Floyd–Steinberg / Atkinson / Bayer, pixellisation sur une vraie grille avec
détection automatique de la grille, redimensionnement au plus proche voisin, suppression du fond par remplissage /
couleur clé, durcissement de l'alpha, nettoyage des pixels isolés, trous et parasites, contours, découpage de planches
de sprites (grille et automatique), alignement des images, assemblage, recoloration, tuiles sans couture, chaîne de
traitement déclarative, 9 préréglages de palette. Tests unitaires.

## Phase 2 — Serveur, BYOK et fournisseurs ✅
Fastify + SQLite, comptes, sessions, jetons d'API, clés de fournisseur chiffrées, adaptateurs fal.ai et OpenRouter,
catalogue de modèles sélectionnés avec prix en direct, direction artistique et constructeur de prompts, tâches
asynchrones (génération, variante, directions, animation, détourage IA, entraînement de LoRA) avec reprise des tâches
fal, budgets et statistiques de consommation.

## Phase 3 — Bibliothèque, traitement et exports ✅
Assets, variantes, tags, favoris, collections, actions groupées, import avec conversion, endpoints de traitement,
découpage, constructeur d'animations, exports (PNG, GIF, WebP, planche de sprites + JSON, ZIP, Godot, Unity, Phaser),
documentation OpenAPI.

## Phase 4 — Intégrations ✅
`@sprixy/client`, serveur MCP officiel (`/mcp` distant + CLI stdio), documentation d'intégration pour Mocky / Muse /
n'importe quel client.

## Phase 5 — Application web et éditeur ✅
Interface du studio (thème clair issu de la refonte de Mocky : barre latérale bleu marine, cartes blanches sur une
grille de pixels, touches d'orange, logo officiel), génération avec estimations en direct, éditeur de direction
artistique (extraction de palette, import .hex/.gpl), fiche d'asset avec lecteur d'animation, éditeur de pixels à
calques avec images et pelure d'oignon, LoRA et jeux de données, consommation et budgets, paramètres.

## Phase 6 — Déploiement ✅
Dockerfile (Node 24 + ffmpeg, utilisateur non root, contrôle de santé), docker compose, guide Coolify, CI.

## Phase 7 — Validation en conditions réelles et fonctionnalités concurrentielles ✅
Toutes les tâches d'IA ont été testées avec de vrais appels fal.ai (génération, variantes, directions, animations
vidéo et par planche, détourage IA, retouche de zone) et corrigées en conséquence (ombres sur la couleur clé, masques
de détourage, orientation des animations). Ajouts issus de l'étude concurrentielle
([analyse concurrentielle](competitive-analysis.md)) : retouche IA d'une sélection, jeux de terrains en autotiles de
Wang avec terrains Godot et wangsets Tiled, export natif `.aseprite`, webhooks de tâches, export de jeux de données
pour l'entraînement de LoRA externe, corrections de mise en page sur mobile.

Également validés sur des essais réels : des modèles plus gros (FLUX.2 dev 32B, FLUX.2 pro, Qwen Image 2512, Qwen
Image Edit 2511) avec des comparaisons dans [Fournisseurs](providers.md), de nouvelles familles et préréglages de
LoRA, et la méthode d'animation **fiche personnage** en un seul appel (4 directions × marche / attaque / dégâts) via
une LoRA communautaire de planche de sprites.

## Ensuite
- Publier `@sprixy/mcp`, `@sprixy/client` et `@sprixy/core` sur npm.
- Valider sur des essais réels l'entraînement de LoRA sur fal.ai.
- D'autres fournisseurs (Replicate, Together, endpoint ComfyUI auto-hébergé) via l'interface `ProviderAdapter`.
- Animation pilotée par squelette / points clés ; tuiles blob-47, isométriques et hexagonales ; normal maps.
- Espaces de travail d'équipe et projets partagés ; quotas par utilisateur fixés par l'administrateur.
- Import des fichiers Aseprite `.aseprite`.
- Agrandissement par IA respectueux de la palette et option de modèle « nettoyage des pixels ».
