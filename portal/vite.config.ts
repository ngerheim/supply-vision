import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import pacote from './package.json' with { type: 'json' };
import { identificarBuild } from './scripts/identificador-build.mjs';

const build = identificarBuild(pacote.version, { commit: process.env.PORTAL_BUILD_COMMIT, raiz: import.meta.dirname });

export default defineConfig({
  define: { __PORTAL_BUILD__: JSON.stringify(build) },
  css: { postcss: { plugins: [tailwindcss()] } },
  server: {
    host: '127.0.0.1',
    fs: { strict: true, deny: ['**/*.md', '**/package*.json', '**/*.config.ts', '**/.env*', '**/.git/**', '**/dados-origem/**', '**/.npmrc', '**/*.ps1', '**/*.cmd', '**/*.sqlite*', '**/drizzle/**', '**/privado/**'] },
  },
  plugins: [vinext(), {
    name: 'portal-build',
    closeBundle() {
      fs.mkdirSync(path.join(import.meta.dirname, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(import.meta.dirname, 'dist/portal-build.json'), JSON.stringify({ build }));
    },
  }],
});
