import * as XLSX from 'xlsx';

// Preenche o template .docx do contrato de fornecimento. O template fica na
// pasta privada (nunca no Git): campos no formato {{NOME}}, cada um inteiro
// dentro de um unico trecho de texto do Word. O Anexo I (tabela de valores)
// e montado a partir dos itens da versao vigente do acordo.

export const CAMPOS_CONTRATO = [
  'FORNECEDOR_RAZAO_SOCIAL', 'FORNECEDOR_ENDERECO', 'FORNECEDOR_CNPJ', 'FORNECEDOR_REPRESENTANTE',
  'PRAZO_PAGAMENTO_DIAS', 'PRAZO_PAGAMENTO_EXTENSO',
  'CIDADE_ASSINATURA', 'DATA_ASSINATURA', 'CONTRATANTE_REPRESENTANTE',
  'TESTEMUNHA_1', 'TESTEMUNHA_2', 'TESTEMUNHA_3',
] as const;
export type CampoContrato = (typeof CAMPOS_CONTRATO)[number];

export type ItemAnexo = {
  cidade: string; uf: string; modelo: string; item: string; unidade: string;
  preco: number; cortesia: boolean; marcas: string | null;
};

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
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new RangeError('Data inválida.');
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

export function formatarCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '').padStart(14, '0');
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

const xml = (texto: string) => texto
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function paragrafo(texto: string, { negrito = false, centro = false, quebraPagina = false, tamanho = 0 } = {}) {
  const pPr = `<w:pPr>${centro ? '<w:jc w:val="center"/>' : ''}<w:spacing w:before="0" w:after="0"/></w:pPr>`;
  const rPr = negrito || tamanho ? `<w:rPr>${negrito ? '<w:b/>' : ''}${tamanho ? `<w:sz w:val="${tamanho}"/>` : ''}</w:rPr>` : '';
  const quebra = quebraPagina ? '<w:r><w:br w:type="page"/></w:r>' : '';
  return `<w:p>${pPr}${quebra}${texto ? `<w:r>${rPr}<w:t xml:space="preserve">${xml(texto)}</w:t></w:r>` : ''}</w:p>`;
}

function celula(texto: string, largura: number, { cabecalho = false, direita = false } = {}) {
  const fundo = cabecalho ? '<w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>' : '';
  const jc = direita ? '<w:jc w:val="right"/>' : '';
  return `<w:tc><w:tcPr><w:tcW w:w="${largura}" w:type="dxa"/>${fundo}</w:tcPr>`
    + `<w:p><w:pPr>${jc}<w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr>${cabecalho ? '<w:b/>' : ''}<w:sz w:val="16"/></w:rPr>`
    + `<w:t xml:space="preserve">${xml(texto)}</w:t></w:r></w:p></w:tc>`;
}

// Anexo I em pagina propria, no fim do corpo do contrato.
export function anexoTabelaValores(itens: readonly ItemAnexo[]): string {
  const colunas: [string, number][] = [['Localidade', 1900], ['Modelo', 1700], ['Peça ou serviço', 2700], ['Unid.', 600], ['Preço', 1100], ['Marcas', 1300]];
  const borda = (lado: string) => `<w:${lado} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
  const bordas = `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(borda).join('')}</w:tblBorders>`;
  const cabecalho = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${colunas.map(([t, l]) => celula(t, l, { cabecalho: true })).join('')}</w:tr>`;
  const linhas = itens.map(i => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${[
    celula(`${i.cidade}/${i.uf}`, 1900), celula(i.modelo, 1700), celula(i.item, 2700), celula(i.unidade, 600),
    celula(i.cortesia ? 'Cortesia' : moeda.format(i.preco), 1100, { direita: true }), celula(i.marcas || '', 1300),
  ].join('')}</w:tr>`).join('');
  const tabela = `<w:tbl><w:tblPr><w:tblW w:w="9300" w:type="dxa"/>${bordas}<w:tblLayout w:type="fixed"/></w:tblPr>`
    + `<w:tblGrid>${colunas.map(([, l]) => `<w:gridCol w:w="${l}"/>`).join('')}</w:tblGrid>${cabecalho}${linhas}</w:tbl>`;
  return paragrafo('ANEXO I – TABELA DE VALORES', { negrito: true, centro: true, quebraPagina: true })
    + paragrafo('')
    + (itens.length ? tabela : paragrafo('Acordo sem itens na versão vigente.'))
    + paragrafo('');
}

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

export function gerarContrato(template: Uint8Array, campos: Record<CampoContrato, string>, itens: readonly ItemAnexo[]): Uint8Array {
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
  // O ultimo sectPr do corpo define a ultima secao; o anexo entra antes dele.
  const fimCorpo = texto.lastIndexOf('<w:sectPr');
  const fechamento = texto.lastIndexOf('</w:body>');
  const ponto = fimCorpo > 0 && fimCorpo < fechamento ? fimCorpo : fechamento;
  if (ponto < 0) throw new TemplateInvalido('O template não tem o corpo do documento.');
  texto = texto.slice(0, ponto) + anexoTabelaValores(itens) + texto.slice(ponto);
  doc.content = Buffer.from(texto, 'utf8');
  doc.size = doc.content.length;
  return XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip', compression: true }) as Uint8Array;
}
