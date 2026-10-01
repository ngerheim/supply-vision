'use client';
import { useState } from 'react';
import {
  Search,
  MessageSquare,
  Handshake,
  Upload,
  Menu,
  LogOut,
  ChevronDown,
} from 'lucide-react';

const primary = [
  { id: 'search', label: 'Buscar', icon: Search },
  { id: 'tickets', label: 'Chamados', icon: MessageSquare },
  { id: 'agreements', label: 'Acordos', icon: Handshake },
  { id: 'imports', label: 'Importações', icon: Upload },
] as const;
export function TopNavigation({
  nav,
  onNavigate,
  user,
  onLogout,
}: {
  nav: string;
  onNavigate: (nav: string) => void;
  user: { name: string; role: string };
  onLogout: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const canWrite = user.role === 'admin' || user.role === 'editor';
  const secondary = [
    { id: 'maintenance', label: 'Manutenção' },
    ...(canWrite
      ? [
          { id: 'suppliers', label: 'Fornecedores' },
          { id: 'catalogs', label: 'Cadastros' },
        ]
      : []),
    ...(user.role === 'admin'
      ? [
          { id: 'mappings', label: 'De/Para' },
          { id: 'history', label: 'Histórico' },
          { id: 'admin', label: 'Usuários e envios' },
        ]
      : []),
  ];
  const change = (id: string) => {
    onNavigate(id);
    setExpanded(false);
  };
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0a202d] text-white shadow-sm">
      <div className="mx-auto flex max-w-[1550px] flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
        <button
          onClick={() => change('search')}
          className="mr-3 text-left leading-tight"
        >
          <span className="block text-sm font-semibold tracking-tight">
            Supply Vision
          </span>
          <span className="text-[11px] text-slate-300">Portal Suprimentos</span>
        </button>
        <nav
          aria-label="Navegação principal"
          className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto sm:flex-1"
        >
          {primary
            .filter(
              (item) => canWrite || ['search', 'agreements'].includes(item.id),
            )
            .map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                aria-current={nav === id ? 'page' : undefined}
                onClick={() => change(id)}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${nav === id ? 'bg-teal-400 text-[#08212c]' : 'text-slate-200 hover:bg-white/10'}`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
        </nav>
        <div className="relative ml-auto">
          <button
            aria-expanded={expanded}
            aria-controls="portal-secondary-nav"
            onClick={() => setExpanded(!expanded)}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${secondary.some((item) => item.id === nav) ? 'bg-white/15' : 'hover:bg-white/10'}`}
          >
            <Menu className="size-4" />
            Mais
            <ChevronDown className="size-3" />
          </button>
          {expanded && (
            <>
              <button
                aria-label="Fechar menu"
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setExpanded(false)}
              />
              <nav
                id="portal-secondary-nav"
                aria-label="Outras áreas"
                className="absolute right-0 top-full z-40 mt-2 grid min-w-52 rounded-xl border bg-card p-2 text-foreground shadow-xl"
              >
                {secondary.map((item) => (
                  <button
                    key={item.id}
                    aria-current={nav === item.id ? 'page' : undefined}
                    onClick={() => change(item.id)}
                    className="rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            </>
          )}
        </div>
        <span className="hidden max-w-36 truncate border-l border-white/15 pl-3 text-sm text-slate-200 lg:block">
          {user.name}
        </span>
        <button
          aria-label="Sair"
          title="Sair"
          onClick={onLogout}
          className="rounded-lg p-2 hover:bg-white/10"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </header>
  );
}
