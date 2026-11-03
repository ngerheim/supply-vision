import * as XLSX from 'xlsx';
import { isIsoDate } from './domain.ts';

// Preenche o template .docx do contrato de fornecimento. O template fica na
// pasta privada (nunca no Git): campos no formato {{NOME}}, cada um inteiro
// dentro de um unico trecho de texto do Word. Os dados do fornecedor sao
// digitados na tela; a tabela de valores segue a parte, fora do Portal.

// Os dados da contratante (cidade, representante) sao sempre os mesmos e ficam
// escritos direto no template. A assinatura e digital: o template nao tem bloco
// de assinaturas nem representante do fornecedor.
export const CAMPOS_CONTRATO = [
  'FORNECEDOR_RAZAO_SOCIAL', 'FORNECEDOR_ENDERECO', 'FORNECEDOR_CNPJ',
  'PRAZO_PAGAMENTO_DIAS', 'PRAZO_PAGAMENTO_EXTENSO', 'DATA_ASSINATURA',
] as const;
// Campos de versoes anteriores do template, que o Portal nao preenche mais.
export const CAMPOS_FIXOS_ANTIGOS = ['CIDADE_ASSINATURA', 'CONTRATANTE_REPRESENTANTE', 'TESTEMUNHA_1', 'TESTEMUNHA_2', 'TESTEMUNHA_3', 'FORNECEDOR_REPRESENTANTE'] as const;

export const PARTES_ENDERECO = ['logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep'] as const;
export type EnderecoContrato = Record<(typeof PARTES_ENDERECO)[number], string>;
// "Rua X, 123, Sala 4, Bairro Y, Cidade/UF, CEP 00000-000".
export function montarEndereco(e: EnderecoContrato): string {
  const cep = e.cep.replace(/\D/g, '');
  return [e.logradouro, e.numero, e.complemento, e.bairro, `${e.cidade}/${e.uf.toUpperCase()}`, `CEP ${cep.slice(0, 5)}-${cep.slice(5)}`]
    .map(p => p.trim()).filter(Boolean).join(', ');
}
export type CampoContrato = (typeof CAMPOS_CONTRATO)[number];

export class TemplateInvalido extends Error {}

// Tipos minimos do container ZIP do SheetJS (XLSX.CFB nao traz tipos).
type EntradaZip = { content?: Uint8Array; size?: number };
type ContainerZip = { FullPaths: string[]; FileIndex: EntradaZip[] };

const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
  'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

// Numero por extenso de 1 a 999, suficiente para prazos em dias.
export function numeroPorExtenso(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999) throw new RangeError('Número fora do intervalo 1–999.');
  if (n === 100) return 'cem';
  const partes: string[] = [];
  const c = Math.floor(n / 100), resto = n % 100;
  if (c) partes.push(CENTENAS[c]);
  if (resto < 20) { if (resto) partes.push(UNIDADES[resto]); }
  else partes.push([DEZENAS[Math.floor(resto / 10)], UNIDADES[resto % 10]].filter(Boolean).join(' e '));
  return partes.join(' e ');
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// Data civil AAAA-MM-DD → "30 de outubro de 2026".
export function dataPorExtenso(data: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  if (!m || !isIsoDate(data)) throw new RangeError('Data inválida.');
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

export function formatarCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '').padStart(14, '0');
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

const xml = (texto: string) => texto
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function lerEntrada(zip: ContainerZip, caminho: string) {
  const indice = zip.FullPaths.findIndex((p: string) => p.endsWith(`/${caminho}`));
  return indice < 0 ? null : zip.FileIndex[indice];
}

export function camposDoTemplate(template: Uint8Array): string[] {
  let zip: ContainerZip;
  try { zip = XLSX.CFB.read(template, { type: 'buffer' }) as ContainerZip; }
  catch { throw new TemplateInvalido('O template não é um documento do Word válido.'); }
  const doc = lerEntrada(zip, 'word/document.xml');
  if (!doc?.content) throw new TemplateInvalido('O template não é um documento do Word válido.');
  const texto = Buffer.from(doc.content).toString('utf8');
  return [...new Set([...texto.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map(m => m[1]))];
}

export function gerarContrato(template: Uint8Array, campos: Record<CampoContrato, string>): Uint8Array {
  let zip: ContainerZip;
  try { zip = XLSX.CFB.read(template, { type: 'buffer' }) as ContainerZip; }
  catch { throw new TemplateInvalido('O template não é um documento do Word válido.'); }
  const doc = lerEntrada(zip, 'word/document.xml');
  if (!doc?.content) throw new TemplateInvalido('O template não é um documento do Word válido.');
  let texto = Buffer.from(doc.content).toString('utf8');
  texto = texto.replace(/\{\{([A-Z0-9_]+)\}\}/g, (inteiro, nome: string) =>
    Object.hasOwn(campos, nome) ? xml(campos[nome as CampoContrato]) : inteiro);
  const restantes = [...texto.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map(m => m[1]);
  if (restantes.length) throw new TemplateInvalido(`O template tem campos desconhecidos: ${[...new Set(restantes)].join(', ')}.`);
  doc.content = Buffer.from(texto, 'utf8');
  doc.size = doc.content.length;
  return XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip', compression: true }) as Uint8Array;
}
