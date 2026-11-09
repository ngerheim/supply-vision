'use client';
import { useEffect, useRef, useState } from 'react';
import { Eraser, Printer } from 'lucide-react';
import { LinhaDeAba } from './page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CampoData } from './campo-data';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api, errorText } from '@/lib/api';
import type { ContratoLeitura } from '@/lib/contratos';
import { Field, Loading } from './portal-presentation';

type Endereco = { logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; cep: string };
type Preparo = { template: boolean; erroTemplate: string; hoje: string; semRepresentante?: boolean };
type Socio = { nome: string; qualificacao: string };
type Consulta = { razaoSocial: string; situacao: string; socios: Socio[]; endereco: Endereco };

// So o prazo se repete de um contrato para o outro: fica lembrado neste navegador.
const CHAVE_LOCAL = 'sv-contrato-prazo';
function lerPrazo() { try { return localStorage.getItem(CHAVE_LOCAL) || '45'; } catch { return '45'; } }
function gravarPrazo(prazo: string) { try { localStorage.setItem(CHAVE_LOCAL, prazo); } catch { /* opcional */ } }

// Endereco por partes, na ordem em que vai no contrato.
const PARTES: [keyof Endereco, string, string][] = [
  ['logradouro', 'Rua / avenida', 'md:col-span-4'], ['numero', 'Número', 'md:col-span-1'], ['complemento', 'Complemento (opcional)', 'md:col-span-1'],
  ['bairro', 'Bairro', 'md:col-span-2'], ['cidade', 'Cidade', 'md:col-span-2'], ['uf', 'UF', 'md:col-span-1'], ['cep', 'CEP', 'md:col-span-1'],
];
const VAZIO: Endereco = { logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', cep: '' };
const formatarCnpj = (d: string) => `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
const cepFormatado = (cep: string) => { const d = cep.replace(/\D/g, ''); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : cep; };

// O CNPJ consulta a Receita e preenche razao social e endereco; o responsavel
// legal e digitado (os socios do CNPJ aparecem como sugestao). Tudo segue editavel.
export function Contratos({ busy }: { busy: boolean }) {
  const [preparo, setPreparo] = useState<Preparo | null>(null);
  const [cnpj, setCnpj] = useState('');
  const [razao, setRazao] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [endereco, setEndereco] = useState<Endereco>(VAZIO);
  const [prazo, setPrazo] = useState(lerPrazo);
  const [data, setData] = useState('');
  const [consulta, setConsulta] = useState<{ situacao: string; socios: Socio[] } | null>(null);
  const [consultando, setConsultando] = useState(false);
  const [avisoConsulta, setAvisoConsulta] = useState('');
  const [erro, setErro] = useState('');
  const [gerando, setGerando] = useState(false);
  const [contrato, setContrato] = useState<(ContratoLeitura & { arquivo: string }) | null>(null);
  const sequencia = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    void api('/api/contratos', { signal: controller.signal }).then((dados: Preparo) => {
      if (controller.signal.aborted) return;
      setPreparo(dados);
      setData(atual => atual || dados.hoje);
    }).catch(falha => { if (!controller.signal.aborted) setErro(errorText(falha)); });
    return () => controller.abort();
  }, []);

  // A folha so existe para a impressao: monta, imprime e o titulo da aba vira o nome do PDF.
  useEffect(() => {
    if (!contrato) return;
    const titulo = document.title;
    const voltar = () => { document.title = titulo; };
    document.title = contrato.arquivo;
    window.addEventListener('afterprint', voltar, { once: true });
    // Um instante para o navegador desenhar a folha (e o logo) antes de abrir a impressao.
    const espera = setTimeout(() => window.print(), 100);
    return () => { clearTimeout(espera); window.removeEventListener('afterprint', voltar); voltar(); };
  }, [contrato]);

  if (!preparo && !erro) return <Loading label="Carregando contratos…" compact />;

  const consultar = async (numero: string) => {
    const atual = ++sequencia.current;
    setConsultando(true); setAvisoConsulta(''); setConsulta(null);
    try {
      const x: Consulta = await api(`/api/contratos/cnpj/${numero}`);
      if (atual !== sequencia.current) return;
      setCnpj(formatarCnpj(numero));
      setRazao(x.razaoSocial);
      setEndereco({ ...x.endereco, cep: cepFormatado(x.endereco.cep) });
      setConsulta({ situacao: x.situacao, socios: x.socios });
      // Com um unico socio, ele e a sugestao natural; com varios, a pessoa escolhe.
      if (x.socios.length === 1) setResponsavel(atual => atual || x.socios[0].nome);
    } catch (falha) {
      if (atual === sequencia.current) setAvisoConsulta(`${errorText(falha)} Preencha os dados manualmente.`);
    } finally { if (atual === sequencia.current) setConsultando(false); }
  };
  const mudarCnpj = (valor: string) => {
    setCnpj(valor);
    const numero = valor.replace(/\D/g, '');
    if (numero.length === 14) void consultar(numero);
    else { sequencia.current++; setConsultando(false); }
  };
  const limpar = () => {
    sequencia.current++;
    setCnpj(''); setRazao(''); setResponsavel(''); setEndereco(VAZIO); setConsulta(null); setConsultando(false);
    setAvisoConsulta(''); setErro(''); setContrato(null); setData(preparo?.hoje ?? '');
  };

  const cepValido = endereco.cep.replace(/\D/g, '').length === 8;
  const faltando = !data || !cnpj.trim() || !razao.trim() || !responsavel.trim() || !/^\d+$/.test(prazo)
    || PARTES.some(([p]) => p !== 'complemento' && !endereco[p].trim()) || !cepValido;

  const gerar = async () => {
    setGerando(true); setErro(''); setContrato(null);
    try {
      gravarPrazo(prazo);
      setContrato(await api('/api/contratos', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campos: { FORNECEDOR_RAZAO_SOCIAL: razao, FORNECEDOR_CNPJ: cnpj, FORNECEDOR_REPRESENTANTE: responsavel }, endereco, prazoDias: Number(prazo), data }),
      }));
    } catch (falha) { setErro(errorText(falha)); } finally { setGerando(false); }
  };

  return (
    <div className="patio-page space-y-4">
      <div className="no-print space-y-4">
        <LinhaDeAba actions={<>
          <Button variant="outline" disabled={gerando} onClick={limpar}><Eraser /> Limpar</Button>
          <Button variant="create" disabled={busy || gerando || consultando || faltando || !preparo?.template} onClick={() => void gerar()}>
            <Printer /> {gerando ? 'Gerando…' : 'Imprimir / PDF'}
          </Button>
        </>} />
        {preparo && !preparo.template && (
          <Alert variant="destructive"><AlertDescription>
            {preparo.erroTemplate || 'Template não encontrado. Coloque o arquivo contrato-fornecimento.docx na pasta privada do Portal, em portal\\contratos.'}
          </AlertDescription></Alert>
        )}
        {preparo?.template && preparo.semRepresentante && (
          <Alert><AlertDescription>O template não tem o campo {'{{FORNECEDOR_REPRESENTANTE}}'}: o responsável legal não aparece no contrato.</AlertDescription></Alert>
        )}
        {consulta && consulta.situacao !== 'ATIVA' && (
          <Alert variant="destructive"><AlertDescription>Situação na Receita: {consulta.situacao}.</AlertDescription></Alert>
        )}
        {avisoConsulta && <Alert><AlertDescription>{avisoConsulta}</AlertDescription></Alert>}
        {erro && <Alert variant="destructive"><AlertDescription>{erro}</AlertDescription></Alert>}
        <Card><CardContent className="grid gap-4 pt-4 md:grid-cols-6">
          <Field label={consultando ? 'CNPJ · consultando…' : 'CNPJ'} className="md:col-span-1">
            <Input value={cnpj} maxLength={18} inputMode="numeric" onChange={e => mudarCnpj(e.target.value)} />
          </Field>
          <Field label="Razão social" className="md:col-span-2">
            <Input value={razao} maxLength={300} onChange={e => setRazao(e.target.value)} />
          </Field>
          <Field label="Responsável legal" className="md:col-span-1">
            <Input value={responsavel} maxLength={300} list="contrato-socios" onChange={e => setResponsavel(e.target.value)} />
            <datalist id="contrato-socios">
              {consulta?.socios.map(s => <option key={s.nome} value={s.nome}>{s.qualificacao}</option>)}
            </datalist>
          </Field>
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
      {contrato && <FolhaContrato contrato={contrato} />}
    </div>
  );
}

// Folha A4 do contrato. Cabecalho e rodape ficam fixos (repetem em toda pagina);
// o thead/tfoot da tabela reserva o espaco deles em cada pagina impressa.
function FolhaContrato({ contrato }: { contrato: ContratoLeitura }) {
  return (
    <section className="so-impressao contrato-papel">
      {/* oxlint-disable-next-line next/no-img-element */}
      {contrato.logo && <div className="contrato-cabecalho"><img src={contrato.logo} alt="" /></div>}
      {contrato.rodape.length > 0 && <div className="contrato-rodape">{contrato.rodape.map((linha, n) => <p key={n}>{linha}</p>)}</div>}
      <table className="contrato-folha" role="presentation"><thead><tr><td aria-hidden="true"><div className="contrato-reserva-topo" /></td></tr></thead>
        <tfoot><tr><td aria-hidden="true"><div className="contrato-reserva-base" /></td></tr></tfoot>
        <tbody><tr><td>
        {contrato.paragrafos.map((p, n) => {
          const Tag = p.tipo === 'clausula' ? 'h2' : 'p';
          return (
            <Tag key={n} className={`contrato-${p.tipo}${p.centro ? ' contrato-centro' : ''}`}>
              {p.trechos.length ? p.trechos.map((t, i) => (
                <span key={i} style={{ fontWeight: t.negrito ? 700 : undefined, fontStyle: t.italico ? 'italic' : undefined,
                  textDecoration: t.sublinhado ? 'underline' : undefined, fontSize: t.tamanhoPt ? `${t.tamanhoPt}pt` : undefined }}>{t.texto}</span>
              )) : ' '}
            </Tag>
          );
        })}
        </td></tr></tbody></table>
    </section>
  );
}
