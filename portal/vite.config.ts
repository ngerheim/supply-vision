import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';

// Banco D1 local. NAO altere database_name nem database_id: o Miniflare usa
// esses valores para localizar o arquivo do banco em
// privado/portal/banco/estado. Mudar qualquer um faria o Portal subir com uma
// base vazia, como se os dados tivessem sumido. Os nomes vieram do modelo de
// projeto original e ficam por compatibilidade com as bases ja existentes.
const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  observability: { enabled: false },
  d1_databases: [
    {
      binding: 'DB',
      database_name: 'site-creator-d1',
      database_id: '00000000-0000-4000-8000-000000000000',
    },
  ],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: {
      host: '0.0.0.0',
      fs: {
        strict: true,
        // O servidor de desenvolvimento serve a arvore do projeto. Sem isso,
        // qualquer pessoa da rede baixa /DOCUMENTACAO.md (que lista os e-mails
        // dos usuarios), /package.json e /vite.config.ts sem autenticacao.
        deny: [
          '**/*.md', '**/package.json', '**/package-lock.json', '**/*.config.ts',
          '**/.env*', '**/.git/**', '**/.wrangler/**', '**/dados-origem/**',
          '**/.npmrc', '**/*.ps1', '**/*.cmd', '**/*.sqlite*', '**/drizzle/**',
        ],
      },
    },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
