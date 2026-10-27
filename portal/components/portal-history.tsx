'use client';
import { CampoData } from './campo-data';
import { PageHeader } from './page-header';
import {
  rotuloAcaoHistorico,
  rotuloEntidadeHistorico,
} from '@/lib/historico-legivel';
import { api, baixarArquivo, errorText } from '@/lib/api';
import { useEffect, useState } from 'react';
import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
    // O cancelamento descarta respostas superadas e interrompe a leitura HTTP.
    let ativa = true;
    const controller = new AbortController();
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
    const timer = setTimeout(() => {
      void api(`/api/audit?${p}`, { signal: controller.signal })
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
    }, 250);
    return () => {
      ativa = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [f, page, recarregar]);
  const load = () => setRecarregar((n) => n + 1);
  const actionTone = (a: string) =>
    a === 'CREATE'
      ? 'bg-muted text-muted-foreground'
      : a === 'DELETE'
        ? 'bg-muted text-muted-foreground'
        : a === 'IMPORT'
          ? 'bg-muted text-muted-foreground'
          : a === 'LOGIN'
            ? 'bg-muted text-muted-foreground'
            : 'bg-muted text-muted-foreground';
  const entityName = rotuloEntidadeHistorico;
  return (
    <div className="patio-page">
      <PageHeader
        actions={
          <>
            {' '}
            <Button
              variant="outline"
              onClick={() =>
                void baixarArquivo(
                  `/api/audit/export?${new URLSearchParams(Object.entries(f).filter(([, v]) => v))}`,
                ).catch((error) => alert(errorText(error)))
              }
            >
              <Download /> Exportar Excel
            </Button>
            <Button variant="outline" onClick={load}>
              <RefreshCw /> Atualizar
            </Button>
          </>
        }
      />
      <Card>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Field label="Busca" className="xl:col-span-2">
            <Input
              placeholder="Buscar"
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
            <CampoData

              value={f.from}
              onChange={(value) => setF({ ...f, from: value })}
            />
          </Field>
          <Field label="Até">
            <CampoData

              value={f.to}
              onChange={(value) => setF({ ...f, to: value })}
            />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="border-b sm:grid-cols-[1fr_auto]">
          <p className="patio-result-count">
            {meta.total} {meta.total === 1 ? 'registro' : 'registros'}
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Registro</TableHead>
                <TableHead>ID do registro</TableHead>
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
                  <TableCell className="text-sm">{r.entityId || ''}</TableCell>
                  <TableCell className="max-w-[28rem] whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {r.detailsText || r.details}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {loading && (
            <output className="block p-8 text-sm text-muted-foreground">
              Carregando histórico…
            </output>
          )}
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
            <span className="text-sm text-muted-foreground">
              Página {meta.page} de {meta.pageCount}
            </span>
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
