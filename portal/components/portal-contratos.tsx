'use client';
import { useEffect, useMemo, useState } from 'react';
import { FileDown } from 'lucide-react';
import { LinhaDeAba } from './page-header';
import { SearchSelect } from './search-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api, baixarArquivo, errorText } from '@/lib/api';
import { type AnyRow, Field, Loading } from './portal-presentation';

type Preparo = {
  template: boolean; erroTemplate: string; hoje: string;
  acordo?: { id: string; numero: string; razaoSocial: string; fantasia: string; cnpj: string; endereco: string; itens: number };
};

// Dados da contratante que se repetem de um contrato para o outro ficam
// lembrados neste navegador; dados do fornecedor vem do cadastro.
const LEMBRAR = ['CIDADE_ASSINATURA', 'CONTRATANTE_REPRESENTANTE', 'TESTEMUNHA_1', 'TESTEMUNHA_2', 'TESTEMUNHA_3', 'PRAZO'] as const;
const CHAVE_LOCAL = 'sv-contrato-padroes';
function lerPadroes(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(CHAVE_LOCAL) || '{}'); } catch { return {}; }
}
function gravarPadroes(valores: Record<string, string>) {
  try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(Object.fromEntries(LEMBRAR.map(c => [c, valores[c] || ''])))); } catch { /* opcional */ }
}

const CAMPOS_FORNECEDOR: [string, string][] = [
  ['FORNECEDOR_RAZAO_SOCIAL', 'Razão social'], ['FORNECEDOR_CNPJ', 'CNPJ'],
  ['FORNECEDOR_ENDERECO', 'Endereço completo'], ['FORNECEDOR_REPRESENTANTE', 'Representante do fornecedor'],
];
const CAMPOS_CONTRATANTE: [string, string][] = [
  ['CONTRATANTE_REPRESENTANTE', 'Representante da contratante'], ['CIDADE_ASSINATURA', 'Cidade da assinatura'],
  ['TESTEMUNHA_1', 'Testemunha 1'], ['TESTEMUNHA_2', 'Testemunha 2'], ['TESTEMUNHA_3', 'Testemunha 3'],
];

export function Contratos({ acordos, busy }: { acordos: AnyRow[]; busy: boolean }) {
  const [acordoId, setAcordoId] = useState('');
  const [preparo, setPreparo] = useState<Preparo | null>(null);
  const [valores, setValores] = useState<Record<string, string>>(() => ({ PRAZO: '45', ...lerPadroes() }));
  const [data, setData] = useState('');
  const [erro, setErro] = useState('');
  const [gerando, setGerando] = useState(false);

  const opcoes = useMemo(() => acordos.map(a => ({ id: String(a.id), name: `${a.number} · ${a.supplier}` })), [acordos]);

  useEffect(() => {
    const controller = new AbortController();
    const url = acordoId ? `/api/contratos?acordo=${encodeURIComponent(acordoId)}` : '/api/contratos';
    void api(url, { signal: controller.signal }).then((dados: Preparo) => {
      if (controller.signal.aborted) return;
      setPreparo(dados);
      setData(atual => atual || dados.hoje);
      setErro('');
      const a = dados.acordo;
      if (a) setValores(atual => ({ ...atual, FORNECEDOR_RAZAO_SOCIAL: a.razaoSocial, FORNECEDOR_CNPJ: a.cnpj, FORNECEDOR_ENDERECO: a.endereco, FORNECEDOR_REPRESENTANTE: '' }));
    }).catch(falha => { if (!controller.signal.aborted) setErro(errorText(falha)); });
    return () => controller.abort();
  }, [acordoId]);

  if (!preparo && !erro) return <Loading label="Carregando contratos…" compact />;

  const alterar = (campo: string, valor: string) => setValores(atual => ({ ...atual, [campo]: valor }));
  const faltando = !acordoId || !data || ![...CAMPOS_FORNECEDOR, ...CAMPOS_CONTRATANTE].every(([c]) => valores[c]?.trim()) || !/^\d+$/.test(valores.PRAZO || '');

  const gerar = async () => {
    setGerando(true); setErro('');
    try {
      gravarPadroes(valores);
      const campos = Object.fromEntries([...CAMPOS_FORNECEDOR, ...CAMPOS_CONTRATANTE].map(([c]) => [c, valores[c]]));
      await baixarArquivo('/api/contratos', undefined, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acordoId, campos, prazoDias: Number(valores.PRAZO), data }),
      });
    } catch (falha) { setErro(errorText(falha)); } finally { setGerando(false); }
  };

  const campo = ([chave, rotulo]: [string, string]) => (
    <Field key={chave} label={rotulo}>
      <Input value={valores[chave] || ''} maxLength={300} onChange={e => alterar(chave, e.target.value)} />
    </Field>
  );

  return (
    <div className="patio-page space-y-4">
      <LinhaDeAba actions={
        <Button variant="create" disabled={busy || gerando || faltando || !preparo?.template} onClick={() => void gerar()}>
          <FileDown /> {gerando ? 'Gerando…' : 'Gerar contrato (.docx)'}
        </Button>
      } />
      {preparo && !preparo.template && (
        <Alert variant="destructive"><AlertDescription>
          {preparo.erroTemplate || 'Template não encontrado. Coloque o arquivo contrato-fornecimento.docx na pasta privada do Portal, em portal\\contratos.'}
        </AlertDescription></Alert>
      )}
      {erro && <Alert variant="destructive"><AlertDescription>{erro}</AlertDescription></Alert>}
      <Card><CardContent className="grid gap-4 pt-4 md:grid-cols-[2fr_1fr_1fr]">
        <SearchSelect label="Acordo" value={acordoId} onChange={setAcordoId} options={opcoes} />
        <Field label="Prazo de pagamento (dias)">
          <Input inputMode="numeric" value={valores.PRAZO || ''} onChange={e => alterar('PRAZO', e.target.value.replace(/\D/g, '').slice(0, 3))} />
        </Field>
        <Field label="Data da assinatura">
          <Input type="date" value={data} onChange={e => setData(e.target.value)} />
        </Field>
        {preparo?.acordo && (
          <p className="text-sm text-muted-foreground md:col-span-3">
            Anexo I: {preparo.acordo.itens} {preparo.acordo.itens === 1 ? 'item' : 'itens'} da versão vigente de {preparo.acordo.numero}.
          </p>
        )}
      </CardContent></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardContent className="space-y-3 pt-4">
          <h2 className="text-sm font-semibold">Fornecedor</h2>
          {CAMPOS_FORNECEDOR.map(campo)}
        </CardContent></Card>
        <Card><CardContent className="space-y-3 pt-4">
          <h2 className="text-sm font-semibold">Contratante</h2>
          {CAMPOS_CONTRATANTE.map(campo)}
        </CardContent></Card>
      </div>
    </div>
  );
}
