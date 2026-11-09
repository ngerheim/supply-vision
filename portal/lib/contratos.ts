import * as XLSX from 'xlsx';
import { isIsoDate } from './domain.ts';

// Preenche o template .docx do contrato de fornecimento e devolve o texto para
// a folha impressa do Portal (o PDF sai pelo "Salvar como PDF" do navegador).
// O template fica na pasta privada (nunca no Git): campos no formato {{NOME}},
// cada um inteiro dentro de um unico trecho de texto do Word. Os dados do
// fornecedor vem da consulta do CNPJ e podem ser corrigidos na tela; a tabela
// de valores segue a parte, fora do Portal.

// Os dados da contratante (cidade, representante) sao sempre os mesmos e ficam
// escritos direto no template. A assinatura e digital: nao ha bloco de assinaturas.
export const CAMPOS_CONTRATO = [
  'FORNECEDOR_RAZAO_SOCIAL', 'FORNECEDOR_ENDERECO', 'FORNECEDOR_CNPJ', 'FORNECEDOR_REPRESENTANTE',
  'PRAZO_PAGAMENTO_DIAS', 'PRAZO_PAGAMENTO_EXTENSO', 'DATA_ASSINATURA',
] as const;
// Campos de versoes anteriores do template, que o Portal nao preenche mais.
export const CAMPOS_FIXOS_ANTIGOS = ['CIDADE_ASSINATURA', 'CONTRATANTE_REPRESENTANTE', 'TESTEMUNHA_1', 'TESTEMUNHA_2', 'TESTEMUNHA_3'] as const;

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

export type TrechoContrato = { texto: string; negrito?: true; italico?: true; sublinhado?: true; tamanhoPt?: number };
export type ParagrafoContrato = { tipo: 'texto' | 'clausula' | 'item'; centro?: true; trechos: TrechoContrato[] };
export type ContratoLeitura = { paragrafos: ParagrafoContrato[]; logo: string | null; rodape: string[] };

const LIMITE_LOGO = 2 * 1024 * 1024;
const MIME_IMAGEM: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };
const textoXml = (texto: string) => texto
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// <w:b/> liga; <w:b w:val="0"/> (ou false/off) desliga.
const ligado = (rPr: string, tag: string) => {
  const m = new RegExp(`<w:${tag}(?:\\s+w:val="([^"]*)")?\\s*/>`).exec(rPr);
  return !!m && !['0', 'false', 'off', 'none'].includes(m[1] ?? '');
};

// Paragrafos do Word em estrutura simples para a folha impressa do Portal.
// Basta para o template (paragrafos, negrito, centralizado, listas e titulos
// de clausula); tabelas e caixas de texto viram paragrafos corridos.
function paragrafos(xmlParte: string): ParagrafoContrato[] {
  const lista: ParagrafoContrato[] = [];
  for (const m of xmlParte.matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    const corpo = m[1] ?? '';
    const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(corpo)?.[1] ?? '';
    const estilo = /<w:pStyle w:val="([^"]+)"/.exec(pPr)?.[1] ?? '';
    const p: ParagrafoContrato = {
      tipo: /^(t[ií]?tulo|heading)\s*\d/i.test(estilo) ? 'clausula' : /<w:numPr>/.test(pPr) ? 'item' : 'texto', trechos: [],
    };
    if (/<w:jc w:val="center"\/>/.test(pPr)) p.centro = true;
    for (const r of corpo.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, '').matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
      const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(r[1])?.[1] ?? '';
      let texto = '';
      for (const t of r[1].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br)\/>/g)) texto += t[2] === 'br' ? '\n' : t[2] === 'tab' ? ' ' : textoXml(t[1]);
      if (!texto) continue;
      const trecho: TrechoContrato = { texto };
      if (ligado(rPr, 'b')) trecho.negrito = true;
      if (ligado(rPr, 'i')) trecho.italico = true;
      if (ligado(rPr, 'u')) trecho.sublinhado = true;
      const meiosPontos = Number(/<w:sz w:val="(\d+)"\/>/.exec(rPr)?.[1]);
      if (meiosPontos) trecho.tamanhoPt = meiosPontos / 2;
      // Junta trechos vizinhos com a mesma formatacao (o Word quebra o texto em muitos).
      const anterior = p.trechos.at(-1);
      if (anterior && anterior.negrito === trecho.negrito && anterior.italico === trecho.italico
        && anterior.sublinhado === trecho.sublinhado && anterior.tamanhoPt === trecho.tamanhoPt) anterior.texto += texto;
      else p.trechos.push(trecho);
    }
    lista.push(p);
  }
  return lista;
}

