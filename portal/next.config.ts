import type { NextConfig } from 'next';

import { CABECALHOS_SEGURANCA } from '@/lib/cabecalhos-seguranca';

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: Object.entries(CABECALHOS_SEGURANCA).filter(([key]) => key !== 'Content-Security-Policy').map(([key, value]) => ({ key, value })),
    }];
  },
};

export default nextConfig;
