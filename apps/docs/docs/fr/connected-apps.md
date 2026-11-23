---
title: Utiliser vos assets dans Mocky
description: Partagez des projets choisis avec des applications comme Mocky via un jeton de catalogue en lecture seule, et utilisez vos sprites dans vos designs.
audience: [user, dev]
source_hash: 95c322d23b6f
---

Vos sprites, icônes et tuiles peuvent entrer dans des designs faits avec [Mocky](https://github.com/PetitOursManu/Mocky)
— la page d'un jeu, une fiche de boutique, une affiche. Mocky les lit dans Sprixy à travers un **catalogue** : une vue
en lecture seule des projets que vous décidez de partager, et de rien d'autre.

:::why Pourquoi un type de jeton à part
Un jeton d'API ordinaire agit en votre nom : il peut générer, modifier et dépenser votre budget. Une application qui
ne fait que montrer vos assets n'en a pas besoin : elle reçoit un **jeton de catalogue en lecture seule**, qui ne peut
appeler que le catalogue. Mocky refuse un jeton à accès complet.
:::

## Partager un projet

Ouvrez le projet et cliquez sur **Share with apps** en haut (le bouton devient **Shared with apps**). Cliquez de
nouveau pour arrêter le partage : les assets disparaissent aussitôt du catalogue. Les projets que vous ne partagez pas
restent invisibles pour toutes les applications.

## Relier Mocky

:::steps
1. **Settings → API tokens.** Nommez le jeton « Mocky », choisissez **Read-only catalog**, puis **Create token**, et
   copiez-le.
2. **Dans Mocky, Réglages → Sprixy.** Collez l'adresse publique de votre Sprixy (par exemple `https://sprixy.example.com`) et
   le jeton, puis **Relier Sprixy**. Mocky liste les projets que vous partagez.
3. **Demandez un design.** Demandez à votre assistant dans Mocky un design qui utilise vos assets Sprixy : il les
   cherche, regarde les vignettes et ajoute ceux qu'il choisit.
:::

:::note
Mocky appelle Sprixy depuis son serveur et n'atteint que des adresses publiques : un Sprixy sur `localhost` ou sur un
réseau privé ne peut pas être relié. Sur Coolify, utilisez le domaine de votre service Sprixy.
:::

Révoquez le jeton dans **Settings → API tokens** pour couper l'accès de Mocky à tout moment.

## Des pixels nets

Du pixel art redimensionné par un navigateur est lissé jusqu'au flou. Le catalogue sert donc chaque image **déjà
agrandie d'un nombre entier de fois** au plus proche voisin — environ 512 px sur son plus grand côté par défaut — et
Mocky la montre entière, avec `image-rendering: pixelated`. Une animation ou une planche de sprites donne une image (la
première par défaut).

## L'API du catalogue

Pour toute application, pas seulement Mocky. Chaque appel prend `Authorization: Bearer spx_…` avec un jeton de
catalogue (un jeton complet fonctionne aussi) ; un jeton de catalogue reçoit `403 TOKEN_SCOPE` sur tous les autres
endpoints.

| Endpoint | Renvoie |
| --- | --- |
| `GET /api/v1/catalog` | Le nom du compte et ses projets partagés : nom, description, nombre d'assets, palette, perspective, taille des sprites |
| `GET /api/v1/catalog/assets?q=&kind=&projectId=&tag=&limit=&offset=` | Les assets partagés qui contiennent chaque mot de `q` (nom, tags, prompt, projet) : nom, type, taille native d'une image, nombre d'images, tags, prompt, palette, `image` (URL, taille agrandie, facteur), `thumbnailUrl`, `credit` |
| `GET /api/v1/catalog/assets/:id` | Un asset partagé |
| `GET /api/v1/catalog/assets/:id/image?size=&scale=&frame=` | Le PNG, agrandi d'un nombre entier de fois : environ `size` px sur son plus grand côté (512 par défaut, 2048 au plus), ou exactement `scale` fois ; `frame` choisit une image d'une animation. L'en-tête `X-Pixel-Scale` donne le facteur |

Créez un jeton de catalogue avec `POST /api/v1/tokens {"name": "…", "scope": "catalog"}` depuis une session connectée ;
partagez un projet avec `PATCH /api/v1/projects/:id {"catalogShared": true}`.
