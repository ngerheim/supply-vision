'use client';
import { useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Search, X } from 'lucide-react';
import { api, ApiError, errorText } from '@/lib/api';
import { pode } from '@/lib/permissoes';
import { corpoJson } from '@/lib/solicitacoes-cliente';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CardHeader } from '@/components/ui/card';
import { PageHeader } from './page-header';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
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
} from './portal-presentation';

export function Estoques() {
  const [rows, setRows] = useState<AnyRow[] | null>(null),
    [erro, setErro] = useState(''),
    [falha, setFalha] = useState('');
  const [versao, setVersao] = useState(0),
    [busy, setBusy] = useState(false),
    [nome, setNome] = useState(''),
    [editando, setEditando] = useState<AnyRow | null>(null);
  const trava = useRef(false),
    sequencia = useRef(0);
  useEffect(() => {
    const atual = ++sequencia.current,
      controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setFalha('');
        setRows(null);
      }
    });
    void api('/api/estoques', { signal: controller.signal })
      .then((x) => {
        if (atual === sequencia.current && !controller.signal.aborted)
          setRows(x.estoques);
      })
      .catch((e) => {
        if (atual === sequencia.current && !controller.signal.aborted)
          setFalha(errorText(e));
      });
    return () => {
      controller.abort();
      sequencia.current = atual + 1;
    };
  }, [versao]);
  const salvar = async (row: AnyRow | null, body: AnyRow) => {
    if (trava.current) return;
    trava.current = true;
    setBusy(true);
    setErro('');
    const atual = sequencia.current;
    try {
      await api(
        `/api/estoques${row ? `/${encodeURIComponent(row.id)}` : ''}`,
        corpoJson(row ? 'PUT' : 'POST', {
          ...body,
          ...(row ? { expectedRevision: row.revision } : {}),
        }),
      );
      if (atual === sequencia.current) {
        setNome('');
        setEditando(null);
        setVersao((v) => v + 1);
      }
    } catch (e) {
      if (atual === sequencia.current)
        setErro(
          e instanceof ApiError &&
            e.details.status === 409 &&
            e.message.includes('alterado')
            ? 'O estoque foi alterado; recarregue'
            : errorText(e),
        );
    } finally {
      trava.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <PageHeader
        actions={
          <Button
            variant="outline"
            size="icon"
            aria-label="Recarregar"
            title="Recarregar"
            disabled={busy}
            onClick={() => {
              setEditando(null);
              setNome('');
              setErro('');
              setVersao((v) => v + 1);
            }}
          >
            <RefreshCw />
          </Button>
        }
      />
      <Card>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (nome.trim()) void salvar(editando, { nome: nome.trim() });
            }}
          >
            <fieldset
              disabled={busy}
              className="flex flex-wrap items-end gap-3"
            >
              <Field label={editando ? 'Renomear estoque' : 'Novo estoque'}>
                <Input
                  name="nome"
                  required
                  maxLength={200}
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                />
              </Field>
              <Button type="submit" disabled={busy || !rows}>
                {editando ? 'Salvar nome' : 'Incluir'}
              </Button>
              {editando && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditando(null);
                    setNome('');
                  }}
                >
                  Cancelar
                </Button>
              )}
            </fieldset>
          </form>
        </CardContent>
      </Card>
      {erro && <p role="alert">{erro}</p>}
      <h2 className="text-lg font-semibold">Estoques</h2>
      {falha ? (
        <FalhaDeCarregamento
          erro={falha}
          tentar={() => setVersao((v) => v + 1)}
        />
      ) : !rows ? (
        <Loading label="Carregando estoques…" />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.nome}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {c.ativo ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </TableCell>
                    <TableCell className="space-x-2">
                      <Button
                        variant="outline"
                        disabled={busy || Boolean(editando)}
                        onClick={() => {
                          setEditando(c);
                          setNome(c.nome);
                          setErro('');
                        }}
                      >
                        Renomear {c.nome}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || Boolean(editando)}
                        onClick={() => void salvar(c, { ativo: !c.ativo })}
                      >
                        {c.ativo ? 'Desativar' : 'Ativar'} {c.nome}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!rows.length && <p className="p-4">Nenhum estoque cadastrado.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function EntradaEstoque() {
  const tentativa = useRef<string | null>(null);
  const [estoques, setEstoques] = useState<AnyRow[]>([]),
    [resultadoEntradas, setResultadoEntradas] = useState<{
      chave: string;
      rows: AnyRow[];
    } | null>(null),
    [estoqueFiltro, setEstoqueFiltro] = useState(''),
    [q, setQ] = useState(''),
    [de, setDe] = useState(''),
    [ate, setAte] = useState(''),
    [versao, setVersao] = useState(0),
    [abrir, setAbrir] = useState(false),
    [estoqueId, setEstoqueId] = useState(''),
    [data, setData] = useState(() =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
    ),
    [documento, setDocumento] = useState(''),
    [observacao, setObservacao] = useState(''),
    [busca, setBusca] = useState(''),
    [itens, setItens] = useState<AnyRow[]>([]),
    [linhas, setLinhas] = useState<{ id: string; quantidade: string }[]>([
      { id: '', quantidade: '' },
    ]),
    [erro, setErro] = useState(''),
    [busy, setBusy] = useState(false);
  const consultaEntradas = new URLSearchParams({
    ...(estoqueFiltro ? { estoqueId: estoqueFiltro } : {}),
    ...(q ? { q } : {}),
    ...(de ? { de } : {}),
    ...(ate ? { ate } : {}),
  }).toString();
  const chaveEntradas = `${versao}:${consultaEntradas}`;
  const rows =
    resultadoEntradas?.chave === chaveEntradas ? resultadoEntradas.rows : null;
  const [resultadoOpcoes, setResultadoOpcoes] = useState<{
    consulta: string;
    itens: AnyRow[];
  } | null>(null);
  const buscaNormalizada = busca.trim();
  const opcoes =
    abrir &&
    buscaNormalizada.length >= 2 &&
    resultadoOpcoes?.consulta === buscaNormalizada
      ? resultadoOpcoes.itens
      : [];
  useEffect(() => {
    void api('/api/estoques')
      .then((x) => setEstoques(x.estoques))
      .catch((e) => setErro(errorText(e)));
  }, []);
  useEffect(() => {
    let ativo = true;
    void api(`/api/estoque/entradas?${consultaEntradas}`)
      .then((x) => {
        if (ativo)
          setResultadoEntradas({ chave: chaveEntradas, rows: x.entradas });
      })
      .catch((e) => {
        if (ativo) setErro(errorText(e));
      });
    return () => {
      ativo = false;
    };
  }, [consultaEntradas, chaveEntradas]);
  useEffect(() => {
    if (!abrir || buscaNormalizada.length < 2) return;
    let ativo = true;
    const t = setTimeout(
      () =>
        void api(
          `/api/catalogs/items?q=${encodeURIComponent(buscaNormalizada)}`,
        )
          .then((x) => {
            if (ativo)
              setResultadoOpcoes({
                consulta: buscaNormalizada,
                itens: x.itens.slice(0, 12),
              });
          })
          .catch((e) => {
            if (ativo) setErro(errorText(e));
          }),
      180,
    );
    return () => {
      ativo = false;
      clearTimeout(t);
    };
  }, [abrir, buscaNormalizada]);
  const reset = () => {
    setAbrir(false);
    setErro('');
    setEstoqueId('');
    setDocumento('');
    setObservacao('');
    setBusca('');
    setItens([]);
    setLinhas([{ id: '', quantidade: '' }]);
    tentativa.current = null;
  };
  const salvar = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (
      !estoqueId ||
      !linhas.length ||
      linhas.some(
        (l) => !l.id || !Number(l.quantidade) || Number(l.quantidade) <= 0,
      ) ||
      new Set(linhas.map((l) => l.id)).size !== linhas.length
    ) {
      setErro(
        'Selecione o estoque, adicione itens únicos e informe quantidades maiores que zero.',
      );
      return;
    }
    setBusy(true);
    setErro('');
    tentativa.current ??= crypto.randomUUID();
    try {
      await api('/api/estoque/entradas', {
        ...corpoJson('POST', {
          estoqueId,
          dataMovimento: data,
          documento,
          observacao,
          itens: linhas.map((l) => ({
            itemId: l.id,
            quantidade: Number(l.quantidade),
          })),
        }),
        headers: {
          'content-type': 'application/json',
          'idempotency-key': tentativa.current,
        },
      });
      reset();
      setVersao((v) => v + 1);
    } catch (x) {
      setErro(
        x instanceof ApiError &&
          x.details.status === 409 &&
          x.details.codigo === 'duplicado'
          ? 'Esta entrada já foi registrada.'
          : errorText(x),
      );
    } finally {
      setBusy(false);
    }
  };
  const adicionar = (item: AnyRow) => {
    if (linhas.some((l) => l.id === item.id)) {
      setErro('Este item já foi adicionado.');
      return;
    }
    setItens([...itens, item]);
    setLinhas([...linhas, { id: item.id, quantidade: '' }]);
    setBusca('');
    setErro('');
  };
  return (
    <div className="patio-page space-y-4">
      <PageHeader
        actions={
          <Button
            variant="create"
            onClick={() => {
              setAbrir(true);
              setErro('');
            }}
          >
            <Plus /> Nova entrada
          </Button>
        }
      />
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-0 basis-64 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            aria-label="Buscar entradas"
            placeholder="Buscar por documento ou item"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <NativeSelect
          className="w-52"
          aria-label="Estoque"
          value={estoqueFiltro}
          onChange={(e) => setEstoqueFiltro(e.target.value)}
        >
          <NativeSelectOption value="">Todos os estoques</NativeSelectOption>
          {estoques.map((x) => (
            <NativeSelectOption key={x.id} value={x.id}>
              {x.nome}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Input
          className="w-40"
          aria-label="Data inicial"
          type="date"
          value={de}
          onChange={(e) => setDe(e.target.value)}
        />
        <Input
          className="w-40"
          aria-label="Data final"
          type="date"
          value={ate}
          onChange={(e) => setAte(e.target.value)}
        />
      </div>
      {erro && !abrir && <p role="alert">{erro}</p>}
      <Card>
        <CardHeader className="border-b">
          <p className="patio-result-count">
            {rows?.length ?? 0}{' '}
            {(rows?.length ?? 0) === 1 ? 'entrada' : 'entradas'}
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Estoque</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Itens</TableHead>
                <TableHead>Registrado por</TableHead>
                <TableHead>Observação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows?.map((r) => (
                <TableRow key={r.origem_id}>
                  <TableCell>{r.data_movimento}</TableCell>
                  <TableCell>{r.estoque}</TableCell>
                  <TableCell>{r.documento || '—'}</TableCell>
                  <TableCell title={r.resumo}>
                    {r.itens} {r.itens === 1 ? 'item' : 'itens'}
                  </TableCell>
                  <TableCell>{r.usuario || '—'}</TableCell>
                  <TableCell className="max-w-72 truncate">
                    {r.observacao || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows && !rows.length && (
            <p className="p-4 text-sm text-muted-foreground">
              Nenhuma entrada encontrada.
            </p>
          )}
          {!rows && <Loading label="Carregando entradas…" />}
        </CardContent>
      </Card>
      {abrir && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
        >
          <dialog
            open
            aria-modal="true"
            aria-labelledby="titulo-entrada"
            className="m-0 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border bg-card p-0 shadow-xl"
          >
            <header className="flex items-center justify-between border-b p-5">
              <h2 id="titulo-entrada" className="text-lg font-semibold">
                Nova entrada
              </h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Fechar"
                onClick={reset}
              >
                <X />
              </Button>
            </header>
            <form onSubmit={salvar} className="space-y-4 p-5">
              <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
                <Field label="Estoque">
                  <NativeSelect
                    aria-label="Estoque da entrada"
                    required
                    value={estoqueId}
                    onChange={(e) => setEstoqueId(e.target.value)}
                  >
                    <NativeSelectOption value="">Selecione</NativeSelectOption>
                    {estoques
                      .filter((x) => x.ativo)
                      .map((x) => (
                        <NativeSelectOption key={x.id} value={x.id}>
                          {x.nome}
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                </Field>
                <Field label="Data">
                  <Input
                    type="date"
                    required
                    value={data}
                    onChange={(e) => setData(e.target.value)}
                  />
                </Field>
                <Field label="Documento">
                  <Input
                    maxLength={60}
                    value={documento}
                    onChange={(e) => setDocumento(e.target.value)}
                  />
                </Field>
                <Field label="Observação">
                  <Input
                    maxLength={300}
                    value={observacao}
                    onChange={(e) => setObservacao(e.target.value)}
                  />
                </Field>
              </fieldset>
              <div className="space-y-3">
                <h3 className="font-semibold">Itens</h3>
                <div className="relative">
                  <Input
                    aria-label="Buscar item no catálogo"
                    placeholder="Digite ao menos 2 caracteres"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                  />
                  {opcoes.length > 0 && (
                    <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-card shadow-lg">
                      {opcoes.map((i) => (
                        <li key={i.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left hover:bg-muted"
                            onClick={() => adicionar(i)}
                          >
                            {i.descricao}{' '}
                            <span className="text-sm text-muted-foreground">
                              · {i.unidade}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {linhas.map((l, n) => {
                  const item = itens.find((i) => i.id === l.id);
                  return (
                    <div
                      key={`${l.id}:${n}`}
                      className="grid items-end gap-3 sm:grid-cols-[1fr_10rem_auto]"
                    >
                      <p className="pb-2 font-medium">
                        {item
                          ? `${item.descricao} · ${item.unidade}`
                          : 'Escolha um item na busca'}
                      </p>
                      <Field label="Quantidade">
                        <Input
                          aria-label={`Quantidade da linha ${n + 1}`}
                          type="number"
                          min="0.01"
                          step={item?.unidade === 'un' ? '1' : '0.01'}
                          value={l.quantidade}
                          onChange={(e) =>
                            setLinhas(
                              linhas.map((x, i) =>
                                i === n
                                  ? { ...x, quantidade: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="outline"
                        aria-label={`Remover linha ${n + 1}`}
                        onClick={() =>
                          setLinhas(
                            linhas.length === 1
                              ? [{ id: '', quantidade: '' }]
                              : linhas.filter((_, i) => i !== n),
                          )
                        }
                      >
                        Remover
                      </Button>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setLinhas([...linhas, { id: '', quantidade: '' }])
                  }
                >
                  + Adicionar item
                </Button>
              </div>
              {erro && <p role="alert">{erro}</p>}
              <footer className="flex justify-end gap-2 border-t pt-4">
                <Button type="button" variant="outline" onClick={reset}>
                  Cancelar
                </Button>
                <Button disabled={busy} type="submit">
                  Registrar entrada
                </Button>
              </footer>
            </form>
          </dialog>
        </div>
      )}
    </div>
  );
}

export function SaldoEstoque({ user }: { user: AnyRow }) {
  const tentativaAjuste = useRef<string | null>(null);
  const [rows, setRows] = useState<AnyRow[]>([]),
    [estoques, setEstoques] = useState<AnyRow[]>([]),
    [estoqueId, setEstoqueId] = useState(''),
    [q, setQ] = useState(''),
    [versao, setVersao] = useState(0),
    [historico, setHistorico] = useState<AnyRow | null>(null),
    [movs, setMovs] = useState<AnyRow[]>([]),
    [erro, setErro] = useState(''),
    [motivo, setMotivo] = useState(''),
    [selecionado, setSelecionado] = useState<AnyRow | null>(null),
    [busy, setBusy] = useState(false),
    [ajuste, setAjuste] = useState(false);
  useEffect(() => {
    void Promise.all([
      api('/api/estoques'),
      api(
        `/api/estoque/saldos?${new URLSearchParams({ ...(estoqueId ? { estoqueId } : {}), ...(q ? { q } : {}) })}`,
      ),
    ])
      .then(([e, s]) => {
        setEstoques(e.estoques);
        setRows(s.saldos);
      })
      .catch((e) => setErro(errorText(e)));
  }, [versao, estoqueId, q]);
  const abrir = async (r: AnyRow) => {
    setHistorico(r);
    setErro('');
    try {
      const x = await api(
        `/api/estoque/movimentos?estoqueId=${encodeURIComponent(r.estoque_id)}&itemId=${encodeURIComponent(r.item_id)}`,
      );
      setMovs(x.movimentos);
    } catch (e) {
      setErro(errorText(e));
    }
  };
  const fazerEstorno = async () => {
    if (!selecionado || !motivo.trim()) return;
    setBusy(true);
    setErro('');
    try {
      await api(
        `/api/estoque/movimentos/${encodeURIComponent(selecionado.id)}/estorno`,
        corpoJson('POST', { motivo }),
      );
      setSelecionado(null);
      setMotivo('');
      setVersao((v) => v + 1);
      if (historico) void abrir(historico);
    } catch (e) {
      setErro(
        e instanceof ApiError && e.details.codigo === 'duplicado'
          ? 'Este movimento já foi estornado.'
          : errorText(e),
      );
    } finally {
      setBusy(false);
    }
  };
  const salvarAjuste = async (body: AnyRow) => {
    setBusy(true);
    tentativaAjuste.current ??= crypto.randomUUID();
    try {
      await api('/api/estoque/ajustes', {
        ...corpoJson('POST', body),
        headers: {
          'content-type': 'application/json',
          'idempotency-key': tentativaAjuste.current,
        },
      });
      tentativaAjuste.current = null;
      setAjuste(false);
      setVersao((v) => v + 1);
    } catch (e) {
      setErro(
        e instanceof ApiError &&
          e.details.status === 409 &&
          e.details.codigo === 'duplicado'
          ? 'Este ajuste já foi registrado.'
          : errorText(e),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="patio-page space-y-4">
      <PageHeader
        actions={
          pode(user, 'estoque:gerenciar') && (
            <Button variant="outline" onClick={() => setAjuste(!ajuste)}>
              Ajuste / inventário
            </Button>
          )
        }
      />
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-0 basis-64 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            aria-label="Buscar item"
            placeholder="Buscar item"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <NativeSelect
          className="w-52"
          aria-label="Estoque"
          value={estoqueId}
          onChange={(e) => setEstoqueId(e.target.value)}
        >
          <NativeSelectOption value="">Todos os estoques</NativeSelectOption>
          {estoques.map((x) => (
            <NativeSelectOption key={x.id} value={x.id}>
              {x.nome}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {ajuste && (
        <AjusteForm estoques={estoques} onSave={salvarAjuste} busy={busy} />
      )}{' '}
      {erro && <p role="alert">{erro}</p>}
      <Card>
        <CardHeader className="border-b">
          <p className="patio-result-count">
            {rows.length} {rows.length === 1 ? 'item' : 'itens'}
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Estoque</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Saldo</TableHead>
                <TableHead>Unidade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={`${r.estoque_id}:${r.item_id}`}
                  className="cursor-pointer"
                  onClick={() => void abrir(r)}
                >
                  <TableCell>{r.estoque}</TableCell>
                  <TableCell>{r.descricao}</TableCell>
                  <TableCell>{r.saldo}</TableCell>
                  <TableCell>{r.unidade}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!rows.length && (
            <p className="p-4 text-sm text-muted-foreground">
              Nenhum item com saldo neste estoque.
            </p>
          )}
        </CardContent>
      </Card>
      {historico && (
        <Card>
          <CardContent>
            <h3 className="mb-3 font-semibold">
              Movimentações: {historico.descricao} · {historico.estoque}
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Quantidade</TableHead>
                  <TableHead>Documento / observação</TableHead>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movs.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.data_movimento}</TableCell>
                    <TableCell>
                      {m.tipo}
                      {m.baixa_codigo && (
                        <a
                          className="underline"
                          href={'/?aba=chamados&baixa=' + m.baixa_id}
                        >
                          {m.baixa_codigo}
                        </a>
                      )}
                    </TableCell>
                    <TableCell>
                      {m.quantidade} {m.unidade}
                    </TableCell>
                    <TableCell>
                      {m.documento || ''} {m.observacao || ''}
                    </TableCell>
                    <TableCell>{m.usuario || ''}</TableCell>
                    <TableCell>
                      {['entrada', 'ajuste'].includes(m.tipo) &&
                        !m.estornado &&
                        (m.tipo === 'ajuste'
                          ? pode(user, 'estoque:gerenciar')
                          : pode(user, 'estoque:lancar')) && (
                          <Button
                            variant="outline"
                            onClick={() => setSelecionado(m)}
                          >
                            Estornar
                          </Button>
                        )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button variant="outline" onClick={() => setHistorico(null)}>
              Fechar histórico
            </Button>
          </CardContent>
        </Card>
      )}
      {selecionado && (
        <Card>
          <CardContent>
            <Field label="Motivo do estorno">
              <Input
                required
                maxLength={300}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </Field>
            <Button
              disabled={busy || !motivo.trim()}
              onClick={() => void fazerEstorno()}
            >
              Confirmar estorno
            </Button>
            <Button variant="outline" onClick={() => setSelecionado(null)}>
              Cancelar
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AjusteForm({
  estoques,
  onSave,
  busy,
}: {
  estoques: AnyRow[];
  onSave: (body: AnyRow) => void;
  busy: boolean;
}) {
  const [estoqueId, setEstoqueId] = useState(''),
    [itemId, setItemId] = useState(''),
    [itens, setItens] = useState<AnyRow[]>([]),
    [quantidade, setQuantidade] = useState(''),
    [observacao, setObservacao] = useState('');
  useEffect(() => {
    void api('/api/catalogs/items').then((x) => setItens(x.itens));
  }, []);
  return (
    <Card>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({
              estoqueId,
              dataMovimento: new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/Sao_Paulo',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              }).format(new Date()),
              observacao,
              itens: [{ itemId, quantidade: Number(quantidade) }],
            });
          }}
        >
          <Field label="Estoque">
            <select
              required
              className="h-10 rounded-md border px-3"
              value={estoqueId}
              onChange={(e) => setEstoqueId(e.target.value)}
            >
              <option value="">Selecione</option>
              {estoques
                .filter((x) => x.ativo)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nome}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Item">
            <select
              required
              className="h-10 rounded-md border px-3"
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
            >
              <option value="">Selecione</option>
              {itens.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.descricao} · {i.unidade}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantidade (+/-)">
            <Input
              required
              type="number"
              step={
                itens.find((i) => i.id === itemId)?.unidade === 'un'
                  ? '1'
                  : '0.01'
              }
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
            />
          </Field>
          <Field label="Observação">
            <Input
              required
              maxLength={300}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
            />
          </Field>
          <Button disabled={busy}>Salvar ajuste</Button>
        </form>
      </CardContent>
    </Card>
  );
}
