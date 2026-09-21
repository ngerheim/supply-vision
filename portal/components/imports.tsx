'use client';

import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  LoaderCircle,
  Upload,
} from 'lucide-react';
import { api, ApiError, errorText } from '@/lib/api';
import { normalizeImportText } from '@/lib/domain';
import { suggestMatches } from '@/lib/sugestoes';
import { SearchSelect } from '@/components/search-select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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

type JsonData = ReturnType<typeof JSON.parse>;
type AnyRow = Record<string, JsonData>;
const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    value,
  );
const date = (value: string) => new Date(value).toLocaleString('pt-BR');
const names: Record<string, string> = {
  items: 'Peça ou serviço',
  models: 'Modelo',
  units: 'Unidade',
  locations: 'Cidade/UF',
  CNPJ: 'Fornecedor',
};
function optionsFor(
  catalogs: AnyRow,
  type: string,
): { id: string; name: string }[] {
  return (catalogs[type] || [])
    .filter((row: AnyRow) => type === 'locations' || row.active)
    .map((row: AnyRow) => ({
      id: row.id,
      name:
        type === 'locations'
          ? `${row.city}/${row.state}`
          : type === 'units'
            ? row.code
            : row.name,
    }));
}

export function Imports({
  data,
  isAdmin,
  initialAgreement = '',
  onUpdated,
  onCatalog,
}: {
  data: AnyRow;
  isAdmin: boolean;
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
  const reset = () => {
    setResult(null);
    setPublished(null);
    setError('');
  };
  const choose = (candidate?: File) => {
    reset();
    setFile(null);
    if (!candidate) return;
    if (!/\.(xlsx|xls)$/i.test(candidate.name)) {
      setError('Selecione uma planilha Excel .xlsx ou .xls.');
      return;
    }
    if (!candidate.size || candidate.size > 15 * 1024 * 1024) {
      setError('O arquivo deve ter conteúdo e no máximo 15 MB.');
      return;
    }
    setFile(candidate);
  };
  const request = async (preview: boolean) => {
    if (!file) return null;
    const body = new FormData();
    body.set('file', file);
    const path = `/api/imports/agreement/${agreement}`;
    return api(path + (preview ? '?preview=1' : ''), { method: 'POST', body });
  };
  const analyze = async () => {
    if (busy) return;
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
      setBusy(false);
    }
  };
  const publish = async () => {
    if (busy || !result?.valid || checkedCatalogs !== data.catalogs) return;
    setBusy(true);
    setError('');
    try {
      const saved = await request(false);
      setPublished(saved?.summary);
      setResult(null);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await onUpdated();
    } catch (cause) {
      setError(errorText(cause));
      setResult(cause instanceof ApiError ? cause.details : null);
    } finally {
      setBusy(false);
    }
  };
  const save = async (issue: AnyRow, targetId: string) => {
    setBusy(true);
    setError('');
    try {
      const mappings = await api('/api/mappings');
      const key =
        issue.tipo === 'locations'
          ? issue.valor.split('/').map(normalizeImportText).join('/')
          : normalizeImportText(issue.valor);
      const existing = mappings[issue.tipo]?.find(
        (mapping: AnyRow) => mapping.sourceKey === key,
      );
      await api(
        `/api/mappings/${issue.tipo}${existing ? '/' + existing.id : ''}`,
        {
          method: existing ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source: issue.valor, targetId, active: true }),
        },
      );
      setResult(await request(true));
      setCheckedCatalogs(data.catalogs);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
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
        <CardHeader>
          <CardTitle>Importar acordos</CardTitle>
          <p className="text-sm text-muted-foreground">
            1. Escolha o arquivo · 2. Confira as correspondências · 3. Publique
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <fieldset disabled={busy} className="space-y-4">
            <div className="rounded-xl border border-primary bg-accent/40 p-4">
              <p className="font-semibold">Adicionar ou atualizar um acordo</p>
              <p className="mt-1 text-sm text-muted-foreground">Substitui todas as condições do acordo escolhido. A versão anterior permanece no histórico.</p>
            </div>
            <SearchSelect
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
                Excel · até 15 MB · até 50 mil linhas, incluindo o cabeçalho
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
          <p className="text-sm text-muted-foreground">
            A conferência não publica dados. Itens repetidos na mesma cidade/UF
            e modelo mantêm o menor preço; medidas diferentes exigem correção.
          </p>
          {error && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Não foi possível concluir</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
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
                    catalogs={data.catalogs}
                    isAdmin={isAdmin}
                    busy={busy}
                    onSave={(targetId) => save(issue, targetId)}
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
      <ImportHistory rows={data.imports} />
    </div>
  );
}

