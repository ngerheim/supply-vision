import { NextResponse, type NextRequest } from 'next/server';

import { cabecalhosComNonce } from '@/lib/cabecalhos-seguranca';

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const headers = cabecalhosComNonce(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', headers['Content-Security-Policy']);
  requestHeaders.delete('Content-Security-Policy-Report-Only');
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
