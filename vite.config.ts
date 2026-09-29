import { defineConfig } from 'vite';
import { scoresDevPlugin } from './server/scores/vitePlugin';

export default defineConfig({
  base: './',
  // `/api/scores` et `/api/workshop` en dev et en preview (en prod : les fonctions Vercel de api/).
  plugins: [scoresDevPlugin()],
  server: { port: 5173, host: true },
  build: { target: 'es2022', sourcemap: true },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
