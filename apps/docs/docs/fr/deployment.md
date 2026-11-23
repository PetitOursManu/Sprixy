---
title: Déployer
description: Faire tourner Sprixy avec Coolify ou Docker Compose — un conteneur, un volume, pas de GPU.
audience: [admin]
source_hash: b94cb069d56c
---

Sprixy est un conteneur unique : l'application web, l'API REST, l'endpoint MCP et cette documentation (servie sur
`/docs`). Il conserve une base SQLite et ses fichiers sur un seul volume. Aucun GPU n'est nécessaire — le travail d'IA
tourne chez vos fournisseurs, le traitement d'image tourne sur le CPU.

:::vars
domain = sprixy.example.com | Votre domaine
:::

:::tabs group=host
@tab Coolify
Le dépôt fournit [`docker-compose.coolify.yml`](https://github.com/PetitOursManu/Sprixy/blob/main/docker-compose.coolify.yml),
conçu pour Coolify : aucun port publié (le proxy de Coolify sert votre domaine en HTTPS), une clé maîtresse générée par
Coolify, des cookies sécurisés, un volume `/data` persistant et un contrôle de santé.

:::steps id=coolify
1. **Ajoutez le dépôt.** Dans votre projet Coolify : **+ New → Public Repository** (ou *Private Repository (GitHub App)*
   pour un fork), collez `https://github.com/PetitOursManu/Sprixy`, branche `main`.
2. **Choisissez le fichier compose.** Build Pack **Docker Compose**, Base Directory `/`, Docker Compose Location
   `/docker-compose.coolify.yml`.
3. **Définissez le domaine.** Sur le service `sprixy`, réglez le domaine sur `https://{{domain}}`. Le port 3210 est
   déjà déclaré ; si votre version de Coolify le demande, saisissez `https://{{domain}}:3210`. Faites d'abord pointer
   l'enregistrement DNS vers le VPS.
4. **Déployez.** Le premier build prend quelques minutes (dépendances, application web, documentation, ffmpeg).
5. **Créez votre compte tout de suite.** Ouvrez `https://{{domain}}` : le premier compte devient administrateur, puis
   les inscriptions se ferment.
6. **Sauvegardez la clé maîtresse.** Dans **Environment Variables**, copiez `SERVICE_REALBASE64_MASTERKEY` dans votre
   gestionnaire de mots de passe. Elle chiffre vos clés de fournisseur.
7. **Ajoutez une clé de fournisseur.** Dans Sprixy, **Settings → Provider keys** : collez votre clé fal.ai et/ou
   OpenRouter.
:::

Variables optionnelles (onglet Environment Variables) : `SPRIXY_ALLOW_SIGNUP=true` pour permettre à d'autres
personnes de s'inscrire, `SPRIXY_MAX_UPLOAD_MB`, `LOG_LEVEL`.

**Mises à jour :** cliquez sur **Redeploy**, ou activez *Auto Deploy* pour redéployer à chaque push. Les données
restent dans le volume et les migrations s'exécutent au démarrage.

@tab Docker Compose
:::steps id=compose
1. **Récupérez le code.**
   ```bash
   git clone https://github.com/PetitOursManu/Sprixy.git && cd Sprixy
   cp .env.example .env
   ```
2. **Définissez une clé maîtresse.** Générez-en une et collez-la après `SPRIXY_MASTER_KEY=` dans `.env` :
   ```bash
   openssl rand -base64 32
   ```
   Derrière HTTPS, définissez aussi `SPRIXY_SECURE_COOKIES=true`.
3. **Démarrez-le.**
   ```bash
   docker compose up -d --build
   ```
4. **Vérifiez qu'il répond.**
   ```bash
   curl http://localhost:3210/api/health
   ```
5. **Créez votre compte** sur `http://localhost:3210` (ou `https://{{domain}}` derrière votre proxy). Le premier
   compte devient administrateur.
:::

**Mises à jour :** `git pull && docker compose up -d --build`. Les migrations s'exécutent au démarrage.
:::

:::warning Conservez la clé maîtresse
`SPRIXY_MASTER_KEY` (Coolify : `SERVICE_REALBASE64_MASTERKEY`) chiffre les clés de fournisseur stockées dans Sprixy.
Sans elle, elles ne peuvent pas être déchiffrées et doivent être saisies à nouveau. Gardez-la dans votre gestionnaire
de mots de passe, à côté de vos sauvegardes.
:::

## Déplacer une installation existante

Copiez l'ancien volume `/data` dans le nouveau **et** réglez la clé maîtresse sur l'ancienne valeur avant le premier
démarrage. Sinon, les clés de fournisseur stockées ne peuvent pas être déchiffrées — les saisir à nouveau dans
Settings fonctionne aussi.

:::why Pourquoi une ressource Dockerfile fonctionne aussi
Coolify peut construire directement le `Dockerfile` : Build Pack *Dockerfile*, port `3210`, un volume monté sur
`/data`, et les variables `SPRIXY_MASTER_KEY` (`openssl rand -base64 32`) et `SPRIXY_SECURE_COOKIES=true` définies à la
main. Le fichier compose vous épargne seulement ces étapes.
:::

## Variables d'environnement

| Variable | Valeur par défaut | Description |
| --- | --- | --- |
| `SPRIXY_MASTER_KEY` | — | Clé AES-256 (base64/hex, 32 octets) pour les clés de fournisseur. Si elle n'est pas définie, une clé est générée dans le dossier de données (développement uniquement). |
| `SPRIXY_ALLOW_SIGNUP` | `false` | Autoriser les inscriptions après le premier compte administrateur. |
| `SPRIXY_SECURE_COOKIES` | `false` | Marquer le cookie de session `Secure` (à activer derrière HTTPS). |
| `SPRIXY_DATA_DIR` | `/data` (image) / `./data` | Base de données et fichiers. |
| `PORT` / `HOST` | `3210` / `0.0.0.0` | Adresse d'écoute. |
| `SPRIXY_PUBLIC_URL` | — | URL publique (à titre informatif). |
| `FFMPEG_PATH` | `/usr/bin/ffmpeg` (image) | ffmpeg utilisé pour extraire les images des animations. |
| `SPRIXY_MAX_UPLOAD_MB` | `50` | Taille maximale d'envoi par fichier. |
| `SPRIXY_SESSION_DAYS` | `30` | Durée de vie d'une session. |
| `SPRIXY_POLL_INTERVAL_MS` | `1500` | Intervalle d'interrogation de la file fal. |
| `SPRIXY_JOB_TIMEOUT_MS` | `1800000` | Délai maximal strict par tâche. |
| `LOG_LEVEL` | `info` | Niveau de journalisation Fastify/pino. |

## Proxy inverse

N'importe quel proxy convient (Traefik dans Coolify, Caddy, nginx). Autorisez des corps de requête d'environ 50 Mo
(envois de fichiers, enregistrements de l'éditeur) et gardez les délais par défaut : les tâches longues sont
asynchrones et interrogées périodiquement, donc aucune requête ne reste ouverte longtemps.

## Sauvegardes

Sauvegardez le volume `/data` — arrêtez le conteneur, ou faites une copie à chaud avec
`sqlite3 sprixy.db ".backup backup.db"` — et conservez la clé maîtresse avec. Dans Coolify, le volume apparaît sous
**Persistent Storage** ; vous pouvez aussi lancer :

```bash
docker run --rm -v <volume>:/data -v $PWD:/b alpine tar czf /b/sprixy-data.tgz /data
```

## Mises à niveau

Récupérez, reconstruisez, redémarrez. Les migrations de la base de données s'exécutent automatiquement au démarrage.
Les tâches fal.ai interrompues reprennent ; les autres tâches en cours sont marquées comme interrompues, et Sprixy ne
déclenche jamais de double facturation.
