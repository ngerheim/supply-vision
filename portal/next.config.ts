import type { NextConfig } from 'next';

import { CABECALHOS_SEGURANCA } from '@/lib/cabecalhos-seguranca';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: Object.entries(CABECALHOS_SEGURANCA).map(([key, value]) => ({ key, value })),
    }];
  },
};

export default nextConfig;
