'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Bell } from 'lucide-react';
import { api, errorText } from '@/lib/api';
import { assinarCentral, obterCentral, centralInicial, atualizarContagemCentral, type NotificacaoCentral } from '@/lib/central-estado';

export function CentralNotificacoes({ navegar, collapsed = false }: { navegar: (link: string) => void; collapsed?: boolean }) {
  const { usuario, naoLidas } = useSyncExternalStore(assinarCentral, obterCentral, centralInicial);
  const [aberta, setAberta] = useState(false), [itens, setItens] = useState<NotificacaoCentral[]>([]);
  const [erro, setErro] = useState(''), [ocupada, setOcupada] = useState(false), [carregando, setCarregando] = useState(false);
  const painel = useRef<HTMLDialogElement>(null), sino = useRef<HTMLButtonElement>(null);
  const gravando = useRef(false);
  useEffect(() => {
    if (!aberta) return;
    const controller = new AbortController();
    void api<{ notificacoes: NotificacaoCentral[] }>('/api/central', { signal: controller.signal })
      .then(dados => { if (!controller.signal.aborted) setItens(dados.notificacoes); })
      .catch(error => { if (!controller.signal.aborted) setErro(errorText(error)); })
      .finally(() => { if (!controller.signal.aborted) setCarregando(false); });
    painel.current?.focus();
    return () => controller.abort();
  }, [aberta]);
  function fechar() { setAberta(false); sino.current?.focus(); }
  useEffect(() => {
    if (!aberta || typeof document === 'undefined') return;
    const fora = (event: PointerEvent) => {
      const alvo = event.target as Node | null;
      if (alvo && (painel.current?.contains(alvo) || sino.current?.contains(alvo))) return;
      setAberta(false);
    };
    document.addEventListener('pointerdown', fora);
    return () => document.removeEventListener('pointerdown', fora);
  }, [aberta]);
  async function marcar(item?: NotificacaoCentral) {
    if (gravando.current || !usuario) return;
    gravando.current = true;
    setOcupada(true); setErro('');
    try {
      if (!item || !item.lida_em) {
        await api(item ? `/api/central/${encodeURIComponent(item.id)}/lida` : '/api/central/lidas', { method: 'POST' });
        setItens(atuais => atuais.map(n => !item || n.id === item.id ? { ...n, lida_em: n.lida_em || new Date().toISOString() } : n));
        const contagem = await api<{ naoLidas: number }>('/api/central/nao-lidas');
        atualizarContagemCentral(usuario, contagem.naoLidas);
      }
      if (item) { fechar(); navegar(item.link); }
    } catch (error) { setErro(errorText(error)); }
    finally { gravando.current = false; setOcupada(false); }
  }
  return <div className={`patio-notifications ${collapsed ? 'patio-notifications-collapsed' : ''}`}>
    <button ref={sino} type="button" onClick={() => { if (!aberta) { setCarregando(true); setErro(''); } setAberta(valor => !valor); }} aria-label={`Notificações: ${naoLidas} não lidas`} title="Notificações" aria-expanded={aberta} aria-controls="central-notificacoes" className="patio-notifications-trigger">
      <Bell aria-hidden="true" className="size-5"/>
      {!collapsed && <span className="flex-1 text-left">Notificações</span>}
      {naoLidas > 0 && <span aria-hidden="true" className="patio-notifications-count">{naoLidas > 99 ? '99+' : naoLidas}</span>}
    </button>
    {aberta && <dialog open id="central-notificacoes" ref={painel} tabIndex={-1} aria-label="Central de notificações" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); fechar(); } }} className="patio-notifications-panel z-50 m-0 overflow-auto rounded-xl border bg-card p-4 text-foreground shadow-xl">
      <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Notificações</h2><button type="button" onClick={fechar} aria-label="Fechar notificações">Fechar</button></div>
      {naoLidas > 0 && <button type="button" disabled={ocupada} onClick={() => void marcar()} className="my-3 text-sm underline disabled:text-muted-foreground">Marcar todas como lidas</button>}
      {erro && <p role="alert">{erro}</p>}
      {carregando ? <output>Carregando notificações…</output> : itens.length === 0 ? <p>Nenhuma notificação.</p> : <ul>{itens.map(item => <li key={item.id} className="border-t py-3">
        <a href={item.link} aria-disabled={ocupada} onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); void marcar(item); }} className={`block rounded focus-visible:outline-2 ${item.lida_em ? '' : 'font-semibold'}`}>
          {!item.lida_em && <span className="text-xs text-primary">Não lida · </span>}{item.texto}
          <time dateTime={item.criada_em} className="mt-1 block text-xs font-normal text-muted-foreground">{new Date(item.criada_em).toLocaleString('pt-BR')}</time>
        </a>
      </li>)}</ul>}
    </dialog>}
  </div>;
}
