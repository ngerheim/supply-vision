'use client';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
    [loading, setLoading] = useState(false);
  const open = async (id: string) => {
    setLoading(true);
    try {
      setDetail(await api(`/api/imports/${id}`));
    } finally {
      setLoading(false);
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
                    <Badge
                      className={
                        r.status === 'completed'
                          ? 'bg-emerald-50 text-emerald-700'
                          : r.status === 'error'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-amber-50 text-amber-700'
                      }
                    >
                      {r.status === 'completed'
                        ? 'Concluída'
                        : r.status === 'error'
                          ? 'Com erro'
                          : r.status === 'conflict'
                            ? 'Não publicada: acordo ocupado'
                            : 'Processando'}
                    </Badge>
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
        open={!!detail || loading}
        onOpenChange={(value) => !value && setDetail(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {loading ? 'Carregando detalhes…' : detail?.filename}
            </DialogTitle>
            <DialogDescription>
              {detail
                ? `${detail.agreement || 'Base inicial'} · ${new Date(detail.createdAt).toLocaleString('pt-BR')}`
                : 'Aguarde um instante.'}
            </DialogDescription>
          </DialogHeader>
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
            <Button variant="outline" onClick={() => setDetail(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
