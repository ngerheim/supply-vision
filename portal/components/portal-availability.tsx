'use client';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { iniciarPollingDisponibilidade, consultarDisponibilidade } from '@/lib/polling-disponibilidade';
import { assinarCentral, obterCentral, centralInicial, definirUsuarioCentral } from '@/lib/central-estado';
import { assinarEstadoPortal, obterEstadoPortal, ESTADO_INICIAL, AVISO_INDISPONIVEL, AVISO_VERSAO } from '@/lib/estado-portal';

export function PortalAvailability() {
  const estado = useSyncExternalStore(assinarEstadoPortal, obterEstadoPortal, () => ESTADO_INICIAL);
  const janela = useRef<HTMLDialogElement>(null);
  const { usuario } = useSyncExternalStore(assinarCentral, obterCentral, centralInicial);
  useEffect(() => {
    const expirar = () => definirUsuarioCentral(null);
    window.addEventListener('portal:session-expired', expirar);
    const parar = iniciarPollingDisponibilidade(signal => consultarDisponibilidade(usuario, signal), document);
    return () => { parar(); window.removeEventListener('portal:session-expired', expirar); };
  }, [usuario]);
  useEffect(() => {
    if (estado.versaoNova && !janela.current?.open) janela.current?.showModal();
  }, [estado.versaoNova]);
  return <>
    {estado.indisponivel && <div role="alert" className="fixed inset-x-0 top-0 z-[1000] bg-muted px-4 py-3 text-center font-semibold text-muted-foreground ">{AVISO_INDISPONIVEL}</div>}
    <dialog ref={janela} onCancel={event => event.preventDefault()} aria-labelledby="portal-versao-aviso" className="fixed inset-0 m-auto max-w-lg rounded-xl border bg-background p-6 text-foreground shadow-xl backdrop:bg-foreground/60">
      <p id="portal-versao-aviso">{AVISO_VERSAO}</p>
      <button type="button" autoFocus className="mt-5 rounded-lg bg-primary px-4 py-2 text-primary-foreground" onClick={() => location.reload()}>Recarregar</button>
    </dialog>
  </>;
}
