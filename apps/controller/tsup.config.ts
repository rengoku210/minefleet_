import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  clean: true,
  noExternal: ['@minefleet/shared-types', '@minefleet/protocol'],
  dts: false,
});
