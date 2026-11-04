'use client';
import { useEffect, useState } from 'react';
import { FileDown } from 'lucide-react';
import { LinhaDeAba } from './page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CampoData } from './campo-data';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api, baixarArquivo, errorText } from '@/lib/api';
import { Field, Loading } from './portal-presentation';

type Endereco = { logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; cep: string };
type Preparo = { template: boolean; erroTemplate: string; hoje: string };

// So o prazo se repete de um contrato para o outro: fica lembrado neste navegador.
const CHAVE_LOCAL = 'sv-contrato-prazo';
function lerPrazo() { try { return localStorage.getItem(CHAVE_LOCAL) || '45'; } catch { return '45'; } }
function gravarPrazo(prazo: string) { try { localStorage.setItem(CHAVE_LOCAL, prazo); } catch { /* opcional */ } }

const CAMPOS_FORNECEDOR: [string, string][] = [
  ['FORNECEDOR_RAZAO_SOCIAL', 'Razão social'], ['FORNECEDOR_CNPJ', 'CNPJ'],
];
// Endereco por partes, na ordem em que vai no contrato.
const PARTES: [keyof Endereco, string, string][] = [
  ['logradouro', 'Rua / avenida', 'md:col-span-4'], ['numero', 'Número', 'md:col-span-1'], ['complemento', 'Complemento (opcional)', 'md:col-span-1'],
  ['bairro', 'Bairro', 'md:col-span-2'], ['cidade', 'Cidade', 'md:col-span-2'], ['uf', 'UF', 'md:col-span-1'], ['cep', 'CEP', 'md:col-span-1'],
];
const VAZIO: Endereco = { logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', cep: '' };

// Os dados do fornecedor sao digitados: o contrato costuma ser feito antes do cadastro.
export function Contratos({ busy }: { busy: boolean }) {
  const [preparo, setPreparo] = useState<Preparo | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [endereco, setEndereco] = useState<Endereco>(VAZIO);
  const [prazo, setPrazo] = useState(lerPrazo);
  const [data, setData] = useState('');
  const [erro, setErro] = useState('');
  const [gerando, setGerando] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void api('/api/contratos', { signal: controller.signal }).then((dados: Preparo) => {
      if (controller.signal.aborted) return;
      setPreparo(dados);
      setData(atual => atual || dados.hoje);
    }).catch(falha => { if (!controller.signal.aborted) setErro(errorText(falha)); });
    return () => controller.abort();
  }, []);

  if (!preparo && !erro) return <Loading label="Carregando contratos…" compact />;

  const cepValido = endereco.cep.replace(/\D/g, '').length === 8;
  const faltando = !data || !CAMPOS_FORNECEDOR.every(([c]) => valores[c]?.trim()) || !/^\d+$/.test(prazo)
    || PARTES.some(([p]) => p !== 'complemento' && !endereco[p].trim()) || !cepValido;

  const gerar = async () => {
    setGerando(true); setErro('');
    try {
      gravarPrazo(prazo);
      await baixarArquivo('/api/contratos', undefined, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campos: valores, endereco, prazoDias: Number(prazo), data }),
      });
    } catch (falha) { setErro(errorText(falha)); } finally { setGerando(false); }
  };

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
      <Card><CardContent className="grid gap-4 pt-4 md:grid-cols-6">
        {CAMPOS_FORNECEDOR.map(([chave, rotulo]) => (
          <Field key={chave} label={rotulo} className="md:col-span-2">
            <Input value={valores[chave] || ''} maxLength={300} onChange={e => setValores(v => ({ ...v, [chave]: e.target.value }))} />
          </Field>
        ))}
        <Field label="Prazo de pagamento (dias)" className="md:col-span-1">
          <Input inputMode="numeric" value={prazo} onChange={e => setPrazo(e.target.value.replace(/\D/g, '').slice(0, 3))} />
        </Field>
        <Field label="Data da assinatura" className="md:col-span-1">
          <CampoData value={data} onChange={setData} />
        </Field>
        {PARTES.map(([parte, rotulo, coluna]) => (
          <Field key={parte} label={rotulo} className={coluna}>
            <Input value={endereco[parte]} maxLength={parte === 'uf' ? 2 : parte === 'cep' ? 9 : 120}
              inputMode={parte === 'cep' ? 'numeric' : undefined} aria-invalid={parte === 'cep' && !!endereco.cep && !cepValido}
              onChange={e => setEndereco(v => ({ ...v, [parte]: parte === 'uf' ? e.target.value.toUpperCase() : e.target.value }))} />
          </Field>
        ))}
      </CardContent></Card>
    </div>
  );
}
