import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  // Bundle workspace packages; keep real npm deps external (installed in the image).
  noExternal: [/^@sprixy\//],
});
