'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api, errorText } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Status } from './status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ImportSummary } from './import-summary';
import { ListaErros } from './import-errors';
import { type AnyRow, type JsonData } from './portal-presentation';

const date = (value: string) => new Date(value).toLocaleString('pt-BR');
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p>{value}</p>
    </div>
  );
}

export function ImportHistory({ rows }: JsonData) {
  const [detail, setDetail] = useState<AnyRow | null>(null),
    [loading, setLoading] = useState(false),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [error, setError] = useState('');
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      sequence.current++;
      controller.current?.abort();
    },
    [],
  );
  const close = () => {
    sequence.current++;
    controller.current?.abort();
    setSelectedId(null);
    setDetail(null);
    setLoading(false);
    setError('');
  };
  const open = async (id: string) => {
    const request = ++sequence.current;
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setSelectedId(id);
    setDetail(null);
    setError('');
    setLoading(true);
    try {
      const next = await api(`/api/imports/${id}`, { signal: pending.signal });
      if (request === sequence.current) setDetail(next);
    } catch (cause) {
      if (request === sequence.current) setError(errorText(cause));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  };
  return (
    <>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Histórico</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Arquivo</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r: AnyRow) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <button
                      className="text-left hover:underline"
                      onClick={() => void open(r.id)}
                    >
                      <span className="block font-medium">{r.filename}</span>
                      <span className="block text-xs text-muted-foreground">
                        {r.agreement || 'Base inicial'}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <Status value={r.status}>
                      {r.status === 'completed'
                        ? 'Concluída'
                        : r.status === 'error'
                          ? 'Com erro'
                          : r.status === 'conflict'
                            ? 'Não publicada: acordo ocupado'
                            : 'Processando'}
                    </Status>
                  </TableCell>
                  <TableCell>{date(r.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!rows.length && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nenhuma importação registrada.
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog
        open={selectedId !== null}
        onOpenChange={(value) => !value && close()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {loading
                ? 'Carregando detalhes…'
                : detail?.filename || 'Detalhes da importação'}
            </DialogTitle>
            <DialogDescription>
              {detail
                ? `${detail.agreement || 'Base inicial'} · ${new Date(detail.createdAt).toLocaleString('pt-BR')}`
                : loading
                  ? 'Aguarde um instante.'
                  : 'Não foi possível abrir o registro.'}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Não foi possível carregar os detalhes</AlertTitle>
              <AlertDescription>
                <p>{error}</p>
                <Button
                  variant="outline"
                  onClick={() => selectedId && void open(selectedId)}
                >
                  Tentar novamente
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <Info label="Linhas" value={String(detail.totalRows || 0)} />
                <Info label="Válidas" value={String(detail.validRows || 0)} />
                <Info label="Com erro" value={String(detail.errorRows || 0)} />
              </div>
              {detail.summary?.error && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Falha na importação</AlertTitle>
                  <AlertDescription>{detail.summary.error}</AlertDescription>
                </Alert>
              )}
              <ListaErros resumo={detail.summary} />
              {detail.summary && (
                <ImportSummary
                  summary={detail.summary}
                  estado={detail.status === 'completed' ? 'criado' : 'falhou'}
                />
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
