"use client";
import { Marca } from "./marca";
import { CentralNotificacoes } from "./central-notificacoes";
import packageInfo from "../package.json" with { type: "json" };
import {
  abaDaChave,
  gruposVisiveis,
  type Aba,
  type Nav,
} from "@/lib/navegacao";
import {
  Database,
  Handshake,
  LogOut,
  MessageSquare,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Boxes,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { type JsonData, roleName } from "./portal-presentation";

const { version } = packageInfo;

const navItems: Record<Aba, { label: string; icon: typeof PackageSearch }> = {
  buscar: { label: "Buscar", icon: PackageSearch },
  manutencao: { label: "Manutenção", icon: Wrench },
  chamados: { label: "Chamados", icon: MessageSquare },
  estoque: { label: "Estoque", icon: Boxes },
  acordos: { label: "Acordos", icon: Handshake },
  cadastros: { label: "Cadastros", icon: Database },
  administracao: { label: "Administração", icon: Settings },
};
export function Sidebar({
  nav,
  setNav,
  user,
  busy,
  onLogout,
  collapsed,
  onToggle,
  navegarAviso,
}: JsonData) {
  return (
    <aside
      className={`patio-sidebar ${collapsed ? "patio-sidebar-collapsed" : ""}`}
    >
      {!collapsed && <Marca />}
      <nav className="patio-sidebar-nav" aria-label="Navegação principal">
        {gruposVisiveis(user).map((grupo) => (
          <fieldset
            key={grupo.nome}
            aria-label={grupo.nome}
            className="patio-sidebar-group"
          >
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
      <CentralNotificacoes navegar={navegarAviso} collapsed={collapsed} />
      <footer className="patio-sidebar-footer" title={`v${version}`}>
        {!collapsed && (
          <div className="patio-sidebar-user">
            <p title={user.name}>{user.name}</p>
            <span>{roleName(user.role)}</span>
          </div>
        )}
        <Button
          variant="ghost"
          onClick={onLogout}
          disabled={busy}
          aria-label="Sair"
          title="Sair"
          className="patio-sidebar-logout"
        >
          <LogOut />
          {!collapsed && <span>Sair</span>}
        </Button>
        <button
          type="button"
          onClick={onToggle}
          title={
            collapsed ? "Expandir barra lateral" : "Recolher barra lateral"
          }
          aria-label={
            collapsed ? "Expandir barra lateral" : "Recolher barra lateral"
          }
          aria-expanded={!collapsed}
          className="patio-sidebar-toggle"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4 shrink-0" />
          ) : (
            <PanelLeftClose className="size-4 shrink-0" />
          )}
          {!collapsed && <span className="truncate">Recolher menu</span>}
        </button>
        {!collapsed && <p className="patio-sidebar-version">v{version}</p>}
      </footer>
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
      aria-current={active ? "page" : undefined}
      className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] transition-colors duration-200 ${active ? "bg-sidebar-primary text-sidebar-primary-foreground " : "opacity-100 hover:bg-sidebar-accent hover:opacity-100"}`}
    >
      {active && (
        <span className="absolute left-0 inset-y-0 w-[4px] bg-accent" />
      )}
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
    </button>
  );
}
