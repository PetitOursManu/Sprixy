---
title: Glossaire
description: Les termes employés par Sprixy, réunis en un seul endroit.
source_hash: 28e64e9afa18
---

## Direction artistique {#art-direction}

Les réglages d'un projet — palette, tailles, perspective, éclairage, ombrage, niveau de détail, contour, références,
modèles et LoRA préférés — que Sprixy inscrit dans chaque prompt et applique à chaque résultat.

## BYOK {#byok}

*Bring your own key* (apportez votre propre clé). Vous enregistrez votre propre clé fal.ai ou OpenRouter ; les tâches
sont facturées sur votre compte au prix du fournisseur, et la clé est chiffrée sur votre serveur.

## Fiche personnage {#character-sheet}

Une planche de 6×4 images de 32×48 — 3 images de marche, 2 d'attaque et 1 de dégâts pour chacune des quatre
directions — dessinée en un seul appel par Qwen Image Edit 2511 avec une LoRA de planche de sprites en pixel art.

## LoRA {#lora}

Un petit module complémentaire d'un modèle d'image qui lui apprend un style ou un sujet. Une LoRA ne fonctionne qu'avec
la famille de modèles pour laquelle elle a été entraînée (Z-Image, FLUX.2 klein, FLUX.2 dev, Qwen Image, FLUX.1).

## MCP {#mcp}

*Model Context Protocol.* Le standard qui permet à un assistant d'IA comme Claude d'utiliser des outils. Le serveur
MCP de Sprixy lui permet de créer des projets, de générer, d'animer et d'exporter des assets.

## Taille native {#native-size}

La taille réelle en pixels d'un asset dans le jeu (par exemple 32×32). Les images d'IA sont générées plus grandes,
puis ramenées sur cette grille.

## Pixelliser {#pixelize}

Transformer une grande image en vrai pixel art à la taille native : une couleur par case, choisie par vote
majoritaire, pour que les bords restent nets.

## Tuiles de Wang {#wang}

Un jeu de 16 tuiles, une par combinaison de terrains aux quatre coins, pour que toute carte de deux terrains se
raccorde sans couture. Godot l'appelle « Match Corners », Tiled un wangset de coins.
