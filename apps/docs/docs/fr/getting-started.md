---
title: Prise en main
description: D'un serveur vide à votre premier sprite en pixel art parfait, en cinq minutes.
source_hash: 4e045561ca97
---

:::steps id=start
1. **Déployez Sprixy.** Avec Coolify ou Docker Compose — voir [Déployer](deployment.md). Tout tourne dans un seul
   conteneur.
2. **Créez le compte administrateur.** Ouvrez votre instance : le premier compte créé devient administrateur, puis les
   inscriptions se ferment.
3. **Ajoutez une clé de fournisseur.** **Settings → Provider keys** (Paramètres → Clés de fournisseur) : collez une
   [clé fal.ai](https://fal.ai/dashboard/keys) (recommandé) et/ou une [clé OpenRouter](https://openrouter.ai/keys).
   Sprixy la vérifie, puis la stocke chiffrée.
4. **Créez un projet.** **+ New project** (nouveau projet) : choisissez un préréglage de palette, une taille de sprite
   native (32×32 est un bon début) et une perspective. C'est la [[direction artistique|art-direction]] du projet.
5. **Générez.** Dans le projet, **Generate** (Générer) : choisissez un type (Character, Object, Tileset…), décrivez
   uniquement le sujet — « un archer gobelin avec une cape verte à capuche » — et appuyez sur **Generate**.
   L'estimation s'affiche avant le lancement.
6. **Utilisez-le.** Ouvrez le résultat : animez-le, créez une [[fiche personnage|character-sheet]], retouchez les
   pixels, puis **Export** (Exporter) pour Godot, Unity, Phaser ou Aseprite.
:::

:::tip Commencez petit
Z-Image Turbo coûte environ 0,005 $ par image et donne les sprites de 16 à 32 px les plus nets. Les modèles plus gros
ne deviennent intéressants qu'à partir de 64 px — voir la [comparaison des modèles](providers.md#model-comparison-real-runs-2026-11-23).
:::

## Ce que ça coûte

Vous payez directement votre fournisseur ; Sprixy n'ajoute rien. Prix habituels sur fal.ai :

| Tâche | Coût habituel |
| --- | --- |
| Un sprite 32×32 (Z-Image Turbo) | ~0,005 $ |
| 4 sprites d'un coup | ~0,021 $ |
| Fiche personnage, 24 images (Qwen Image Edit 2511 + LoRA) | ~0,021 $ |
| Vues en 4 directions (FLUX.2 klein 9B) | ~0,02 $ |
| Animation vidéo, 2 s (Wan 2.2) | ~0,04–0,08 $ |
| Suppression du fond par IA (BiRefNet) | ~0,002 $ |

La pixellisation, les palettes, le détourage par couleur, les autotiles, le découpage et les exports sont toujours
gratuits : ils tournent sur votre serveur.

:::note Budgets
Définissez une limite mensuelle, quotidienne ou par tâche dans **Usage & budget** (Consommation et budget) : une tâche
qui la dépasserait est refusée avant toute facturation. Votre solde fal.ai restant peut s'afficher dans la barre du
haut — voir [Fournisseurs](providers.md#balance-in-the-top-bar).
:::
