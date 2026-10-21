import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';

export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  server: {
    host: '127.0.0.1',
    fs: { strict: true, deny: ['**/*.md', '**/package*.json', '**/*.config.ts', '**/.env*', '**/.git/**', '**/dados-origem/**', '**/.npmrc', '**/*.ps1', '**/*.cmd', '**/*.sqlite*', '**/drizzle/**', '**/privado/**'] },
  },
  plugins: [vinext()],
});
