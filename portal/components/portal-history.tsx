'use client';
import {
  rotuloAcaoHistorico,
  rotuloEntidadeHistorico,
} from '@/lib/historico-legivel';
import { api } from '@/lib/api';
import { useEffect, useState } from 'react';
import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  type JsonData,
  type AnyRow,
  Field,
  SelectField,
} from './portal-presentation';

export function ChangeHistory({ users }: JsonData) {
  const [logs, setLogs] = useState<AnyRow[]>([]),
    [meta, setMeta] = useState<AnyRow>({ page: 1, pageCount: 1, total: 0 }),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(true),
    [recarregar, setRecarregar] = useState(0),
    [erro, setErro] = useState(''),
    [f, setFiltros] = useState({
      user: '',
      action: '',
      entity: '',
      q: '',
      from: '',
      to: '',
    });
  const setF = (next: AnyRow) => {
    setFiltros(next as never);
    setPage(1);
  };
  useEffect(() => {
    // Flag local por execucao do efeito. Trocar de pagina rapido dispara varias
    // consultas: sem isto, uma resposta lenta sobrescreveria outra mais nova.
    // O cleanup desliga a flag, o que tambem cobre o componente sair da tela
    // antes de a resposta chegar.
    let ativa = true;
    // setState direto no corpo do efeito dispara renderizacao em cascata; o
    // microtask adia para depois do efeito e mantem o indicador de carregando.
    queueMicrotask(() => {
      if (ativa) {
        setLoading(true);
        setErro('');
      }
    });
    const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    p.set('page', String(page));
    p.set('pageSize', '50');
    void api(`/api/audit?${p}`)
      .then((result: AnyRow) => {
        if (!ativa) return; // resposta superada: descarta
        setLogs(result.logs);
        setMeta({
          page: result.page,
          pageCount: result.pageCount,
          total: result.total,
          pageSize: result.pageSize,
        });
      })
      .catch((e: unknown) => {
        // Sem este catch, uma indisponibilidade momentanea do servidor virava
        // rejeicao sem tratamento e a tela ficava carregando para sempre.
        if (!ativa) return;
        setErro(
          e instanceof Error
            ? e.message
            : 'Não foi possível carregar o histórico.',
        );
        setLogs([]);
      })
      .finally(() => {
        if (ativa) setLoading(false);
      });
    // Invalida esta consulta se o componente sair da tela antes da resposta.
    return () => {
      ativa = false;
    };
  }, [f, page, recarregar]);
  const load = () => setRecarregar((n) => n + 1);
  const actionTone = (a: string) =>
    a === 'CREATE'
      ? 'bg-emerald-50 text-emerald-700'
      : a === 'DELETE'
        ? 'bg-red-50 text-red-700'
        : a === 'IMPORT'
          ? 'bg-violet-50 text-violet-700'
          : a === 'LOGIN'
            ? 'bg-slate-100 text-slate-600'
            : 'bg-sky-50 text-sky-700';
  const entityName = rotuloEntidadeHistorico;
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Field label="Busca" className="xl:col-span-2">
            <Input
              placeholder="Detalhe, registro ou usuário"
              value={f.q}
              onChange={(e) => setF({ ...f, q: e.target.value })}
            />
          </Field>
          <SelectField
            label="Usuário"
            value={f.user}
            onChange={(v: string) => setF({ ...f, user: v })}
            rows={users || []}
          />
          <SelectField
            label="Ação"
            value={f.action}
            onChange={(v: string) => setF({ ...f, action: v })}
            rows={[
              { id: 'CREATE', name: 'Criação' },
              { id: 'UPDATE', name: 'Alteração' },
              { id: 'DELETE', name: 'Exclusão' },
              { id: 'UPSERT', name: 'Inclusão em lote' },
              { id: 'IMPORT', name: 'Importação' },
              { id: 'COMMENT', name: 'Andamento' },
              { id: 'LOGIN', name: 'Acesso' },
            ]}
          />
          <Field label="De">
            <Input
              type="date"
              value={f.from}
              onChange={(e) => setF({ ...f, from: e.target.value })}
            />
          </Field>
          <Field label="Até">
            <Input
              type="date"
              value={f.to}
              onChange={(e) => setF({ ...f, to: e.target.value })}
            />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="border-b sm:grid-cols-[1fr_auto]">
          <CardTitle>Histórico</CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                window.open(
                  `/api/audit/export?${new URLSearchParams(Object.entries(f).filter(([, v]) => v))}`,
                  '_blank',
                  'noopener,noreferrer',
                )
              }
            >
              <Download /> Exportar Excel
            </Button>
            <Button variant="outline" onClick={load}>
              <RefreshCw /> Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Registro</TableHead>
                <TableHead>Detalhes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm tabular-nums">
                    {new Date(r.createdAt).toLocaleString('pt-BR')}
                  </TableCell>
                  <TableCell>
                    <p className="text-sm font-medium">{r.user || 'Sistema'}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.userEmail || ''}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge className={actionTone(r.action)}>
                      {rotuloAcaoHistorico(r.action)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {entityName(r.entity)}
                  </TableCell>
                  <TableCell className="max-w-[28rem] whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {r.detailsText || r.details}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!loading && erro && (
            <div className="p-8">
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>Não foi possível carregar o histórico</AlertTitle>
                <AlertDescription>
                  <p>{erro}</p>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={load}
                  >
                    <RefreshCw /> Tentar de novo
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          )}
          {!loading && !erro && !logs.length && (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Nenhuma modificação com esses filtros.
            </div>
          )}
        </CardContent>
        {meta.pageCount > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={loading || meta.page <= 1}
                onClick={() => setPage(1)}
              >
                Primeira
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={loading || meta.page <= 1}
                onClick={() => setPage(meta.page - 1)}
              >
                ← Anterior
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={loading || meta.page >= meta.pageCount}
                onClick={() => setPage(meta.page + 1)}
              >
                Próxima →
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={loading || meta.page >= meta.pageCount}
                onClick={() => setPage(meta.pageCount)}
              >
                Última
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
