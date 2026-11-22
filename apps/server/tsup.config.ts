import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  // node:sqlite only exists with the node: prefix.
  removeNodeProtocol: false,
  // Bundle workspace packages; keep real npm deps external (installed in the image).
  noExternal: [/^@sprixy\//],
});
