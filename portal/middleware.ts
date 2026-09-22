import { NextResponse, type NextRequest } from 'next/server';

import { CABECALHOS_SEGURANCA } from '@/lib/cabecalhos-seguranca';

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(CABECALHOS_SEGURANCA)) response.headers.set(name, value);
  if (request.nextUrl.pathname.startsWith('/api/')) response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
