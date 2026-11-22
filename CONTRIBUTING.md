# Contributing to Sprixy

Thanks for helping! Ground rules:

- **No fake features.** Every button must do real work; no simulated generations.
- **Deterministic first.** If something can be done without a paid AI call (palette, grid, cleanup, slicing), do it in `@sprixy/core`.
- **Provider-agnostic.** New AI backends go through `ProviderAdapter` (`apps/server/src/providers`).
- **Tests.** Core algorithms get unit tests (`packages/core/test`), API changes get integration tests (`apps/server/test`).
- **Migrations are append-only** (`apps/server/src/db/migrations.ts`).

```bash
pnpm install
pnpm dev          # API :3210 + web :5173
pnpm typecheck && pnpm test
```

Commit style: conventional commits (`feat(core): …`, `fix(server): …`).
