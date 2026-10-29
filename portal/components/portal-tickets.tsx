'use client';
import { PageHeader, LinhaDeAba } from './page-header';
import { Plaquinha } from './plaquinha';
import { COLUNAS_ORDENACAO_CHAMADOS } from '@/lib/operacao-dados';
import { gerarChaveRelatorio } from '@/lib/relatorios';
import { api, errorText } from '@/lib/api';
import { opcoesResponsavelChamado } from '@/lib/chamados';
import { criarConsultaDebounced } from '@/lib/atualizacao-periodica';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  CirclePlus,
  ArrowRightLeft,
} from 'lucide-react';
import { Status } from './status';
import { Prioridade } from './prioridade';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  Info,
  type JsonData,
  type AnyRow,
  Loading,
  PaginacaoDeLista,
  FalhaDeCarregamento,
  Field,
  SelectField,
  Empty,
} from './portal-presentation';
import { useOrdenacao, CabecalhoOrdenavel } from './portal-table';
import { TabelaPadrao, BarraFiltros } from './tela-padrao';

const ticketStatusMap: AnyRow = {
  aberto: ['Aberto', 'bg-muted text-muted-foreground ring-1 ring-border'],
  aguardando_fornecedor: [
    'Aguardando fornecedor',
    'bg-muted text-muted-foreground ring-1 ring-border',
  ],
  fechado: ['Fechado', 'bg-muted text-muted-foreground ring-1 ring-border'],
  cancelado: ['Cancelado', 'bg-muted text-muted-foreground ring-1 ring-border'],
};
function tempoEmAberto(criadoEm: string, fechadoEm?: string | null) {
  const inicio = new Date(criadoEm).getTime(),
    fim = fechadoEm ? new Date(fechadoEm).getTime() : Date.now();
  const ms = Math.max(fim - inicio, 0),
    horas = Math.floor(ms / 3600000),
    dias = Math.floor(horas / 24);
  const rotulo =
    dias >= 1
      ? `${dias}d ${horas % 24}h`
      : horas >= 1
        ? `${horas}h ${Math.floor((ms % 3600000) / 60000)}min`
        : `${Math.floor(ms / 60000)}min`;
  return { dias, horas, rotulo, encerrado: !!fechadoEm };
}
function Sla({ createdAt, closedAt }: JsonData) {
  const t = tempoEmAberto(createdAt, closedAt);
  if (t.encerrado)
    return (
      <div>
        <p className="font-medium tabular-nums">{t.rotulo}</p>
      </div>
    );
  const tom =
    t.dias >= 15
      ? 'text-muted-foreground'
      : t.dias >= 7
        ? 'text-muted-foreground'
        : 'text-foreground';
  const aviso =
    t.dias >= 15
      ? 'acima de 15 dias'
      : t.dias >= 7
        ? 'acima de 7 dias'
        : '';
  return (
    <div>
      <p className={`font-semibold tabular-nums ${tom}`}>{t.rotulo}</p>
      {aviso && <p
        className={`text-[11px] ${t.dias >= 7 ? tom : 'text-muted-foreground'}`}
      >
        {aviso}
      </p>}
    </div>
  );
}
function TicketStatus({ value }: JsonData) {
  const x = ticketStatusMap[value] || [value, 'bg-muted'];
  return <Status value={value}>{x[0]}</Status>;
}
export function Tickets({ busy, users, run, initialDetail }: JsonData) {
  const [data, setData] = useState<AnyRow | null>(null),
    [group, setGroup] = useState<'ativos' | 'fechados' | 'cancelados'>(
      'ativos',
    ),
    [q, setQ] = useState(''),
    [open, setOpen] = useState<AnyRow | null>(null),
    [detail, setDetail] = useState<string | null>(initialDetail || null);
  const { ordem, alternar } = useOrdenacao('tickets');
  const querySort = ordem
    ? `&sort=${COLUNAS_ORDENACAO_CHAMADOS[ordem.coluna]}&direction=${ordem.direcao === 1 ? 'asc' : 'desc'}`
    : '';
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState('');
  const [consulta] = useState(() =>
    criarConsultaDebounced<AnyRow>(setData, (erro) =>
      setLoadError(errorText(erro)),
    ),
  );
  const ultimaBusca = useRef(q);
  const load = useCallback(
    async (atraso = 0) => {
      setLoadError('');
      await consulta.executar(
        (signal) =>
          api(
            `/api/tickets?page=${page}&pageSize=50&group=${group}&q=${encodeURIComponent(q)}${querySort}`,
            { signal },
          ),
        atraso,
      );
    },
    [page, group, q, querySort, consulta],
  );
  useEffect(() => {
    let active = true;
    const atraso = q !== ultimaBusca.current ? 300 : 0;
    ultimaBusca.current = q;
    queueMicrotask(() => {
      if (active) void load(atraso);
    });
    return () => {
      active = false;
      consulta.cancelar();
    };
  }, [load, q, consulta]);
  if (loadError)
    return <FalhaDeCarregamento erro={loadError} tentar={() => void load()} />;
  if (!data)
    return (
      <div className="patio-page">
        <PageHeader />
        <Loading label="Carregando chamados…" compact />
      </div>
    );
  if (detail)
    return (
      <TicketDetail
        busy={busy}
        id={detail}
        users={users}
        onBack={() => {
          setDetail(null);
          void load();
        }}
        run={run}
      />
    );
  const s = data.stats || {};
  const rows = data.tickets || [];
  const pageCount = data.pageCount,
    currentPage = data.page;
  return (
    <div className="patio-page">
      <LinhaDeAba
        actions={
          <Button
            variant="create"
            onClick={() => setOpen({ priority: 'media' })}
          >
            <Plus /> Novo chamado
          </Button>
        }
      />
      <div className="patio-ticket-groups" role="tablist" aria-label="Status dos chamados">
        {(
          [
            [
              'ativos',
              'Ativos',
              Number(s.aberto || 0) + Number(s.aguardando || 0),
            ],
            ['fechados', 'Finalizados', s.fechado],
            ['cancelados', 'Cancelados', s.cancelado],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            className={group === key ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground'}
            role="tab"
            aria-selected={group === key}
            onClick={() => {
              setGroup(key);
              setPage(1);
            }}
          >
            {label}
            <span className="patio-tab-count">{Number(count || 0)}</span>
          </button>
        ))}
      </div>
      <BarraFiltros busca={q} onBusca={value => { setQ(value); setPage(1); }} placeholder="Pesquisar chamados" />
      <TabelaPadrao contador={`${data.total ?? rows.length} ${(data.total ?? rows.length) === 1 ? 'chamado' : 'chamados'}`} pagina={<PaginacaoDeLista pagina={currentPage} paginas={pageCount} alterar={setPage} />} vazio={!rows.length ? <Empty icon={MessageSquare} title="Nenhum chamado" /> : undefined}>
      <Table className="w-full min-w-[900px] table-fixed">
              <colgroup>
                {[12, 27, 10, 22, 14, 15].map((largura, indice) => (
                  <col key={indice} style={{ width: `${largura}%` }} />
                ))}
              </colgroup>
              <TableHeader>
                <CabecalhoOrdenavel
                  acoes={false}
                  titulos={[
                    'Código',
                    'Fornecedor',
                    'Prioridade',
                    'Situação',
                    'Em aberto',
                    'Solicitante',
                  ]}
                  ordem={ordem}
                  onAlternar={(coluna: number) => {
                    alternar(coluna);
                    setPage(1);
                  }}
                />
              </TableHeader>
              <TableBody>
                {rows.map((r: AnyRow) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <button
                        className="block w-full text-left text-link hover:underline"
                        title={r.code}
                        onClick={() => setDetail(r.id)}
                      >
                        <Plaquinha>{r.code}</Plaquinha>
                      </button>
                    </TableCell>

                    <TableCell>
                      <span
                        className="block truncate font-medium"
                        title={r.supplierName}
                      >
                        {r.supplierName || 'Não informado'}
                      </span>
                    </TableCell>

                    <TableCell>
                      <Prioridade value={r.priority} />
                    </TableCell>
                    <TableCell>
                      <TicketStatus value={r.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      <Sla createdAt={r.createdAt} closedAt={r.closedAt} />
                    </TableCell>
                    <TableCell
                      className="truncate text-sm"
                      title={r.requestedBy || 'Não informado'}
                    >
                      {r.requestedBy || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
      </Table>
      </TabelaPadrao>
      {open && (
        <TicketDialog
          busy={busy}
          open
          value={open}
          users={users}
          onClose={() => setOpen(null)}
          onSave={(body: AnyRow, submissionKey: string) =>
            run(async () => {
              await api('/api/tickets', {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  'idempotency-key': submissionKey,
                },
                body: JSON.stringify(body),
              });
              setOpen(null);
              await load();
            }, 'Chamado aberto.')
          }
        />
      )}
    </div>
  );
}

function TicketDetail({ busy, id, users, onBack, run }: JsonData) {
  const tentativaAndamento = useRef<{ message: string; key: string } | null>(
    null,
  );
  const [d, setD] = useState<AnyRow | null>(null),
    [msg, setMsg] = useState(''),
    [status, setStatus] = useState(''),
    [statusMessage, setStatusMessage] = useState(''),
    [editing, setEditing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusRevision, setStatusRevision] = useState<number | null>(null);
  const loadSequence = useRef({ value: 0 });
  const load = useCallback(
    async (resetStatus = true) => {
      const sequence = ++loadSequence.current.value;
      setLoading(true);
      setLoadError('');
      try {
        const x = await api(`/api/tickets/${id}`);
        if (sequence !== loadSequence.current.value) return;
        setD(x);
        if (resetStatus) {
          setStatus(x.ticket.status);
          setStatusMessage('');
          setStatusRevision(x.ticket.revision);
        }
      } catch (error) {
        if (sequence === loadSequence.current.value)
          setLoadError(errorText(error));
      } finally {
        if (sequence === loadSequence.current.value) setLoading(false);
      }
    },
    [id],
  );
  useEffect(() => {
    const sequence = loadSequence.current;
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      sequence.value++;
    };
  }, [load]);
  if (loadError)
    return (
      <FalhaDeCarregamento
        erro={loadError}
        tentar={() =>
          void load(!d || (status === d.ticket.status && !statusMessage))
        }
        voltar={onBack}
      />
    );
  if (!d)
    return (
      <div className="patio-page">
        <PageHeader />
        <Loading label="Abrindo chamado…" compact />
      </div>
    );
  const t = d.ticket;
  return (
    <div className="patio-page">
      <PageHeader
        back={{ label: '← Chamados', onClick: onBack }}
        title={
          <>
            <Plaquinha>{t.code}</Plaquinha>
            <span className="patio-detail-name" title={t.supplier_name}>
              {t.supplier_name}
            </span>
          </>
        }
        status={
          <>
            <TicketStatus value={t.status} />
            <Prioridade value={t.priority} />
          </>
        }
        actions={
          <>
            <Button
              disabled={busy || loading}
              variant="outline"
              onClick={() => {
                if (
                  (status !== t.status || statusMessage) &&
                  !confirm(
                    'Atualizar o chamado descarta a situação e a mensagem de alteração ainda não salvas. Continuar?',
                  )
                )
                  return;
                void load();
              }}
            >
              <RefreshCw /> Atualizar
            </Button>
            <Button disabled={busy || loading} onClick={() => setEditing(true)}>
              <Pencil /> Editar chamado
            </Button>
          </>
        }
      />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Info
          label="Local"
          value={t.city ? [t.city, t.state].filter(Boolean).join(' / ') : '—'}
        />
        <Info label="Solicitante" value={t.requestedBy || '—'} />
        <Info label="Responsável" value={t.assignedTo || 'Não atribuído'} />
        <Card size="sm">
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {t.closed_at ? 'Tempo até encerrar' : 'Tempo em aberto'}
            </p>
            <div className="mt-1">
              <Sla createdAt={t.created_at} closedAt={t.closed_at} />
            </div>
          </CardContent>
        </Card>
      </section>
      {(t.scope || t.notes) && (
        <Card size="sm" className="w-full">
          <CardContent className="space-y-3 text-sm">
            {t.scope && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Escopo
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words">
                  {t.scope}
                </p>
              </div>
            )}
            {t.notes && (
              <div>
                <p className="text-xs font-semibold tracking-wide text-muted-foreground">
                  Observações
                </p>
                <p className="mt-1 whitespace-pre-wrap">{t.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      <Card size="sm">
        <CardContent>
          <fieldset
            disabled={busy || loading}
            className="grid gap-3 grid-cols-[minmax(240px,280px)_minmax(0,1fr)_auto] sm:items-end"
          >
            <SelectField
              label="Alterar para"
              disabled={busy || loading}
              value={status}
              onChange={setStatus}
              rows={Object.entries(ticketStatusMap).map(([k, v]: JsonData) => ({
                id: k,
                name: v[0],
              }))}
            />
            <Field label="Mensagem da alteração (opcional)">
              <Input
                value={statusMessage}
                onChange={(e) => setStatusMessage(e.target.value)}
              />
            </Field>
            <Button
              disabled={busy || loading || status === t.status}
              onClick={() =>
                run(async () => {
                  await api(`/api/tickets/${id}`, {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      status,
                      statusMessage,
                      expectedRevision: statusRevision,
                    }),
                  });
                  await load();
                }, 'Situação atualizada.')
              }
            >
              <RefreshCw /> Aplicar
            </Button>
          </fieldset>
          {statusRevision !== t.revision && (
            <output className="mt-3 block text-sm">
              O chamado mudou. Sua alteração ainda não foi salva. Use Atualizar
              para conferir a situação atual antes de aplicar.
            </output>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-5">
          <ol className="relative space-y-5 border-l border-dashed pl-6">
            {d.events.map((e: AnyRow) => (
              <li
                key={e.id}
                className="relative animate-in fade-in slide-in-from-left-2 fill-mode-both"
              >
                <span className="patio-event-marker" aria-hidden="true">
                  {e.kind === 'created' ? (
                    <CirclePlus />
                  ) : e.kind === 'status' ? (
                    <ArrowRightLeft />
                  ) : (
                    <MessageSquare />
                  )}
                </span>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold">
                    {e.user || 'Sistema'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString('pt-BR')}
                  </span>
                </div>
                {e.kind === 'status' && (
                  <p className="mt-1 text-sm">
                    Situação alterada de{' '}
                    <b>
                      {(ticketStatusMap[e.fromStatus] || [e.fromStatus])[0]}
                    </b>{' '}
                    para{' '}
                    <b>{(ticketStatusMap[e.toStatus] || [e.toStatus])[0]}</b>.
                  </p>
                )}
                {e.message && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {e.message}
                  </p>
                )}
              </li>
            ))}
          </ol>
          <div className="mt-6 space-y-3 border-t pt-5">
            <Field label="Registrar andamento">
              <Textarea
                disabled={busy || loading}
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
              />
            </Field>
            <div className="flex justify-end">
              <Button
                disabled={busy || loading || !msg.trim()}
                onClick={() =>
                  run(async () => {
                    if (
                      !tentativaAndamento.current ||
                      tentativaAndamento.current.message !== msg
                    )
                      tentativaAndamento.current = {
                        message: msg,
                        key: gerarChaveRelatorio(),
                      };
                    await api(`/api/tickets/${id}/events`, {
                      method: 'POST',
                      headers: {
                        'content-type': 'application/json',
                        'idempotency-key': tentativaAndamento.current.key,
                      },
                      body: JSON.stringify({ message: msg }),
                    });
                    tentativaAndamento.current = null;
                    setMsg('');
                    await load(status === t.status && !statusMessage);
                  }, 'Andamento registrado.')
                }
              >
                <Plus /> Adicionar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      {editing && (
        <TicketDialog
          busy={busy}
          open
          value={{
            id: t.id,
            expectedRevision: t.revision,
            supplierName: t.supplier_name,
            city: t.city,
            state: t.state,
            scope: t.scope,
            priority: t.priority,
            assignedTo: t.assigned_to,
            agreementId: t.agreement_id,
            notes: t.notes,
          }}
          responsavelAtual={
            t.assigned_to
              ? { id: t.assigned_to, name: t.assignedTo || 'Responsável atual' }
              : null
          }
          users={users}
          onClose={() => setEditing(false)}
          onSave={(body: AnyRow) =>
            run(async () => {
              await api(`/api/tickets/${id}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
              });
              setEditing(false);
              await load(status === t.status && !statusMessage);
            }, 'Chamado atualizado.')
          }
        />
      )}
    </div>
  );
}

function TicketDialog({
  busy,
  open,
  value,
  users,
  responsavelAtual,
  onClose,
  onSave,
}: JsonData) {
  const [form, setForm] = useState<AnyRow>(value || { priority: 'media' }),
    editing = !!value?.id;
  const [submissionKey] = useState(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
  );
  return (
    <Dialog open={open} onOpenChange={(x) => !x && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Editar chamado' : 'Novo chamado'}
          </DialogTitle>
        </DialogHeader>
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <Field label="Fornecedor *" className="sm:col-span-2">
            <Input
              required
              aria-label="Fornecedor"
              maxLength={120}
              value={form.supplierName || ''}
              onChange={(e) =>
                setForm({ ...form, supplierName: e.target.value })
              }
            />
          </Field>
          <Field label="Cidade">
            <Input
              value={form.city || ''}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </Field>
          <Field label="UF">
            <Input
              maxLength={2}
              value={form.state || ''}
              onChange={(e) =>
                setForm({ ...form, state: e.target.value.toUpperCase() })
              }
            />
          </Field>
          <SelectField
            label="Prioridade"
            disabled={busy}
            value={form.priority || 'media'}
            onChange={(v: string) => setForm({ ...form, priority: v })}
            rows={[
              { id: 'alta', name: 'Alta' },
              { id: 'media', name: 'Média' },
              { id: 'baixa', name: 'Baixa' },
            ]}
          />
          <SelectField
            label="Responsável"
            disabled={busy}
            value={form.assignedTo || ''}
            onChange={(v: string) => setForm({ ...form, assignedTo: v })}
            rows={opcoesResponsavelChamado(
              users || [],
              editing ? responsavelAtual : null,
            )}
          />

          <Field label="Escopo pretendido" className="sm:col-span-2">
            <Input
              value={form.scope || ''}
              onChange={(e) => setForm({ ...form, scope: e.target.value })}
            />
          </Field>
          <Field label="Observações" className="sm:col-span-2">
            <Textarea
              value={form.notes || ''}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </fieldset>
        <DialogFooter>
          <Button disabled={busy} variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={busy || !form.supplierName?.trim()}
            onClick={() => onSave(form, submissionKey)}
          >
            <CheckCircle2 /> {editing ? 'Salvar alterações' : 'Abrir chamado'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
