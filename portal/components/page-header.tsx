'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { abaDaChave, type Nav } from '@/lib/navegacao';
import type { UsuarioPermissao } from '@/lib/permissoes';
import { Subabas } from './portal-subabas';

type Contexto = {
  nav: Nav;
  usuario: UsuarioPermissao;
  navegar: (nav: Nav) => void;
};
const ContextoCabecalho = createContext<Contexto | null>(null);
export function CabecalhoProvider({
  value,
  children,
}: {
  value: Contexto;
  children: ReactNode;
}) {
  return (
    <ContextoCabecalho.Provider value={value}>
      {children}
    </ContextoCabecalho.Provider>
  );
}
const titulos = {
  buscar: 'Buscar preços',
  manutencao: 'Manutenção',
  chamados: 'Chamados',
  acordos: 'Acordos',
  cadastros: 'Cadastros',
  administracao: 'Administração',
};

/** Page-owned actions keep their existing handlers. */
export function PageHeader({
  title,
  actions,
  status,
  back,
  description,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  status?: ReactNode;
  description?: ReactNode;
  back?: { label: string; onClick: () => void };
}) {
  const contexto = useContext(ContextoCabecalho);
  return (
    <header className="patio-page-header">
      {back && (
        <a
          href={
            contexto?.nav === 'tickets'
              ? '/?aba=chamados'
              : contexto?.nav === 'search'
                ? '/?aba=buscar'
                : '/?aba=acordos&sub=acordos'
          }
          className="patio-back"
          onClick={(e) => {
            e.preventDefault();
            back.onClick();
          }}
        >
          {back.label}
        </a>
      )}
      <div className="patio-header-row">
        <div className="patio-header-heading">
          <h1 className="patio-page-title">
            {title ?? titulos[abaDaChave(contexto?.nav ?? 'search').aba]}
          </h1>
          {status && <div className="patio-header-status">{status}</div>}
        </div>
        <div className="patio-header-actions">
          {actions}
        </div>
      </div>
      {description && <p className="patio-header-description">{description}</p>}
      {contexto && !back && (
        <Subabas
          nav={contexto.nav}
          usuario={contexto.usuario}
          navegar={contexto.navegar}
        />
      )}
    </header>
  );
}
