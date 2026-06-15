import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/server.ts',
    'src/scripts/backfill.ts',
    'src/scripts/poll.ts',
    'src/scripts/poll-all.ts',
    'src/scripts/refresh-tokens.ts',
  ],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  dts: false,
  skipNodeModulesBundle: true,
});
