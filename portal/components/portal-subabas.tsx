'use client';
import { abaDaChave, subabasPermitidas, type Nav } from '@/lib/navegacao';
import type { UsuarioPermissao } from '@/lib/permissoes';
import { Button } from '@/components/ui/button';

export function Subabas({ nav, usuario, navegar }: { nav: Nav; usuario: UsuarioPermissao; navegar: (chave: Nav) => void }) {
  const aba = abaDaChave(nav);
  const subabas = subabasPermitidas(usuario, aba);
  if (subabas.length < 2) return null;
  return <div role="tablist" aria-label={`Subabas de ${aba.label}`} className="patio-subabas flex gap-5">
    {subabas.map((sub, indice) => <Button key={sub.chave} id={`subaba-${sub.chave}`} role="tab" type="button"
      aria-selected={nav === sub.chave} aria-controls="portal-conteudo" tabIndex={nav === sub.chave ? 0 : -1}
      variant={nav === sub.chave ? 'default' : 'outline'} onClick={() => navegar(sub.chave)}
      onKeyDown={event => {
        const proximo = event.key === 'ArrowRight' ? (indice + 1) % subabas.length
          : event.key === 'ArrowLeft' ? (indice + subabas.length - 1) % subabas.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? subabas.length - 1 : null;
        if (proximo === null) return;
        event.preventDefault();
        navegar(subabas[proximo].chave);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[proximo]?.focus();
      }}>{sub.label}</Button>)}
  </div>;
}
