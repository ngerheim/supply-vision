'use client';
import { useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { api, errorText } from '@/lib/api';
import { pode } from '@/lib/permissoes';
import {
  SITUACOES_SOLICITACAO,
  dataHoraSolicitacao,
} from '@/lib/solicitacoes-cliente';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader, LinhaDeAba } from './page-header';
import { BarraFiltros, TabelaPadrao } from './tela-padrao';
import { Plaquinha } from './plaquinha';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  type AnyRow,
  Field,
  Loading,
  FalhaDeCarregamento,
  PaginacaoDeLista,
  cnpj,
} from './portal-presentation';
import { SituacaoSolicitacao } from './portal-solicitacao-situacao';
import { FormularioSolicitacao } from './portal-solicitacao-formulario';
import { DetalheSolicitacao } from './portal-solicitacao-detalhe';

export function Solicitacoes({
  user,
  initialDetail,
  onOpen,
}: {
  user: AnyRow;
  initialDetail?: string | null;
  onOpen: (id: string | null) => void;
}) {
  const [nova, setNova] = useState(false);
  if (initialDetail)
    return (
      <DetalheSolicitacao
        user={user}
        id={initialDetail}
        onBack={() => onOpen(null)}
      />
    );
  if (nova)
    return (
      <FormularioSolicitacao
        onCancel={() => setNova(false)}
        onSaved={onOpen}
        onOpen={onOpen}
      />
    );
  return (
    <ListaSolicitacoes
      user={user}
      onNew={() => setNova(true)}
      onOpen={onOpen}
    />
  );
}
export function ListaSolicitacoes({
  user,
  onNew,
  onOpen,
}: {
  user: AnyRow;
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  const [filtros, setFiltros] = useState({
    status: '',
    urgencia: '',
    de: '',
    ate: '',
    nao_verificado: false,
  });
  const [pagina, setPagina] = useState(1),
    [versao, setVersao] = useState(0),
    [dados, setDados] = useState<AnyRow | null>(null),
    [erro, setErro] = useState('');
  const sequencia = useRef(0);
  useEffect(() => {
    const atual = ++sequencia.current,
      controller = new AbortController();
    const params = new URLSearchParams({ page: String(pagina) });
    for (const [nome, valor] of Object.entries(filtros))
      if (valor) params.set(nome, valor === true ? '1' : String(valor));
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setErro('');
        setDados(null);
      }
    });
    void api(`/api/solicitacoes?${params}`, { signal: controller.signal })
      .then((x) => {
        if (atual === sequencia.current) setDados(x);
      })
      .catch((e) => {
        if (!controller.signal.aborted && atual === sequencia.current)
          setErro(errorText(e));
      });
    return () => controller.abort();
  }, [filtros, pagina, versao]);
  const todas = pode(user, 'solicitacao:ver_todas');
  return (
    <div className="patio-page">
      <LinhaDeAba
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              aria-label="Atualizar"
              title="Atualizar"
              onClick={() => setVersao((v) => v + 1)}
            >
              <RefreshCw />
            </Button>
            {pode(user, 'solicitacao:abrir') && (
              <Button variant="create" onClick={onNew}>
                <Plus /> Nova solicitação
              </Button>
            )}
          </>
        }
      />
      <BarraFiltros>
            <select aria-label="Situação"
              value={filtros.status}
              onChange={(e) => {
                setFiltros({ ...filtros, status: e.target.value });
                setPagina(1);
              }}
              className="rounded-md border bg-background p-2"
            >
              <option value="">Todas</option>
              {Object.entries(SITUACOES_SOLICITACAO).map(([id, nome]) => (
                <option key={id} value={id}>
                  {nome}
                </option>
              ))}
            </select>
            <select aria-label="Urgência"
              value={filtros.urgencia}
              onChange={(e) => {
                setFiltros({ ...filtros, urgencia: e.target.value });
                setPagina(1);
              }}
              className="rounded-md border bg-background p-2"
            >
              <option value="">Todas</option>
              <option value="normal">Normal</option>
              <option value="urgente">Urgente</option>
            </select>
          <Input aria-label="Período: De" type="date" value={filtros.de} onChange={(e) => { setFiltros({ ...filtros, de: e.target.value }); setPagina(1); }} />
          <Input aria-label="Período: Até" type="date" value={filtros.ate} min={filtros.de} onChange={(e) => { setFiltros({ ...filtros, ate: e.target.value }); setPagina(1); }} />
          <label className="flex items-center gap-2 whitespace-nowrap text-sm">
            <input
              type="checkbox"
              checked={filtros.nao_verificado}
              onChange={(e) => {
                setFiltros({ ...filtros, nao_verificado: e.target.checked });
                setPagina(1);
              }}
            />
            Só não verificados
          </label>
      </BarraFiltros>
      {erro ? (
        <FalhaDeCarregamento
          erro={erro}
          tentar={() => setVersao((v) => v + 1)}
        />
      ) : !dados ? (
        <Loading label="Carregando solicitações…" />
      ) : (
        <TabelaPadrao contador={`${dados.total ?? dados.solicitacoes.length} ${(dados.total ?? dados.solicitacoes.length) === 1 ? 'cadastro' : 'cadastros'}`} pagina={<PaginacaoDeLista pagina={dados.page} paginas={dados.pageCount} alterar={setPagina} />} vazio={!dados.solicitacoes.length ? <p className="p-6 text-center text-muted-foreground">Nenhum cadastro encontrado.</p> : undefined}>
              <TableHeader>
                <TableRow>
                  {[
                    'Código',
                    'Fornecedor / CNPJ',
                    'Categorias',
                    'Urgência',
                    'Situação',
                    ...(todas ? ['Solicitante'] : []),
                    'Atualizado em',
                  ].map((t) => (
                    <TableHead key={t}>{t}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {dados.solicitacoes.map((s: AnyRow) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <a
                        className="text-link hover:underline"
                        href={`?aba=chamados&solicitacao=${encodeURIComponent(s.id)}`}
                        onClick={(e) => {
                          if (
                            e.button === 0 &&
                            !e.ctrlKey &&
                            !e.metaKey &&
                            !e.shiftKey &&
                            !e.altKey
                          ) {
                            e.preventDefault();
                            onOpen(s.id);
                          }
                        }}
                      >
                        <Plaquinha>{s.codigo}</Plaquinha>
                      </a>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{s.razao_social}</p>
                      <p className="text-xs text-muted-foreground">
                        {cnpj(s.cnpj)}
                      </p>
                    </TableCell>
                    <TableCell>
                      {s.categorias.map((c: AnyRow) => c.nome).join(', ') ||
                        '—'}
                    </TableCell>
                    <TableCell>
                      {s.urgencia === 'urgente' ? (
                        <Badge className="bg-red-50 text-red-700">
                          Urgente
                        </Badge>
                      ) : (
                        'Normal'
                      )}
                    </TableCell>
                    <TableCell>
                      <SituacaoSolicitacao value={s.status} />
                      {Boolean(s.nao_verificado) && (
                        <Badge className="ml-2" variant="outline">
                          Não verificado
                        </Badge>
                      )}
                    </TableCell>
                    {todas && (
                      <TableCell>{s.solicitante || s.solicitante_id}</TableCell>
                    )}
                    <TableCell>
                      <time dateTime={s.atualizado_em}>
                        {dataHoraSolicitacao(s.atualizado_em)}
                      </time>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
        </TabelaPadrao>
      )}
    </div>
  );
}
