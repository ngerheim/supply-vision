"use client";
import { createContext, useContext, type ReactNode } from "react";
import { abaDaChave, subabasPermitidas, type Nav } from "@/lib/navegacao";
import type { UsuarioPermissao } from "@/lib/permissoes";
import { Subabas } from "./portal-subabas";

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
  buscar: "Buscar preços",
  manutencao: "Manutenção",
  chamados: "Chamados",
  estoque: "Estoque",
  acordos: "Acordos",
  cadastros: "Cadastros",
  administracao: "Administração",
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
  const aba = abaDaChave(contexto?.nav ?? "search");
  const unica = contexto ? subabasPermitidas(contexto.usuario, aba) : [];
  // O nome da aba ja esta na barra lateral; so aparece titulo proprio da tela.
  const visivel =
    title ??
    (unica.length === 1 && aba.subabas.length > 1 ? unica[0].label : null);
  return (
    <header className="patio-page-header">
      {back && (
        <a
          href={
            aba.aba === "chamados"
              ? "/?aba=chamados"
              : contexto?.nav === "search"
                ? "/?aba=buscar"
                : "/?aba=acordos&sub=acordos"
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
      {!visivel && <h1 className="sr-only">{titulos[aba.aba]}</h1>}
      <div className="patio-header-row" hidden={!visivel && !actions}>
        <div className="patio-header-heading">
          {visivel && <h1 className="patio-page-title">{visivel}</h1>}
          {status && <div className="patio-header-status">{status}</div>}
        </div>
        <div className="patio-header-actions">{actions}</div>
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

/** Linha única reutilizável para abas: navegação à esquerda e ações à direita. */
export function LinhaDeAba({ actions }: { actions?: ReactNode }) {
  const contexto = useContext(ContextoCabecalho);
  const aba = abaDaChave(contexto?.nav ?? "search");
  return <header className="patio-page-header patio-tab-header">
    <h1 className="sr-only">{titulos[aba.aba]}</h1>
    <div className="patio-tab-row">
      {contexto && <Subabas nav={contexto.nav} usuario={contexto.usuario} navegar={contexto.navegar} />}
      <div className="patio-header-actions">{actions}</div>
    </div>
  </header>;
}
