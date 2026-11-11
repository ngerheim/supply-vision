'use client';
import { useEffect, useState } from 'react';
import { LoaderCircle, Merge } from 'lucide-react';
import { api, errorText } from '@/lib/api';
import { SearchSelect } from '@/components/search-select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type AnyRow = Record<string, ReturnType<typeof JSON.parse>>;
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const rs = (v: unknown) => (v === null || v === undefined ? '—' : moeda.format(Number(v)));
const TIPO: Record<string, string> = { so_neste: 'Só neste acordo', so_no_outro: 'Só no outro acordo', preco: 'Preço diferente', marcas: 'Marcas diferentes' };

// Unir um acordo duplicado (outro CNPJ do mesmo fornecedor) a este: compara as
// condicoes vigentes; preco ou marcas diferentes pedem a escolha de qual vale,
// linha a linha ou para todas. Primeiro so compara; unir e a confirmacao.
export function UnirAcordosDialog({ acordo, busy, run, onClose }: { acordo: AnyRow; revision?: unknown; busy: boolean; run: (fn: () => Promise<AnyRow>, ok?: string) => Promise<unknown>; onClose: () => void }) {
  const [acordos, setAcordos] = useState<AnyRow[] | null>(null);
  const [outroId, setOutroId] = useState('');
  const [previa, setPrevia] = useState<AnyRow | null>(null);
  const [erro, setErro] = useState('');
  const [comparando, setComparando] = useState(false);
  // Escolha por linha (chave da condicao) e escolha geral ('*').
  const [escolhas, setEscolhas] = useState<Record<string, 'neste' | 'outro'>>({});
  const escolhiveis = (previa?.diferencas || []).filter((d: AnyRow) => d.tipo === 'preco' || d.tipo === 'marcas');
  const escolhaDe = (chave: string) => escolhas[chave] ?? escolhas['*'];
  const pendentes = escolhiveis.filter((d: AnyRow) => !escolhaDe(d.chave)).length
    + (previa && previa.totalDiferencas > previa.diferencas.length && !escolhas['*'] ? 1 : 0);
  const geral = (lado: 'neste' | 'outro') => setEscolhas({ '*': lado });

  useEffect(() => {
    const controller = new AbortController();
    void api('/api/agreements', { signal: controller.signal })
      .then((r: AnyRow) => { if (!controller.signal.aborted) setAcordos(r.agreements || []); })
      .catch((e) => { if (!controller.signal.aborted) setErro(errorText(e)); });
    return () => controller.abort();
  }, []);

  const pedir = (confirmar: boolean) => api(`/api/agreements/${acordo.id}/unir`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ outroId, expectedRevision: acordo.revision, outroRevision: previa?.outro?.revision, confirmar, ...(confirmar ? { escolhas } : {}) }),
  });
  const comparar = async () => {
    setComparando(true); setErro(''); setPrevia(null); setEscolhas({});
    try { setPrevia(await pedir(false)); } catch (e) { setErro(errorText(e)); } finally { setComparando(false); }
  };
  const unir = () => void run(async () => { const r = await pedir(true); onClose(); return r; }, 'Acordos unidos.');

  const opcoes = (acordos || []).filter((a) => a.id !== acordo.id && a.status === 'active')
    .map((a) => ({ id: a.id, name: `${a.number} · ${a.supplier} · ${a.cnpj}` }));
  return (
    <Dialog open onOpenChange={(aberto) => !aberto && !busy && onClose()}>
      <DialogContent showCloseButton={!busy} className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader><DialogTitle>Unir com outro acordo</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Os CNPJs do outro acordo passam para o acordo {acordo.number}, com as cidades que atendiam, e ele fica suspenso, com o histórico guardado. Onde o preço ou as marcas forem diferentes, escolha qual vale; condições que só existem no outro entram neste.
          </p>
          {!acordos && !erro && <p className="text-sm text-muted-foreground">Carregando acordos…</p>}
          {acordos && <SearchSelect label="Acordo a unir" value={outroId} limit={80} options={opcoes} onChange={(v) => { setOutroId(v); setPrevia(null); setEscolhas({}); }} />}
          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
          {previa && (
            <div className="space-y-3">
              {previa.cnpjsQueEntram?.length > 0 && (
                <div>
                  <p className="text-sm font-medium">CNPJs que entram neste acordo</p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {previa.cnpjsQueEntram.map((c: AnyRow) => (
                      <li key={c.cnpj}>{c.supplier} · {c.cnpj} — {c.todasCidades ? 'todas as cidades' : c.cidades.join(', ')}</li>
                    ))}
                  </ul>
                </div>
              )}
              {previa.motivo && <p role="alert" className="text-sm text-destructive">{previa.motivo}</p>}
              {previa.totalDiferencas > 0 && (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{previa.totalDiferencas} {previa.totalDiferencas === 1 ? 'diferença' : 'diferenças'}{previa.totalDiferencas > previa.diferencas.length ? ` (mostrando ${previa.diferencas.length}; as demais seguem a escolha geral)` : ''}</p>
                    {(escolhiveis.length > 0 || previa.totalDiferencas > previa.diferencas.length) && (
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant={escolhas['*'] === 'neste' ? 'default' : 'outline'} disabled={busy} onClick={() => geral('neste')}>Manter tudo deste</Button>
                        <Button type="button" size="sm" variant={escolhas['*'] === 'outro' ? 'default' : 'outline'} disabled={busy} onClick={() => geral('outro')}>Usar tudo do outro</Button>
                      </div>
                    )}
                  </div>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Diferença</TableHead><TableHead>Item</TableHead><TableHead>Modelo</TableHead><TableHead>Cidade</TableHead>
                      <TableHead className="text-right">Neste</TableHead><TableHead className="text-right">No outro</TableHead><TableHead>Vale</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {previa.diferencas.map((d: AnyRow, n: number) => (
                        <TableRow key={n}>
                          <TableCell>{TIPO[d.tipo] || d.tipo}</TableCell>
                          <TableCell>{d.item}</TableCell>
                          <TableCell>{d.model}</TableCell>
                          <TableCell className="whitespace-nowrap">{d.city} / {d.state}</TableCell>
                          <TableCell className="whitespace-nowrap text-right">{d.tipo === 'marcas' ? d.marcasNeste || 'Livre' : rs(d.precoNeste)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right">{d.tipo === 'marcas' ? d.marcasNoOutro || 'Livre' : rs(d.precoNoOutro)}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {d.tipo === 'preco' || d.tipo === 'marcas' ? (
                              <fieldset aria-label={`Valor que prevalece: ${d.item} ${d.model}`} className="flex gap-1 border-0 p-0">
                                {(['neste', 'outro'] as const).map((lado) => (
                                  <Button key={lado} type="button" size="sm" aria-pressed={escolhaDe(d.chave) === lado}
                                    variant={escolhaDe(d.chave) === lado ? 'default' : 'outline'} disabled={busy}
                                    onClick={() => setEscolhas((e) => ({ ...e, [d.chave]: lado }))}>
                                    {lado === 'neste' ? 'Deste' : 'Do outro'}
                                  </Button>
                                ))}
                              </fieldset>
                            ) : d.tipo === 'so_no_outro' ? (d.foraDaAbrangencia ? 'Cidade fora deste acordo' : 'Entra') : 'Continua'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="mt-5">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button>
          {previa?.podeUnir
            ? <Button disabled={busy || pendentes > 0} title={pendentes > 0 ? 'Escolha qual valor vale em cada diferença' : undefined} onClick={unir}><Merge /> Unir acordos</Button>
            : <Button disabled={busy || comparando || !outroId} onClick={() => void comparar()}>{comparando ? <LoaderCircle className="animate-spin" /> : null} Comparar</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
