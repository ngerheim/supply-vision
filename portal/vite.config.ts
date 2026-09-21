import { readFileSync } from 'node:fs';
import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json' with { type: 'json' };

// A aba "Manutencao" emoldura um relatorio publicado no Power BI. O endereco
// dele nao e codigo: muda quando o relatorio e republicado, e quem troca e o
// operador, nao o desenvolvedor. Por isso ele vive em portal.env, junto das
// outras configuracoes de operacao, e entra no bundle na compilacao.
//
// Checkout limpo e CI nao possuem a pasta privado. O build continua valido,
// mas a aba informa que falta configuracao em vez de publicar um endereco real.
const PBI_URL_PADRAO = '';
const PBI_PAGINA_PADRAO = '';

function lerPortalEnv(chave: string, padrao: string): string {
  try {
    const texto = readFileSync('../privado/portal/configuracao/portal.env', 'utf8');
    for (const linha of texto.split(/\r?\n/)) {
      const corte = linha.indexOf('=');
      if (corte < 0 || linha.trimStart().startsWith('#')) continue;
      if (linha.slice(0, corte).trim() !== chave) continue;
      const valor = linha.slice(corte + 1).trim();
      if (valor) return valor;
    }
  } catch { /* sem pasta privado: segue com o padrao */ }
  return padrao;
}

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  observability: { enabled: false },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
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
    define: {
      __PBI_RELATORIO_URL__: JSON.stringify(lerPortalEnv('PBI_RELATORIO_URL', PBI_URL_PADRAO)),
      __PBI_PAGINA__: JSON.stringify(lerPortalEnv('PBI_PAGINA', PBI_PAGINA_PADRAO)),
      __PORTAL_API_TOKEN__: JSON.stringify(lerPortalEnv('PORTAL_API_TOKEN', '')),
    },
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
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