function ResolveIssue({
  issue,
  catalogs,
  isAdmin,
  busy,
  onSave,
  onCatalog,
}: {
  issue: AnyRow;
  catalogs: AnyRow;
  isAdmin: boolean;
  busy: boolean;
  onSave: (targetId: string) => Promise<void>;
  onCatalog: (type: string, values?: AnyRow) => void;
}) {
  const [target, setTarget] = useState('');
  const options = useMemo(
    () => optionsFor(catalogs, issue.tipo),
    [catalogs, issue.tipo],
  );
  // Medida nao entra na sugestao por semelhanca. Nomenclatura e localidade a
  // pessoa confere batendo o olho; medida, nao — LITRO nao se parece com nada,
  // e aceitar a mais proxima grava preco de litro como preco de unidade em toda
  // a carga, sem travar e sem avisar. Sem cadastro correto, a importacao para.
  // Localidade e unidade nao aceitam correspondencia: a primeira porque cidade
  // se cadastra, nao se traduz; a segunda porque medida errada corrompe o preco
  // em silencio. Nos dois casos o caminho e cadastrar o que falta.
  const suggestions = useMemo(
    () => (issue.tipo === 'locations' || issue.tipo === 'units' ? [] : suggestMatches(issue.valor, options)),
    [issue.valor, issue.tipo, options],
  );
  const type = issue.tipo || (issue.campo === 'CNPJ' ? 'suppliers' : '');
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <p className="font-medium">
        {names[issue.tipo || issue.campo] || issue.campo}: {issue.valor}
      </p>
      <p className="text-xs text-muted-foreground">
        {issue.linhas} linha(s), primeira ocorrência na linha{' '}
        {issue.primeiraLinha}. {issue.erro}
      </p>
      {issue.tipo && isAdmin ? (
        <>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs">Sugestões para conferir:</span>
              {suggestions.map((option) => (
                <Button
                  size="sm"
                  variant="outline"
                  key={option.id}
                  disabled={busy}
                  onClick={() => setTarget(option.id)}
                >
                  {option.name}
                </Button>
              ))}
            </div>
          )}
          <SearchSelect
            label="Correspondência correta"
            value={target}
            onChange={setTarget}
            options={options}
            disabled={busy}
          />
          <Button
            disabled={busy || !target}
            onClick={() => void onSave(target)}
          >
            Confirmar e lembrar correspondência
          </Button>
        </>
      ) : issue.tipo ? (
        <p className="text-sm">
          Peça a um administrador para confirmar o De/Para ou corrija o valor na
          planilha.
        </p>
      ) : null}
      {type && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            onCatalog(type, type === 'suppliers' ? { cnpj: issue.valor } : {})
          }
        >
          {type === 'suppliers'
            ? 'Cadastrar fornecedor'
            : 'Cadastrar opção ausente'}
        </Button>
      )}
    </div>
  );
}

type Estado = 'previa' | 'criado' | 'falhou';

// Um texto so, decidido pelo estado da importacao: na previa nada foi gravado,
// na conclusao os cadastros existem, e numa importacao recusada nada chegou a
// ser criado — dizer "criados" ali seria mentira.
const TITULO_BASE: Record<Estado, string> = {
  previa: 'Cadastros que serão criados a partir do arquivo:',
  criado: 'Cadastros criados a partir do arquivo:',
  falhou: 'Cadastros previstos no arquivo. A importação não foi concluída:',
};

function BaseCriada({ base, estado }: { base: AnyRow; estado: Estado }) {
  // A carga inicial cria cadastro a partir do proprio arquivo. Sem esta
  // conferencia previa, o operador so descobre uma nomenclatura que escapou do
  // de/para depois que ela ja virou item no catalogo.
  const grupos: { chave: string; singular: string; rotulo: string }[] = [
    { chave: 'localidades', singular: 'localidade', rotulo: 'localidades' },
    { chave: 'itens', singular: 'item', rotulo: 'itens' },
    { chave: 'modelos', singular: 'modelo', rotulo: 'modelos' },
    { chave: 'fornecedores', singular: 'fornecedor', rotulo: 'fornecedores' },
  ];
  const quantos = (chave: string) => Number(base[chave]) || 0;
  const amostraDe = (chave: string): string[] => {
    const lista: unknown = base.amostra?.[chave];
    return Array.isArray(lista) ? lista.map((nome) => String(nome)) : [];
  };
  const presentes = grupos.filter((grupo) => quantos(grupo.chave) > 0);
  if (!presentes.length) return null;
  return (
    <div className="space-y-2">
      <p className="font-medium">
        {TITULO_BASE[estado]}{' '}
        {presentes
          .map((grupo) => `${quantos(grupo.chave).toLocaleString('pt-BR')} ${quantos(grupo.chave) === 1 ? grupo.singular : grupo.rotulo}`)
          .join(', ')}
        .
      </p>
      {presentes.map((grupo) => {
        const amostra = amostraDe(grupo.chave);
        if (!amostra.length) return null;
        return (
          <details key={grupo.chave}>
            <summary className="cursor-pointer">
              Ver {grupo.rotulo} ({quantos(grupo.chave)})
            </summary>
            <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
              {amostra.map((nome, index) => (
                <li key={index}>{nome}</li>
              ))}
            </ul>
            {quantos(grupo.chave) > amostra.length && (
              <p>Amostra dos primeiros {amostra.length}.</p>
            )}
          </details>
        );
      })}
    </div>
  );
}

