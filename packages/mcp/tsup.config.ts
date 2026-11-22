import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  noExternal: ['@sprixy/client'],
  clean: true,
  removeNodeProtocol: false,
  banner: { js: '#!/usr/bin/env node' },
});
