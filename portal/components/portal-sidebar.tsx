'use client';
import { Marca } from './marca';
import packageInfo from '../package.json' with { type: 'json' };
import { abaDaChave, gruposVisiveis, type Aba, type Nav } from '@/lib/navegacao';
import {
  Database,
  Handshake,
  LogOut,
  MessageSquare,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { type JsonData, roleName } from './portal-presentation';

const { version } = packageInfo;

const navItems: Record<Aba, { label: string; icon: typeof PackageSearch }> = {
  buscar: { label: 'Buscar', icon: PackageSearch },
  manutencao: { label: 'Manutenção', icon: Wrench },
  chamados: { label: 'Chamados', icon: MessageSquare },
  acordos: { label: 'Acordos', icon: Handshake },
  cadastros: { label: 'Cadastros', icon: Database },
  administracao: { label: 'Administração', icon: Settings },
};
export function Sidebar({
  nav,
  setNav,
  user,
  busy,
  onLogout,
  collapsed,
  onToggle,
}: JsonData) {
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 flex w-16 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-300 ${collapsed ? 'lg:w-16' : 'lg:w-44'}`}
    >
      {!collapsed && <div className="hidden lg:block"><Marca/></div>}
      <nav
        className={`relative min-w-0 flex-1 overflow-y-auto px-2 py-5 text-sm ${collapsed ? 'lg:px-2' : 'lg:px-3'}`}
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
          className="mb-3 hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs opacity-100 hover:bg-sidebar-accent hover:opacity-100 lg:flex"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4 shrink-0" />
          ) : (
            <PanelLeftClose className="size-4 shrink-0" />
          )}
          {!collapsed && <span className="truncate">Recolher menu</span>}
        </button>
        {gruposVisiveis(user).map((grupo) => (
          <fieldset
            key={grupo.nome}
            aria-label={grupo.nome}
            className="mb-3 min-w-0 space-y-1 border-t border-sidebar-border pt-3"
          >
            {!collapsed && (
              <p className="hidden px-3 pb-2 text-[10px] font-bold tracking-[.15em] opacity-100 lg:block">
                {grupo.nome}
              </p>
            )}
            {grupo.abas.map((aba) => (
              <NavButton
                key={aba.aba}
                {...navItems[aba.aba]}
                active={abaDaChave(nav as Nav).aba === aba.aba}
                onClick={() => setNav(aba.subabas[0].chave)}
                collapsed={collapsed}
              />
            ))}
          </fieldset>
        ))}
      </nav>
      <div
        className="border-t border-sidebar-border p-2"
        title={`v${version}`}
      >
        {!collapsed && (
          <p className="mb-2 hidden truncate text-xs opacity-100 lg:block">
            {roleName(user.role)}
          </p>
        )}
        {!collapsed && (
          <p className="mb-2 hidden text-[10px] opacity-100 lg:block">
            v{version}
          </p>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onLogout}
          disabled={busy}
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
      className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-200 ${active ? 'bg-sidebar-primary text-sidebar-primary-foreground ' : 'opacity-100 hover:bg-sidebar-accent hover:opacity-100'}`}
    >
      {active && (
        <span className="absolute left-0 inset-y-0 w-[4px] bg-accent" />
      )}
      <Icon className="size-4 shrink-0" />
      {!collapsed && (
        <span className="hidden flex-1 truncate lg:block">{label}</span>
      )}
    </button>
  );
}
