---
title: Use your assets in Mocky
description: Share chosen projects with apps such as Mocky through a read-only catalog token, and use your sprites in designs.
audience: [user, dev]
---

Your sprites, icons and tiles can go into designs made with [Mocky](https://github.com/PetitOursManu/Mocky) — a game's
landing page, a store page, a poster. Mocky reads them from Sprixy through a **catalog**: a read-only view of the
projects you decide to share, and nothing else.

:::why Why a separate kind of token
A regular API token acts as you: it can generate, edit and spend your budget. An app that only shows your assets does
not need that, so it gets a **read-only catalog token**, which can call nothing but the catalog. Mocky refuses a token
with full access.
:::

## Share a project

Open the project and click **Share with apps** at the top (it turns to **Shared with apps**). Click it again to stop
sharing: the assets disappear from the catalog at once. Projects you do not share stay invisible to every app.

## Connect Mocky

:::steps
1. **Settings → API tokens.** Name the token "Mocky", choose **Read-only catalog**, then **Create token**, and copy it.
2. **In Mocky, Settings → Sprixy.** Paste your Sprixy's public address (for example `https://sprixy.example.com`) and the
   token, then **Connect Sprixy**. Mocky lists the projects you share.
3. **Ask for a design.** Ask your assistant in Mocky for a design that uses your Sprixy assets: it searches them,
   looks at the thumbnails and adds the ones it picks.
:::

:::note
Mocky calls Sprixy from its server and only reaches public addresses: a Sprixy on `localhost` or on a private network
cannot be connected. On Coolify, use the domain of your Sprixy service.
:::

Revoke the token under **Settings → API tokens** to cut Mocky off at any time.

## Crisp pixels

Pixel art resized by a browser is smoothed into a blur. The catalog therefore serves every image **already enlarged by
a whole number** with nearest-neighbour — about 512 px on its longest side by default — and Mocky shows it whole, with
`image-rendering: pixelated`. An animation or a sprite sheet gives one frame (the first by default).

## The catalog API

For any app, not only Mocky. Every call takes `Authorization: Bearer spx_…` with a catalog token (a full token works
too); a catalog token gets `403 TOKEN_SCOPE` on every other endpoint.

| Endpoint | Returns |
| --- | --- |
| `GET /api/v1/catalog` | The account's name and its shared projects: name, description, asset count, palette, perspective, sprite size |
| `GET /api/v1/catalog/assets?q=&kind=&projectId=&tag=&limit=&offset=` | Shared assets matching every word of `q` (name, tags, prompt, project): name, kind, native size of one frame, frame count, tags, prompt, palette, `image` (URL, enlarged size, scale), `thumbnailUrl`, `credit` |
| `GET /api/v1/catalog/assets/:id` | One shared asset |
| `GET /api/v1/catalog/assets/:id/image?size=&scale=&frame=` | The PNG, enlarged by a whole number: about `size` px on its longest side (default 512, at most 2048), or exactly `scale` times; `frame` picks a frame of an animation. The header `X-Pixel-Scale` gives the factor |

Create a catalog token with `POST /api/v1/tokens {"name": "…", "scope": "catalog"}` from a signed-in session; share a
project with `PATCH /api/v1/projects/:id {"catalogShared": true}`.