function ImportSummary({ summary, estado }: { summary: AnyRow; estado: Estado }) {
  return (
    <div className="space-y-2 text-sm">
      {!!summary.baseCriada && <BaseCriada base={summary.baseCriada} estado={estado} />}
      {!!summary.cnpjsRecuperados && (
        <p>
          {summary.cnpjsRecuperados} CNPJ(s) tiveram zeros à esquerda
          recuperados.
        </p>
      )}
      {!!summary.duplicatas && (
        <details>
          <summary className="cursor-pointer font-medium">
            {summary.duplicatas} linha(s) repetida(s) resolvida(s) pelo menor
            preço
          </summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
            {(summary.amostraDuplicatas || []).map(
              (row: AnyRow, index: number) => (
                <li key={index}>
                  Linha {row.linhaMantida}: {row.item}, {row.cidade} — mantido{' '}
                  {money(row.precoMantido)}; linha {row.linhaDescartada}{' '}
                  descartada ({money(row.precoDescartado)}).
                </li>
              ),
            )}
          </ul>
          {summary.duplicatas > 50 && (
            <p>Amostra dos primeiros 50 descartes.</p>
          )}
        </details>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p>{value}</p>
    </div>
  );
}

function ImportHistory({ rows }: JsonData) {
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
          <CardTitle>Histórico de importações</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Arquivo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Linhas</TableHead>
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
                    {r.mode === 'legacy' ? 'Carga inicial' : 'Substituição'}
                  </TableCell>
                  <TableCell>
                    {Number(r.totalRows).toLocaleString('pt-BR')}
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

// Le tanto o formato novo (nomenclaturas agrupadas + erros de linha) quanto o
// antigo (sampleErrors), porque o historico guarda importacoes ja feitas.
function ListaErros({ resumo }: JsonData) {
  if (!resumo) return null;
  const nomenclaturas = resumo.nomenclaturas || [],
    outros = resumo.outrosErros || [],
    legado = resumo.sampleErrors || [];
  if (!nomenclaturas.length && !outros.length && !legado.length) return null;
  return (
    <div className="mt-2 space-y-3">
      {nomenclaturas.length > 0 && (
        <div>
          <p className="mb-1 font-medium">
            Nomenclaturas sem correspondência ({nomenclaturas.length})
          </p>
          <ul className="max-h-64 space-y-1 overflow-auto rounded-lg border p-3">
            {nomenclaturas.map((n: AnyRow, index: number) => (
              <li key={`${n.campo}-${n.valor}-${index}`} className="text-xs">
                <b>{n.campo}:</b> {n.valor} —{' '}
                {Number(n.linhas).toLocaleString('pt-BR')} linha(s), a partir da
                linha {n.primeiraLinha}
              </li>
            ))}
          </ul>
          {resumo.nomenclaturasOmitidas > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              e mais {resumo.nomenclaturasOmitidas} não exibida(s).
            </p>
          )}
        </div>
      )}
      {outros.length > 0 && (
        <div>
          <p className="mb-1 font-medium">Outros erros</p>
          <ul className="max-h-64 space-y-1 overflow-auto rounded-lg border p-3">
            {outros.map((e: AnyRow, index: number) => (
              <li key={`${e.linha}-${index}`} className="text-xs">
                <b>Linha {e.linha}:</b> {e.erro}
              </li>
            ))}
          </ul>
          {resumo.outrosErrosOmitidos > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              e mais {resumo.outrosErrosOmitidos} não exibido(s).
            </p>
          )}
        </div>
      )}
      {legado.length > 0 && (
        <div>
          <p className="mb-1 font-medium">Erros encontrados</p>
          <ul className="max-h-64 space-y-1 overflow-auto rounded-lg border p-3">
            {legado.map((e: AnyRow, index: number) => (
              <li key={`${e.row}-${index}`} className="text-xs">
                <b>Linha {e.row}:</b> {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
