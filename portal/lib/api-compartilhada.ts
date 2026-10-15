import type * as Banco from './database.ts';
import type { NextResponse } from 'next/server';
import { errorMessage, type Role } from './domain.ts';

export type User = { id: string; name: string; email: string; role: Role };
export type Row = Record<string, unknown>;

// O roteador fornece banco e HTTP uma vez. Importar o SQL de um assunto nos
// testes nao inicializa o Worker nem depende do ambiente Cloudflare.
export type ContextoApi = Pick<typeof Banco,
  'audit' | 'currentUser' | 'id' | 'now' | 'rawDb' | 'parseCookies' |
  'passwordHash' | 'tokenHash' | 'PBKDF2_ITERACOES_ATUAL' | 'TRAVA_IMPORTACAO' |
  'adquirirTrava' | 'renovarTrava' | 'liberarTrava' | 'normalizeCnpj' | 'normalizeText'
> & {
  env: unknown;
  NextResponse: typeof NextResponse;
  ok: (data: unknown, init?: ResponseInit) => NextResponse;
  fail: (message: string, status?: number) => NextResponse;
  denyWrite: (request: Request, message: string, status?: number) => Promise<NextResponse>;
  jsonBody: <T>(request: Request, maximo?: number) => Promise<T>;
  CorpoGrandeDemais: new (maximo: number) => Error;
  all: <T = Row>(sql: string, values?: unknown[]) => Promise<T[]>;
  first: <T = Row>(sql: string, values?: unknown[]) => Promise<T | null>;
};

export const canWrite = (user: User) => user.role === 'admin' || user.role === 'editor';

export const textValue = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export const nullableText = (value: unknown) => textValue(value) || null;
export const stringList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];

export const ehErroUnique = (erro: unknown) => errorMessage(erro).includes('UNIQUE');
