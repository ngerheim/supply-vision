// Leitura de planilhas isolada atras de um adaptador.
//
// Existe por dois motivos. Primeiro, para que trocar de biblioteca mexa em um
// arquivo so: quando o xlsx 0.18.5 (com CVEs de poluicao de prototipo e ReDoS,
// e sem correcao publicada no npm) precisou dar lugar ao 0.20.3 oficial do
// SheetJS, a troca foi de uma linha. Segundo, o limite de linhas antes era
// conferido depois da conversao inteira: um .xlsx pequeno pode expandir muito
// na memoria, entao a checagem precisa vir antes.
//
// As defesas daqui continuam valendo mesmo com a biblioteca corrigida: elas
// protegem contra o proximo problema, nao contra o que ja foi resolvido.

import * as XLSX from 'xlsx';

import { inspecionarXlsxZip } from './xlsx-zip-guard.ts';
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, normalizeImportColumn } from './domain.ts';

export type LinhaPlanilha = Record<string, unknown>;

// Bytes e linhas vem de domain.ts: eram repetidos aqui com os mesmos numeros,
// e mexer num lado deixava o outro para tras sem nenhum sinal.
export const PLANILHA_LIMITES = {
  bytes: MAX_IMPORT_BYTES,
  linhas: MAX_IMPORT_ROWS,
  colunas: 100,
  celulas: 1_000_000,
};

export type ResultadoLeitura =
  | { ok: true; linhas: LinhaPlanilha[]; numerosLinhas: number[]; aba: string }
  | { ok: false; erro: string };

// Assinatura real do arquivo. A extensao nao prova nada: um .exe renomeado
// para .xlsx chegaria ate o parser sem esta checagem.
function assinaturaValida(bytes: Uint8Array): 'xlsx' | 'xls' | null {
  if (bytes.length < 8) return null;
  // XLSX e um ZIP: PK\x03\x04
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) return 'xlsx';
  // XLS antigo (OLE2): D0 CF 11 E0 A1 B1 1A E1
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (ole.every((b, i) => bytes[i] === b)) return 'xls';
  return null;
}

export async function lerPlanilha(arquivo: File): Promise<ResultadoLeitura> {
  if (arquivo.size === 0) return { ok: false, erro: 'O arquivo está vazio.' };
  if (arquivo.size > PLANILHA_LIMITES.bytes) {
    return { ok: false, erro: `O arquivo tem ${(arquivo.size / 1024 / 1024).toFixed(1)} MB. O limite é ${PLANILHA_LIMITES.bytes / 1024 / 1024} MB.` };
  }

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const assinatura = assinaturaValida(bytes);
  if (!assinatura) {
    return { ok: false, erro: 'O arquivo não é uma planilha do Excel válida. Salve como .xlsx e tente de novo.' };
  }

  // XLSX é um ZIP: inspeciona o contêiner ANTES do SheetJS. Um arquivo de
  // poucos KB pode expandir para centenas de MB, e as checagens de linhas e
  // colunas abaixo só acontecem depois que o SheetJS já abriu tudo.
  // XLS antigo é OLE2, não ZIP, e segue o fluxo de sempre.
  if (assinatura === 'xlsx') {
    const zip = await inspecionarXlsxZip(bytes);
    if (!zip.ok) return { ok: false, erro: zip.erro };
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: 'array',
      // Sem fórmulas, sem estilos e sem conteúdo VBA: reduz o que o parser
      // precisa interpretar e, com isso, a superfície de ataque.
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
      // Só a primeira aba é usada; ler as demais seria trabalho jogado fora.
      sheets: 0,
    });
  } catch (erro) {
    return { ok: false, erro: `Não foi possível abrir a planilha: ${erro instanceof Error ? erro.message : 'arquivo inválido ou corrompido'}.` };
  }

  const nomeAba = workbook.SheetNames?.[0];
  if (!nomeAba) return { ok: false, erro: 'A planilha não tem nenhuma aba.' };
  const aba = workbook.Sheets[nomeAba];
  if (!aba) return { ok: false, erro: 'Não foi possível ler a primeira aba da planilha.' };

  // Confere as dimensões ANTES de converter. sheet_to_json materializa tudo em
  // memória, então uma planilha declarando um milhão de linhas derrubaria o
  // processo se a checagem viesse depois.
  const ref = aba['!ref'];
  if (!ref) return { ok: false, erro: 'A primeira aba da planilha está vazia.' };
  const faixa = XLSX.utils.decode_range(ref);
  const linhas = faixa.e.r - faixa.s.r + 1;
  const colunas = faixa.e.c - faixa.s.c + 1;

  if (linhas > PLANILHA_LIMITES.linhas) {
    return { ok: false, erro: `A planilha tem ${linhas.toLocaleString('pt-BR')} linhas. O limite é ${PLANILHA_LIMITES.linhas.toLocaleString('pt-BR')}.` };
  }
  if (colunas > PLANILHA_LIMITES.colunas) {
    return { ok: false, erro: `A planilha tem ${colunas} colunas, acima do limite de ${PLANILHA_LIMITES.colunas}. Verifique se há dados fora da área esperada.` };
  }
  if (linhas * colunas > PLANILHA_LIMITES.celulas) {
    return { ok: false, erro: 'A área ocupada pela planilha é grande demais. Remova linhas ou colunas vazias sobrando.' };
  }

  let brutas: LinhaPlanilha[];
  try {
    // Linhas inteiramente vazias antes do cabeçalho não são dados.
    let cabecalho = faixa.s.r;
    while (cabecalho <= faixa.e.r) {
      let preenchida = false;
      for (let column = faixa.s.c; column <= faixa.e.c; column++) {
        const value = aba[XLSX.utils.encode_cell({ r: cabecalho, c: column })]?.v;
        if (value !== undefined && value !== null && String(value).trim() !== '') { preenchida = true; break; }
      }
      if (preenchida) break;
      cabecalho++;
    }
    const campos = new Map<string, string>();
    for (let column = faixa.s.c; column <= faixa.e.c; column++) {
      const cell = XLSX.utils.encode_cell({ r: cabecalho, c: column });
      const key = normalizeImportColumn(aba[cell]?.v);
      if (!key) continue;
      if (campos.has(key)) return { ok: false, erro: `Cabeçalho duplicado para ${key}: células ${campos.get(key)} e ${cell}, aba "${nomeAba}". Mantenha apenas uma coluna por campo.` };
      campos.set(key, cell);
    }
    brutas = XLSX.utils.sheet_to_json<LinhaPlanilha>(aba, { defval: '', range: cabecalho });
  } catch (erro) {
    return { ok: false, erro: `Não foi possível interpretar os dados: ${erro instanceof Error ? erro.message : 'formato inesperado'}.` };
  }

  // Descarta chaves herdadas do prototipo: xlsx 0.18.5 tem CVE de prototype
  // pollution, e uma coluna chamada __proto__ ou constructor nao deve virar
  // propriedade de objeto nosso.
  const proibidas = new Set(['__proto__', 'constructor', 'prototype']);
  const limpas = brutas.map((linha) => {
    const saida: LinhaPlanilha = Object.create(null);
    for (const [chave, valor] of Object.entries(linha)) {
      if (proibidas.has(chave)) continue;
      saida[chave] = typeof valor === 'string' && valor.length > 5000 ? valor.slice(0, 5000) : valor;
    }
    return saida;
  });

  // SheetJS conserva a posição física em __rowNum__, mesmo ao omitir vazios.
  const numerosLinhas = brutas.map((linha) => Number(linha.__rowNum__) + 1);
  return { ok: true, linhas: limpas, numerosLinhas, aba: nomeAba };
}
