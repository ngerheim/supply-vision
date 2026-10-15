'use client';
import { GRUPOS_NAVEGACAO, podeAcessarAba, type Nav } from '@/lib/navegacao';
import {
  Database,
  Factory,
  FileUp,
  Handshake,
  History,
  LogOut,
  MessageSquare,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { type JsonData, roleName } from './portal-presentation';

const navItems: Record<Nav, { label: string; icon: typeof PackageSearch }> = {
  search: { label: 'Buscar', icon: PackageSearch },
  maintenance: { label: 'Manutenção', icon: Wrench },
  tickets: { label: 'Chamados', icon: MessageSquare },
  agreements: { label: 'Acordos', icon: Handshake },
  suppliers: { label: 'Fornecedores', icon: Factory },
  imports: { label: 'Importações', icon: FileUp },
  catalogs: { label: 'Cadastros', icon: Database },
  mappings: { label: 'De/Para', icon: RefreshCw },
  reports: { label: 'Relatórios', icon: FileUp },
  history: { label: 'Histórico', icon: History },
  notifications: { label: 'E-mails', icon: MessageSquare },
  admin: { label: 'Usuários', icon: Settings },
};
export function Sidebar({
  nav,
  setNav,
  user,
  onLogout,
  collapsed,
  onToggle,
}: JsonData) {
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 flex w-16 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-300 ${collapsed ? 'lg:w-16' : 'lg:w-44'}`}
    >
      <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(ellipse_at_20%_0%,rgba(45,212,191,.14)_0,transparent_55%)]" />
      <nav
        className="relative flex-1 overflow-y-auto px-2 py-5 text-sm lg:px-3"
        aria-label="Navegação principal"
      >
        <button
          type="button"
          onClick={onToggle}
          title={
            collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'
          }
          aria-label={
            collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'
          }
          aria-expanded={!collapsed}
          className="mb-3 hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs opacity-45 hover:bg-sidebar-accent hover:opacity-100 lg:flex"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4 shrink-0" />
          ) : (
            <PanelLeftClose className="size-4 shrink-0" />
          )}
          {!collapsed && <span className="truncate">Recolher menu</span>}
        </button>
        {GRUPOS_NAVEGACAO.filter((grupo) =>
          podeAcessarAba(user.role, grupo.abas[0]),
        ).map((grupo) => (
          <fieldset
            key={grupo.nome}
            aria-label={grupo.nome}
            className="mb-3 space-y-1 border-t border-sidebar-border pt-3"
          >
            {!collapsed && (
              <p className="hidden px-3 pb-2 text-[10px] font-bold uppercase tracking-[.15em] opacity-45 lg:block">
                {grupo.nome}
              </p>
            )}
            {grupo.abas.map((aba) => (
              <NavButton
                key={aba}
                {...navItems[aba]}
                active={nav === aba}
                onClick={() => setNav(aba)}
                collapsed={collapsed}
              />
            ))}
          </fieldset>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        {!collapsed && (
          <p className="mb-2 hidden truncate text-xs opacity-60 lg:block">
            {roleName(user.role)}
          </p>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onLogout}
          aria-label="Sair"
          title="Sair"
        >
          <LogOut />
        </Button>
      </div>
    </aside>
  );
}
function NavButton({
  label,
  icon: Icon,
  active,
  onClick,
  collapsed,
}: JsonData) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-200 ${active ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm' : 'opacity-55 hover:translate-x-0.5 hover:bg-sidebar-accent hover:opacity-100'}`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-teal-300" />
      )}
      <Icon className="size-4 shrink-0" />
      {!collapsed && (
        <span className="hidden flex-1 truncate lg:block">{label}</span>
      )}
    </button>
  );
}
