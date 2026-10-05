'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileText, LoaderCircle, RefreshCw } from 'lucide-react';
import { api, errorText } from '@/lib/api';
import {
  ACOES_RELATORIO,
  NOMES_ACAO,
  validarPedidoRelatorio,
  type AcaoRelatorio,
} from '@/lib/relatorios';
import { dataDeNegocio } from '@/lib/data-negocio';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Checkbox } from './ui/checkbox';
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
const descricao: Record<AcaoRelatorio, string> = {
  relatorio:
    'Baixa as compras do Qlik, compara com os acordos e envia aos destinatários configurados. Sem divergências ou pendências, conclui sem e-mail.',
  paralelo:
    'Executa a mesma análise e salva uma prévia do e-mail. Nenhuma mensagem é enviada.',
  debug:
    'Executa o relatório diário, incluindo o envio, e permite acompanhar os registros. Equivale ao diagnóstico do executar.bat.',
  recorte:
    'Analisa um período com ambas as datas incluídas. O relatório será enviado apenas ao e-mail informado, sem usar a lista diária nem sua cópia oculta.',
  limpeza:
    'Apaga planilhas e CSV com mais de 24 horas e logs com mais de cinco dias, conforme a data de geração no nome. Use a simulação para conferir antes de apagar.',
};
const horario = (valor: string) =>
  new Date(valor).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export function Reports({ email }: { email: string }) {
  const [action, setAction] = useState<AcaoRelatorio>('paralelo');
  const [from, setFrom] = useState(dataDeNegocio()),
    [to, setTo] = useState(dataDeNegocio()),
    [recipient, setRecipient] = useState(email);
  const [dryRun, setDryRun] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]),
    [online, setOnline] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null),
    [log, setLog] = useState('');
  const key = useRef<string | null>(null),
    sending = useRef(false),
    mounted = useRef(false);
  const load = useCallback(async () => {
    const data = await api('/api/reports');
    if (!mounted.current) return;
    setJobs(data.jobs);
    setOnline(data.runnerOnline);
    setLoaded(true);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const update = () =>
      void load().catch((e) => {
        if (mounted.current) setError(errorText(e));
      });
    update();
    const timer = setInterval(update, 5000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [load]);
  const selectedStatus = jobs.find((job) => job.id === selected)?.status;
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const update = () =>
      void api(`/api/reports/${selected}`)
        .then((data) => {
          if (active) setLog(data.job.log);
        })
        .catch((e) => {
          if (active) setError(errorText(e));
        });
    update();
    const timer =
      selectedStatus === 'queued' || selectedStatus === 'running'
        ? setInterval(update, 5000)
        : null;
    return () => {
      active = false;
      if (timer) clearInterval(timer);
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
        dryRun,
        requestKey: (key.current ??= crypto.randomUUID()),
      });
      const mensagem =
        action === 'limpeza' && !dryRun
          ? 'Apagar os arquivos vencidos pela retenção (planilhas e CSV após 24 horas, logs após cinco dias)? Esta ação não move arquivos para uma lixeira.'
          : action === 'recorte'
            ? `Gerar o recorte de ${from.split('-').reverse().join('/')} a ${to.split('-').reverse().join('/')} e enviar para ${recipient.trim()}?`
            : action === 'relatorio' || action === 'debug'
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
        <div>
          <h1 className="text-2xl font-semibold">Relatórios e rotinas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Execute as funções dos Alertas e acompanhe o resultado.
          </p>
        </div>
        <Badge variant={online ? 'default' : 'secondary'}>
          {loaded
            ? online
              ? 'Serviço disponível'
              : 'Serviço indisponível'
            : 'Verificando serviço…'}
        </Badge>
      </div>
      {!online && loaded && (
        <output className="block rounded-lg border p-3 text-sm">
          Inicie a operação na central Supply Vision para habilitar as execuções
          e os downloads.
        </output>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {notice && (
        <output className="block rounded-lg border border-emerald-500 p-3 text-sm">
          {notice}
        </output>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Nova execução</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-2 text-sm font-medium">
            Operação
            <select
              aria-label="Operação"
              value={action}
              disabled={busy}
              onChange={(e) => {
                setAction(e.target.value as AcaoRelatorio);
                changed();
              }}
              className="w-full rounded-md border bg-background px-3 py-2"
            >
              {ACOES_RELATORIO.map((a) => (
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
                Sem dados elegíveis, nenhum arquivo ou e-mail será gerado.
                Períodos longos podem levar vários minutos.
              </p>
            </>
          )}
          {action === 'limpeza' && (
            <label
              htmlFor="report-dry-run"
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id="report-dry-run"
                checked={dryRun}
                disabled={busy}
                onCheckedChange={(v) => {
                  setDryRun(v === true);
                  changed();
                }}
              />
              Simular e listar os arquivos, sem apagá-los
            </label>
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
          onClick={() => void load().catch((e) => setError(errorText(e)))}
        >
          <RefreshCw />
          Atualizar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Até cinco pedidos na fila. As rotinas são executadas uma por vez; se uma
        rotina automática já estiver usando os arquivos, a execução informa o
        conflito. Falhas não são reenviadas automaticamente.
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
              {(job.status === 'review' || job.status === 'failed') && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setAction(job.action);
                    setFrom(job.from || dataDeNegocio());
                    setTo(job.to || dataDeNegocio());
                    setRecipient(job.recipient || email);
                    setDryRun(!!job.dryRun);
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
