'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileText, LoaderCircle, RefreshCw } from 'lucide-react';
import { api, errorText } from '@/lib/api';
import { iniciarAtualizacaoPeriodica } from '@/lib/atualizacao-periodica';
import {
  NOMES_ACAO,
  validarPedidoRelatorio,
  gerarChaveRelatorio,
  type AcaoRelatorio,
} from '@/lib/relatorios';
import { dataDeNegocio } from '@/lib/data-negocio';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Input } from './ui/input';
import { Badge } from './ui/badge';

type Job = {
  id: string;
  action: AcaoRelatorio;
  from: string | null;
  to: string | null;
  recipient: string | null;
  dryRun: number;
  status: string;
  createdAt: string;
  requestedBy: string;
  artifactsJson: string;
};
const statusName: Record<string, string> = {
  queued: 'Na fila',
  review: 'Revisão necessária',
  running: 'Executando',
  done: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};
type AcaoDisponivel = Extract<AcaoRelatorio, 'relatorio' | 'recorte'>;
const descricao: Record<AcaoDisponivel, string> = {
  relatorio:
    'Baixa o histórico de compras do Qlik, compara com os acordos vigentes e envia aos destinatários configurados. Conclui sem e-mail caso não haja dados elegíveis.',
  recorte:
    'Analisa um período com ambas as datas inclusas. O relatório será enviado apenas ao e-mail informado.',
};
const horario = (valor: string) =>
  new Date(valor).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export function Reports({ email }: { email: string }) {
  const [action, setAction] = useState<AcaoDisponivel>('relatorio');
  const [from, setFrom] = useState(dataDeNegocio()),
    [to, setTo] = useState(dataDeNegocio()),
    [recipient, setRecipient] = useState(email);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]),
    [online, setOnline] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null),
    [log, setLog] = useState(''),
    [loadError, setLoadError] = useState(''),
    [logError, setLogError] = useState('');
  const key = useRef<string | null>(null),
    sending = useRef(false),
    mounted = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    const data = await api('/api/reports', { signal });
    if (!mounted.current) return;
    setJobs(data.jobs);
    setOnline(data.runnerOnline);
    setLoaded(true);
    setLoadError('');
  }, []);
  useEffect(() => {
    mounted.current = true;
    const parar = iniciarAtualizacaoPeriodica(load, (e) => {
      setLoadError(errorText(e));
      setOnline(false);
    }, () => document.visibilityState !== 'hidden');
    return () => {
      mounted.current = false;
      parar();
    };
  }, [load]);
  const selectedStatus = jobs.find((job) => job.id === selected)?.status;
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const controller = new AbortController();
    const update = async (signal: AbortSignal) => {
      const data = await api(`/api/reports/${selected}`, { signal });
      if (active) { setLog(data.job.log); setLogError(''); }
    };
    const falhou = (e: unknown) => { if (active) setLogError(errorText(e)); };
    setLogError('');
    const parar = selectedStatus === 'queued' || selectedStatus === 'running'
      ? iniciarAtualizacaoPeriodica(update, falhou, () => document.visibilityState !== 'hidden')
      : (() => { void update(controller.signal).catch(falhou); return () => controller.abort(); })();
    return () => {
      active = false;
      parar();
    };
  }, [selected, selectedStatus]);
  const changed = () => {
    key.current = null;
    setNotice('');
  };
  const submit = async () => {
    if (sending.current) return;
    setError('');
    setNotice('');
    try {
      const pedido = validarPedidoRelatorio({
        action,
        from,
        to,
        recipient,
        requestKey: (key.current ??= gerarChaveRelatorio()),
      });
      const mensagem =
        action === 'recorte'
            ? `Gerar o recorte de ${from.split('-').reverse().join('/')} a ${to.split('-').reverse().join('/')} e enviar para ${recipient.trim()}?`
            : action === 'relatorio'
              ? 'Executar agora e enviar aos destinatários configurados quando houver divergências ou pendências?'
              : null;
      if (mensagem && !confirm(mensagem)) return;
      sending.current = true;
      setBusy(true);
      const result = await api('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pedido),
      });
      key.current = null;
      setSelected(result.id);
      setNotice(
        'Solicitação registrada. Você pode sair desta aba; a execução continua no servidor.',
      );
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const cancel = async (id: string) => {
    try {
      await api(`/api/reports/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const download = async (job: Job, name: string) => {
    try {
      const res = await fetch(
        `/api/reports/${job.id}/${encodeURIComponent(name)}`,
      );
      if (!res.ok) {
        if (res.status === 401)
          window.dispatchEvent(new Event('portal:session-expired'));
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error || 'Não foi possível baixar o arquivo.');
      }
      const url = URL.createObjectURL(await res.blob()),
        link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Relatórios</h1>
        <Badge variant={online ? 'default' : 'secondary'} title="Indica se o executor de relatórios respondeu nos últimos 30 segundos. Não valida a conexão com Qlik ou e-mail.">
          {loaded
            ? online
              ? 'Pronto para executar'
              : 'Executor indisponível'
            : 'Verificando serviço…'}
        </Badge>
      </div>
      {!online && loaded && !loadError && (
        <output className="block rounded-lg border p-3 text-sm">
          Inicie a operação na central Supply Vision para habilitar as execuções
          e os downloads.
        </output>
      )}
      {(error || loadError || logError) && (
        <p
          role="alert"
          className="rounded-lg border border-destructive p-3 text-sm text-destructive"
        >
          {error || loadError || logError}
        </p>
      )}
      {notice && (
        <output className="block rounded-lg border border-emerald-500 p-3 text-sm">
          {notice}
        </output>
      )}
      <Card>
        <CardContent className="space-y-4">
          <label className="block space-y-2 text-sm font-medium">
            Operação
            <select
              aria-label="Operação"
              value={action}
              disabled={busy}
              onChange={(e) => {
                setAction(e.target.value as AcaoDisponivel);
                changed();
              }}
              className="w-full rounded-md border bg-background px-3 py-2"
            >
              {(['relatorio', 'recorte'] as const).map((a) => (
                <option key={a} value={a}>
                  {NOMES_ACAO[a]}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-muted-foreground">{descricao[action]}</p>
          {action === 'recorte' && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label htmlFor="report-from" className="space-y-2 text-sm">
                  Data inicial
                  <Input
                    id="report-from"
                    type="date"
                    value={from}
                    max={dataDeNegocio()}
                    disabled={busy}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      changed();
                    }}
                  />
                </label>
                <label htmlFor="report-to" className="space-y-2 text-sm">
                  Data final
                  <Input
                    id="report-to"
                    type="date"
                    value={to}
                    min={from}
                    max={dataDeNegocio()}
                    disabled={busy}
                    onChange={(e) => {
                      setTo(e.target.value);
                      changed();
                    }}
                  />
                </label>
              </div>
              <label
                htmlFor="report-recipient"
                className="block space-y-2 text-sm"
              >
                E-mail destinatário
                <Input
                  id="report-recipient"
                  type="email"
                  value={recipient}
                  maxLength={254}
                  disabled={busy}
                  onChange={(e) => {
                    setRecipient(e.target.value);
                    changed();
                  }}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                A comparação usa os acordos disponíveis hoje e suas vigências.
              </p>
            </>
          )}
          <Button disabled={busy || !online} onClick={() => void submit()}>
            {busy ? <LoaderCircle className="animate-spin" /> : <FileText />}
            {busy ? 'Registrando…' : 'Solicitar execução'}
          </Button>
        </CardContent>
      </Card>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Últimas execuções</h2>
        <Button
          variant="outline"
          onClick={() => void load().catch((e) => setLoadError(errorText(e)))}
        >
          <RefreshCw />
          Atualizar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Uma execução por vez, com até cinco aguardando na fila. Sem dados
        elegíveis, nenhum relatório ou e-mail é gerado. Períodos longos podem
        levar mais tempo para processar.
      </p>
      {!jobs.length && (
        <p className="text-sm text-muted-foreground">
          Nenhuma execução solicitada pelo portal.
        </p>
      )}
      {jobs.map((job) => (
        <Card key={job.id}>
          <CardContent className="space-y-3 pt-5">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <p className="font-medium">
                  {NOMES_ACAO[job.action]}
                  {job.dryRun ? ' · simulação' : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {horario(job.createdAt)} · {job.requestedBy}
                </p>
                {job.recipient && (
                  <p className="mt-1 text-sm">
                    {job.from?.split('-').reverse().join('/')} a{' '}
                    {job.to?.split('-').reverse().join('/')} · {job.recipient}
                  </p>
                )}
              </div>
              <Badge
                variant={job.status === 'failed' ? 'destructive' : 'secondary'}
              >
                {statusName[job.status] || job.status}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLog('');
                  setSelected(selected === job.id ? null : job.id);
                }}
              >
                Ver registros
              </Button>
              {(job.status === 'queued' || job.status === 'review') && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void cancel(job.id)}
                >
                  Cancelar pedido
                </Button>
              )}
              {(job.status === 'review' || job.status === 'failed') &&
                (job.action === 'relatorio' || job.action === 'recorte') && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (job.action !== 'relatorio' && job.action !== 'recorte') return;
                    setAction(job.action);
                    setFrom(job.from || dataDeNegocio());
                    setTo(job.to || dataDeNegocio());
                    setRecipient(job.recipient || email);
                    key.current = null;
                    setNotice(
                      'Parâmetros copiados. Confira os registros e a entrega anterior antes de solicitar uma nova execução.',
                    );
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  Usar estes parâmetros
                </Button>
              )}
              {(JSON.parse(job.artifactsJson) as Array<{ name: string }>).map(
                (file) => (
                  <Button
                    key={file.name}
                    size="sm"
                    variant="outline"
                    disabled={!online}
                    onClick={() => void download(job, file.name)}
                  >
                    <Download />
                    {file.name}
                  </Button>
                ),
              )}
            </div>
            {selected === job.id && (
              <pre
                className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs"
                aria-label="Registros da execução"
              >
                {log || 'Aguardando o início da execução…'}
              </pre>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
