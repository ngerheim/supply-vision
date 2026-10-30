'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { LinhaDeAba } from './page-header';
import { TabelaPadrao } from './tela-padrao';
import { Button } from '@/components/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { roleName, Loading, FalhaDeCarregamento } from './portal-presentation';

type Matriz = {
  areas: { area: string; aba: string; label: string }[];
  niveis: { nivel: string; label: string }[];
  usuarios: { id: string; name: string; email: string; role: string; acessoTotal: boolean; niveis: Record<string, string>; padrao: Record<string, string> }[];
};

// Celula compacta: um clique avanca Sem acesso → Leitura → Edição. O rotulo
// completo fica no title e no aria-label.
const CURTO: Record<string, string> = { sem: '—', leitura: 'Ler', edicao: 'Editar' };
const PROXIMO: Record<string, string> = { sem: 'leitura', leitura: 'edicao', edicao: 'sem' };
const ESTILO: Record<string, string> = {
  sem: 'bg-muted text-muted-foreground',
  leitura: 'bg-secondary text-secondary-foreground border',
  edicao: 'bg-primary/25 text-foreground border border-primary/60 font-semibold',
};

export function Permissoes({ busy, run }: { busy: boolean; run: (acao: () => Promise<unknown>, mensagem?: string) => unknown }) {
  const [matriz, setMatriz] = useState<Matriz | null>(null);
  const [edicao, setEdicao] = useState<Record<string, Record<string, string>>>({});
  const [erro, setErro] = useState('');

  const carregar = useCallback(async (signal?: AbortSignal) => {
    const dados = (await api('/api/permissoes', { signal })) as Matriz;
    if (signal?.aborted) return;
    setMatriz(dados);
    setEdicao({});
    setErro('');
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted)
        void carregar(controller.signal).catch((falha) => {
          if (!controller.signal.aborted) setErro(errorText(falha));
        });
    });
    return () => controller.abort();
  }, [carregar]);

  const pendentes = useMemo(() => Object.values(edicao).reduce((n, areas) => n + Object.keys(areas).length, 0), [edicao]);

  useEffect(() => {
    if (!pendentes) return;
    const avisar = (evento: BeforeUnloadEvent) => evento.preventDefault();
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [pendentes]);

  // Grupos de colunas por aba do menu, na ordem da barra lateral.
  const grupos = useMemo(() => {
    const lista: { aba: string; areas: Matriz['areas'] }[] = [];
    for (const area of matriz?.areas ?? []) {
      const ultimo = lista[lista.length - 1];
      if (ultimo && ultimo.aba === area.aba) ultimo.areas.push(area);
      else lista.push({ aba: area.aba, areas: [area] });
    }
    return lista;
  }, [matriz]);

  if (erro) return <FalhaDeCarregamento erro={erro} tentar={() => void carregar().catch((falha) => setErro(errorText(falha)))} />;
  if (!matriz) return <Loading label="Carregando permissões…" compact />;

  const alterar = (usuario: Matriz['usuarios'][number], area: string, nivel: string) => {
    setEdicao((atual) => {
      const doUsuario = { ...atual[usuario.id] };
      if (nivel === usuario.niveis[area]) delete doUsuario[area];
      else doUsuario[area] = nivel;
      const proximo = { ...atual, [usuario.id]: doUsuario };
      if (!Object.keys(doUsuario).length) delete proximo[usuario.id];
      return proximo;
    });
  };

  const salvar = () =>
    run(async () => {
      const usuarios = Object.entries(edicao).map(([id, areas]) => ({ id, niveis: areas }));
      await api('/api/permissoes', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuarios }) });
      await carregar();
    }, 'Permissões salvas. Quem teve acesso alterado precisa entrar novamente.');

  const rotulo = (nivel: string) => matriz.niveis.find((n) => n.nivel === nivel)?.label ?? nivel;

  return (
    <div className="patio-page space-y-4">
      <LinhaDeAba
        actions={
          <>
            {pendentes > 0 && (
              <Button variant="outline" disabled={busy} onClick={() => setEdicao({})}>
                Descartar
              </Button>
            )}
            <Button variant="create" disabled={busy || !pendentes} onClick={() => void salvar()}>
              <Save /> Salvar{pendentes ? ` (${pendentes})` : ''}
            </Button>
          </>
        }
      />
      <TabelaPadrao contador={`${matriz.usuarios.length} usuários${pendentes ? ` · ${pendentes} alteração(ões) não salva(s)` : ''}`}>
        <TableHeader>
          <TableRow>
            <TableHead rowSpan={2} className="align-bottom" style={{ width: 180 }}>Usuário</TableHead>
            {grupos.map((grupo) => (
              <TableHead key={grupo.aba} colSpan={grupo.areas.length} className="border-l text-center">
                {grupo.aba}
              </TableHead>
            ))}
          </TableRow>
          <TableRow>
            {grupos.flatMap((grupo) =>
              grupo.areas.map((area, indice) => (
                <TableHead key={area.area} className={`px-1 text-center text-xs ${indice === 0 ? 'border-l' : ''}`}>
                  {area.label === grupo.aba ? '' : area.label}
                </TableHead>
              )),
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {matriz.usuarios.map((usuario) => (
            <TableRow key={usuario.id}>
              <TableCell className="font-medium">
                <div className="truncate" title={`${usuario.name} · ${usuario.email}`}>{usuario.name}</div>
                <div className="text-xs text-muted-foreground">{roleName(usuario.role)}</div>
              </TableCell>
              {usuario.acessoTotal ? (
                <TableCell colSpan={matriz.areas.length} className="border-l text-sm text-muted-foreground">
                  Acesso total
                </TableCell>
              ) : (
                matriz.areas.map((area, indice) => {
                  const valor = edicao[usuario.id]?.[area.area] ?? usuario.niveis[area.area];
                  const alterado = edicao[usuario.id]?.[area.area] !== undefined;
                  const ajustado = valor !== usuario.padrao[area.area];
                  const inicioGrupo = indice === 0 || matriz.areas[indice - 1].aba !== area.aba;
                  return (
                    <TableCell key={area.area} className={`px-1 text-center ${inicioGrupo ? 'border-l' : ''}`}>
                      <button
                        type="button"
                        aria-label={`${usuario.name}: ${area.aba} › ${area.label}: ${rotulo(valor)}. Clique para trocar.`}
                        title={`${rotulo(valor)}${ajustado ? ' (diferente do perfil)' : ''}`}
                        className={`${ESTILO[valor]} ${alterado ? 'ring-2 ring-primary' : ajustado ? 'underline underline-offset-2' : ''} inline-flex h-6 min-w-12 items-center justify-center rounded px-1.5 text-xs font-medium disabled:opacity-50`}
                        disabled={busy}
                        onClick={() => alterar(usuario, area.area, PROXIMO[valor])}
                      >
                        {CURTO[valor] ?? valor}
                      </button>
                    </TableCell>
                  );
                })
              )}
            </TableRow>
          ))}
        </TableBody>
      </TabelaPadrao>
    </div>
  );
}