const conteudo = (zip: ContainerZip, caminho: string) => {
  const e = lerEntrada(zip, caminho);
  return e?.content ? Buffer.from(e.content).toString('utf8') : '';
};
// Alvo de um relacionamento (rId) de uma parte do documento.
const alvo = (rels: string, id: string) => new RegExp(`<Relationship [^>]*Id="${id}"[^>]*>`).exec(rels)?.[0].match(/Target="([^"]+)"/)?.[1] ?? null;

// Preenche o template e devolve o conteudo para a folha impressa, com o logo do
// cabecalho e as linhas do rodape do template.
export function lerContrato(template: Uint8Array, campos: Record<CampoContrato, string>): ContratoLeitura {
  let zip: ContainerZip;
  try { zip = XLSX.CFB.read(template, { type: 'buffer' }) as ContainerZip; }
  catch { throw new TemplateInvalido('O template não é um documento do Word válido.'); }
  let texto = conteudo(zip, 'word/document.xml');
  if (!texto) throw new TemplateInvalido('O template não é um documento do Word válido.');
  texto = texto.replace(/\{\{([A-Z0-9_]+)\}\}/g, (inteiro, nome: string) =>
    Object.hasOwn(campos, nome) ? xml(campos[nome as CampoContrato]) : inteiro);
  const restantes = [...texto.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map(m => m[1]);
  if (restantes.length) throw new TemplateInvalido(`O template tem campos desconhecidos: ${[...new Set(restantes)].join(', ')}.`);

  const corpo = /<w:body>([\s\S]*)<\/w:body>/.exec(texto)?.[1] ?? '';
  const rels = conteudo(zip, 'word/_rels/document.xml.rels');
  // Usa o cabecalho/rodape ligado ao documento; se o template tem o arquivo mas
  // perdeu a ligacao (o Word entao nao o mostra), usa o primeiro que existir.
  const referencia = (tipo: 'header' | 'footer') => {
    const id = new RegExp(`<w:${tipo}Reference [^>]*w:type="default"[^>]*r:id="([^"]+)"|<w:${tipo}Reference [^>]*r:id="([^"]+)"[^>]*w:type="default"`).exec(corpo);
    const caminho = (id ? alvo(rels, id[1] ?? id[2]) : null)
      ?? new RegExp(`<Relationship [^>]*Type="[^"]*/${tipo}"[^>]*Target="([^"]+)"|<Relationship [^>]*Target="([^"]+)"[^>]*Type="[^"]*/${tipo}"`).exec(rels)?.slice(1).find(Boolean) ?? null;
    return caminho ? caminho.replace(/^\/?(word\/)?/, '') : null;
  };
  let logo: string | null = null;
  const cabecalho = referencia('header');
  if (cabecalho) {
    const xmlCabecalho = conteudo(zip, `word/${cabecalho}`);
    const imagem = /<a:blip [^>]*r:embed="([^"]+)"/.exec(xmlCabecalho)?.[1];
    const relsCabecalho = conteudo(zip, `word/_rels/${cabecalho.split('/').pop()}.rels`);
    const arquivo = imagem ? alvo(relsCabecalho, imagem) : null;
    const mime = arquivo ? MIME_IMAGEM[arquivo.split('.').pop()?.toLowerCase() ?? ''] : undefined;
    const entrada = arquivo ? lerEntrada(zip, `word/${arquivo.replace(/^\/?(word\/)?/, '')}`) : null;
    if (mime && entrada?.content && entrada.content.length <= LIMITE_LOGO) logo = `data:${mime};base64,${Buffer.from(entrada.content).toString('base64')}`;
  }
  const rodapeArquivo = referencia('footer');
  const rodape = rodapeArquivo ? paragrafos(conteudo(zip, `word/${rodapeArquivo}`)).map(p => p.trechos.map(t => t.texto).join('').trim()).filter(Boolean) : [];
  return { paragrafos: paragrafos(corpo.replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g, '')), logo, rodape };
}
