'use client';
import { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  LoaderCircle,
  Upload,
} from 'lucide-react';
import { api, ApiError, errorText } from '@/lib/api';
import { MAX_IMPORT_BYTES, normalizeImportText } from '@/lib/domain';
import { SearchSelect } from '@/components/search-select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ImportSummary } from './import-summary';
import { ImportHistory } from './import-history';
import { type AnyRow } from './portal-presentation';
import { ImportPreview } from './import-preview';

export function Imports({
  data,
  canManageMappings,
  initialAgreement = '',
  onUpdated,
  onCatalog,
}: {
  data: AnyRow;
  canManageMappings: boolean;
  initialAgreement?: string;
  onUpdated: () => Promise<void>;
  onCatalog: (type: string, values?: AnyRow) => void;
}) {
  const [agreement, setAgreement] = useState(initialAgreement);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<AnyRow | null>(null);
  const [checkedCatalogs, setCheckedCatalogs] = useState<AnyRow | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [published, setPublished] = useState<AnyRow | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const reset = () => {
    setResult(null);
    setPublished(null);
    setError('');
  };
  const choose = (candidate?: File) => {
    if (busyRef.current) return;
    if (fileInput.current) fileInput.current.value = '';
    reset();
    setFile(null);
    if (!candidate) return;
    if (!/\.(xlsx|xls)$/i.test(candidate.name)) {
      setError('Selecione uma planilha Excel .xlsx ou .xls.');
      return;
    }
    if (!candidate.size || candidate.size > MAX_IMPORT_BYTES) {
      setError('O arquivo deve ter conteúdo e no máximo 2 MB.');
      return;
    }
    setFile(candidate);
  };
  const request = async (preview: boolean) => {
    if (!file || !agreement)
      throw new Error('Selecione o acordo e a planilha antes de conferir.');
    const body = new FormData();
    body.set('file', file);
    const path = `/api/imports/agreement/${agreement}`;
    return api(path + (preview ? '?preview=1' : ''), { method: 'POST', body });
  };
  const analyze = async () => {
    if (busyRef.current || !file || !agreement) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setPublished(null);
    try {
      setResult(await request(true));
      setCheckedCatalogs(data.catalogs);
    } catch (cause) {
      setError(errorText(cause));
      setResult(null);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const publish = async () => {
    if (
      busyRef.current ||
      !file ||
      !agreement ||
      !result?.valid ||
      checkedCatalogs !== data.catalogs
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await request(false);
      setPublished(saved?.summary);
      setResult(null);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      try {
        await onUpdated();
      } catch {
        setError(
          'Importação publicada, mas não foi possível atualizar a tela. Atualize os dados para conferir o histórico.',
        );
      }
    } catch (cause) {
      setError(errorText(cause));
      setResult(cause instanceof ApiError ? cause.details : null);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const save = async (issue: AnyRow, targetId: string) => {
    if (busyRef.current || !canManageMappings || !targetId) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const mappings = await api('/api/mappings');
      const key = normalizeImportText(issue.valor);
      const existing = mappings[issue.tipo]?.find(
        (mapping: AnyRow) => mapping.sourceKey === key,
      );
      await api(
        `/api/mappings/${issue.tipo}${existing ? '/' + existing.id : ''}`,
        {
          method: existing ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedRevision: existing?.revision,
            source: issue.valor,
            targetId,
            active: true,
          }),
        },
      );
      setResult(await request(true));
      setCheckedCatalogs(data.catalogs);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const template = async () => {
    try {
      const XLSX = await import('xlsx');
      const columns = [
        'CIDADE',
        'UF',
        'MODELO',
        'PECA_SERVICO',
        'PRECO',
        'MEDIDA',
        'MARCAS',
      ];
      const book = XLSX.utils.book_new(),
        sheet = XLSX.utils.aoa_to_sheet([columns]);
      sheet['!cols'] = columns.map(() => ({ wch: 24 }));
      XLSX.utils.book_append_sheet(book, sheet, 'Acordos');
      XLSX.writeFile(book, 'modelo-acordos.xlsx');
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  const ready = result?.valid && checkedCatalogs === data.catalogs;
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Card>
        <CardContent className="space-y-5">
          <fieldset disabled={busy} className="space-y-4">
            <SearchSelect
              disabled={busy}
              label="Acordo de destino"
              value={agreement}
              onChange={(value) => {
                setAgreement(value);
                reset();
              }}
              options={data.agreements.map((row: AnyRow) => ({
                id: row.id,
                name: `${row.number} · ${row.supplier}`,
              }))}
            />
            <input
              ref={fileInput}
              className="hidden"
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => choose(event.target.files?.[0])}
            />
            <button
              type="button"
              className="w-full rounded-xl border-2 border-dashed p-7 text-center hover:bg-muted/40"
              onClick={() => fileInput.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (!busy) choose(event.dataTransfer.files[0]);
              }}
            >
              <Upload className="mx-auto mb-3 text-primary" />
              <p className="font-medium break-all">
                {file?.name || 'Arraste a planilha ou clique para selecionar'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                até 2 MB · até 1.000 linhas, incluindo o cabeçalho
              </p>
            </button>
            <div className="flex flex-wrap justify-between gap-3">
              <Button variant="outline" onClick={() => void template()}>
                <Download /> Baixar modelo
              </Button>
              <Button
                disabled={!file || !agreement}
                onClick={() => void analyze()}
              >
                {busy ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <CheckCircle2 />
                )}{' '}
                Conferir arquivo
              </Button>
            </div>
          </fieldset>
          {error && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Não foi possível concluir</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <ImportPreview
            result={result}
            catalogs={data.catalogs}
            canManageMappings={canManageMappings}
            busy={busy}
            onSave={save}
            onCatalog={onCatalog}
            ready={ready}
            publish={publish}
          />
          {published && (
            <Alert>
              <CheckCircle2 />
              <AlertTitle>Importação publicada</AlertTitle>
              <AlertDescription>
                <p>{published.items} condição(ões) publicada(s).</p>
                <ImportSummary summary={published} estado="criado" />
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
      {Number(data.totalImports) > data.imports.length && (
        <output>
          Mostrando as 100 importações mais recentes de {data.totalImports}.
        </output>
      )}
      <ImportHistory rows={data.imports} total={data.totalImports} />
    </div>
  );
}
