'use client';
import { AlertTriangle, CheckCircle2, LoaderCircle, Upload } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ResolveIssue } from './import-mappings';
import { ImportSummary, money } from './import-summary';
import { ListaErros } from './import-errors';
import { type AnyRow, type JsonData } from './portal-presentation';

export function ImportPreview({result,catalogs,canManageMappings,busy,onSave,onCatalog,ready,publish}:JsonData){return <>
          {result && !result.valid && (
            <div className="space-y-4" aria-live="polite">
              <Alert>
                <AlertTriangle />
                <AlertTitle>Confira as pendências</AlertTitle>
                <AlertDescription>
                  {result.error ||
                    `${result.totalErros} linha(s) precisam de atenção. Todas as correspondências abaixo exigem confirmação.`}
                </AlertDescription>
              </Alert>
              {(result.nomenclaturas || [])
                .slice(0, 30)
                .map((issue: AnyRow) => (
                  <ResolveIssue
                    key={`${issue.campo}-${issue.valor}`}
                    issue={issue}
                    catalogs={catalogs}
                    canManageMappings={canManageMappings}
                    busy={busy}
                    onSave={(targetId) => onSave(issue, targetId)}
                    onCatalog={onCatalog}
                  />
                ))}
              {(result.nomenclaturas?.length || 0) > 30 && (
                <p className="text-sm">
                  Exibindo 30 pendências por vez. As próximas aparecem conforme
                  você resolve as atuais.
                </p>
              )}
              {result.nomenclaturasOmitidas > 0 && (
                <p className="text-sm">
                  Há mais {result.nomenclaturasOmitidas} nomenclaturas. Elas
                  serão exibidas nas próximas conferências.
                </p>
              )}
              <ListaErros
                resumo={{
                  outrosErros: result.outrosErros,
                  outrosErrosOmitidos: result.outrosErrosOmitidos,
                }}
              />
              <p className="text-sm text-muted-foreground">
                Erros de preço ou células vazias devem ser corrigidos na
                planilha. Selecione o arquivo corrigido e confira novamente.
              </p>
            </div>
          )}
          {result?.valid && (
            <div className="space-y-4" aria-live="polite">
              <Alert>
                <CheckCircle2 />
                <AlertTitle>
                  {ready
                    ? 'Arquivo pronto para publicar'
                    : 'O cadastro mudou: confira o arquivo novamente'}
                </AlertTitle>
                <AlertDescription>
                  {result.summary.items} condição(ões) em{' '}
                  {result.summary.locations} localidade(s). Aba: {result.sheet}.
                </AlertDescription>
              </Alert>
              <ImportSummary summary={result.summary} estado="previa" />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {[
                        'Linha',
                        'Cidade/UF',
                        'Peça ou serviço',
                        'Modelo',
                        'Unidade',
                        'Preço',
                      ].map((label) => (
                        <TableHead key={label}>{label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(result.sample || []).map((row: AnyRow) => (
                      <TableRow key={row.linha}>
                        <TableCell>{row.linha}</TableCell>
                        <TableCell>
                          {row.cidade}/{row.uf}
                        </TableCell>
                        <TableCell>{row.item}</TableCell>
                        <TableCell>{row.modelo}</TableCell>
                        <TableCell>{row.unidade}</TableCell>
                        <TableCell>{money(row.preco)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Amostra das primeiras 20 condições.{' '}
                Publicar substituirá toda a tabela atual; a versão anterior permanecerá no histórico.
              </p>
              <Button disabled={busy || !ready} onClick={() => void publish()}>
                {busy ? <LoaderCircle className="animate-spin" /> : <Upload />}{' '}
                Publicar {result.summary.items}{' '}
                {result.summary.items === 1 ? 'condição' : 'condições'}
              </Button>
            </div>
          )}
    </>;
}
