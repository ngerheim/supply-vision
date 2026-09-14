// Inspeção do contêiner ZIP de um .xlsx, antes de entregá-lo ao SheetJS.
//
// Um .xlsx é um ZIP. Um arquivo de poucos KB pode declarar (ou produzir)
// centenas de MB ao ser descomprimido, e as verificações de linhas, colunas e
// células de lib/planilha.ts só acontecem DEPOIS que o SheetJS já abriu tudo.
// Esta inspeção fecha essa janela.
//
// São duas camadas, e a segunda é a que importa:
//
//   1. estrutura — EOCD, diretório central, métodos, caminhos;
//   2. descompressão real, contando os bytes que efetivamente saem.
//
// A primeira sozinha não protege: os tamanhos declarados no diretório central
// são escritos por quem monta o arquivo e podem simplesmente mentir. É
// exatamente o arquivo malicioso que mentiria. Por isso cada entrada DEFLATE é
// descomprimida em fluxo, com a saída descartada, apenas para contar.

export type MetricasZip = {
  entradas: number;
  descomprimidoTotal: number;
  maiorEntrada: number;
  maiorTaxa: number;
};

export type ResultadoZip =
  | { ok: true; metricas: MetricasZip }
  | { ok: false; erro: string };

// Medido nas planilhas reais e em planilhas adversariais (textos únicos em
// cada célula, que derrotam a deduplicação de sharedStrings). Cada medição
// rodou em processo próprio, medindo RSS, para a memória de gerar o arquivo de
// teste não contaminar o número. Ver DOCUMENTACAO.md.
//
//   ACORDOS.xlsx (real)   10,7 MB de expansão →  +99,5 MB de RSS
//   adversarial 5k linhas  8,0 MB de expansão → +103,0 MB de RSS
//
// O multiplicador NÃO é o de 4,6x que a primeira medição sugeriu: contra
// conteúdo adversarial chega a ~13x, porque o parser materializa um objeto
// por célula, e não apenas o texto.
//
// Por isso o teto NÃO cabe em 128 MB. Uma única importação de 24 MB de
// expansão pode passar de 300 MB de RSS. O número atual é adequado para a
// máquina do portal (que tem memória de sobra), mas seria preciso reduzir
// bastante antes de rodar em Worker — e a decisão dependeria de medir naquele
// ambiente, não neste.
export const LIMITES_XLSX_ZIP = {
  entradas: 512,
  diretorioCentral: 1024 * 1024,
  nomeEntrada: 512,
  descomprimidoPorEntrada: 16 * 1024 * 1024,
  descomprimidoTotal: 24 * 1024 * 1024,
  taxaCompressaoPorEntrada: 120,
};

const ASSINATURA_EOCD = 0x06054b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;
const METODO_ARMAZENADO = 0;
const METODO_DEFLATE = 8;
const MARCA_ZIP64_16 = 0xffff;
const MARCA_ZIP64_32 = 0xffffffff;

// Mensagens propositalmente genéricas: deslocamentos e nomes internos vão para
// o teste e para o log, não para a resposta da API.
const ERRO_ESTRUTURA = 'A estrutura interna da planilha está inválida.';
const ERRO_GRANDE = 'A planilha possui conteúdo interno excessivamente grande.';
const ERRO_TAXA = 'A planilha possui uma taxa de compactação insegura.';
const ERRO_METODO = 'A planilha utiliza um formato de compactação não aceito.';
const ERRO_CAMINHO = 'A planilha contém caminhos internos inválidos.';

type EntradaCentral = {
  nome: string;
  metodo: number;
  flags: number;
  comprimido: number;
  descomprimido: number;
  posicaoLocal: number;
  diretorio: boolean;
};

// Toda leitura confere os limites antes: arquivo truncado nunca pode virar
// exceção não tratada.
function cabe(dv: DataView, posicao: number, bytes: number) {
  return posicao >= 0 && posicao + bytes <= dv.byteLength;
}

function localizarEocd(dv: DataView): number {
  // Não basta achar a assinatura: um ZIP legítimo pode ter, dentro do próprio
  // comentário, bytes iguais a 0x06054b50. O candidato só vale se o comentário
  // que ele declara terminar exatamente no fim do arquivo; senão, continua
  // procurando para trás.
  const minimo = Math.max(0, dv.byteLength - 65557);
  for (let i = dv.byteLength - 22; i >= minimo; i--) {
    if (!cabe(dv, i, 22) || dv.getUint32(i, true) !== ASSINATURA_EOCD) continue;
    const comentario = dv.getUint16(i + 20, true);
    if (i + 22 + comentario === dv.byteLength) return i;
  }
  return -1;
}

function caminhoPerigoso(nome: string) {
  if (!nome || nome.includes('\0')) return true;
  if (nome.startsWith('/') || nome.startsWith('\\')) return true;
  if (/^[a-zA-Z]:/.test(nome)) return true;       // letra de unidade
  if (nome.includes('\\')) return true;            // barra invertida
  return nome.split('/').includes('..');
}

// Descomprime contando os bytes e descartando a saída. É esta função que pega
// o arquivo que declara 1 KB e produz 500 MB.
async function tamanhoRealDeflate(dados: Uint8Array, tetoIndividual: number, tetoRestante: number) {
  const limite = Math.min(tetoIndividual, tetoRestante);
  const fluxo = new Blob([dados as unknown as BlobPart]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const leitor = fluxo.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += (value as Uint8Array).byteLength;
      if (total > limite) { await leitor.cancel(); return { total, estourou: true, falhou: false }; }
    }
  } catch {
    // DEFLATE truncado ou corrompido.
    return { total, estourou: false, falhou: true };
  }
  return { total, estourou: false, falhou: false };
}

export async function inspecionarXlsxZip(bytes: Uint8Array): Promise<ResultadoZip> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocd = localizarEocd(dv);
  if (eocd === -1 || !cabe(dv, eocd, 22)) return { ok: false, erro: ERRO_ESTRUTURA };

  const discoAtual = dv.getUint16(eocd + 4, true);
  const discoCd = dv.getUint16(eocd + 6, true);
  const entradasDisco = dv.getUint16(eocd + 8, true);
  const entradas = dv.getUint16(eocd + 10, true);
  const tamanhoCd = dv.getUint32(eocd + 12, true);
  const inicioCd = dv.getUint32(eocd + 16, true);
  const tamanhoComentario = dv.getUint16(eocd + 20, true);

  // ZIP dividido em volumes não faz sentido para um .xlsx enviado pela tela.
  if (discoAtual !== 0 || discoCd !== 0 || entradasDisco !== entradas) return { ok: false, erro: ERRO_ESTRUTURA };
  // ZIP64: recusado de propósito. O portal aceita 15 MB, então não é preciso.
  if (entradas === MARCA_ZIP64_16 || tamanhoCd === MARCA_ZIP64_32 || inicioCd === MARCA_ZIP64_32) {
    return { ok: false, erro: ERRO_ESTRUTURA };
  }
  if (eocd + 22 + tamanhoComentario !== dv.byteLength) return { ok: false, erro: ERRO_ESTRUTURA };
  if (entradas === 0 || entradas > LIMITES_XLSX_ZIP.entradas) return { ok: false, erro: ERRO_GRANDE };
  if (tamanhoCd > LIMITES_XLSX_ZIP.diretorioCentral) return { ok: false, erro: ERRO_GRANDE };
  if (inicioCd + tamanhoCd > dv.byteLength || inicioCd + tamanhoCd > eocd) return { ok: false, erro: ERRO_ESTRUTURA };

  const lista: EntradaCentral[] = [];
  const vistos = new Set<string>();
  let p = inicioCd;

  for (let i = 0; i < entradas; i++) {
    if (!cabe(dv, p, 46) || dv.getUint32(p, true) !== ASSINATURA_CENTRAL) return { ok: false, erro: ERRO_ESTRUTURA };
    const flags = dv.getUint16(p + 8, true);
    const metodo = dv.getUint16(p + 10, true);
    const comprimido = dv.getUint32(p + 20, true);
    const descomprimido = dv.getUint32(p + 24, true);
    const nomeLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const comentLen = dv.getUint16(p + 32, true);
    const discoInicial = dv.getUint16(p + 34, true);
    const posicaoLocal = dv.getUint32(p + 42, true);

    if (flags & 0x0001) return { ok: false, erro: ERRO_METODO };  // criptografado
    if (metodo !== METODO_ARMAZENADO && metodo !== METODO_DEFLATE) return { ok: false, erro: ERRO_METODO };
    if (discoInicial !== 0) return { ok: false, erro: ERRO_ESTRUTURA };
    if (comprimido === MARCA_ZIP64_32 || descomprimido === MARCA_ZIP64_32) return { ok: false, erro: ERRO_ESTRUTURA };
    if (nomeLen === 0 || nomeLen > LIMITES_XLSX_ZIP.nomeEntrada) return { ok: false, erro: ERRO_CAMINHO };
    if (!cabe(dv, p + 46, nomeLen)) return { ok: false, erro: ERRO_ESTRUTURA };
    if (comprimido > dv.byteLength || posicaoLocal >= dv.byteLength) return { ok: false, erro: ERRO_ESTRUTURA };

    const nome = new TextDecoder().decode(new Uint8Array(dv.buffer, dv.byteOffset + p + 46, nomeLen));
    // O caminho e conferido em TODAS as entradas, inclusive diretorios: um
    // "../" terminado em barra escapava desta checagem.
    const diretorio = nome.endsWith('/');
    const semBarraFinal = diretorio ? nome.slice(0, -1) : nome;
    if (caminhoPerigoso(semBarraFinal)) return { ok: false, erro: ERRO_CAMINHO };
    const chave = nome.toLowerCase();
    if (vistos.has(chave)) return { ok: false, erro: ERRO_CAMINHO };
    vistos.add(chave);

    // Entradas de diretório também entram na lista, para terem o cabeçalho
    // local conferido. A flag separa quem tem conteúdo a descomprimir de quem
    // é só marcador de pasta.
    lista.push({ nome, metodo, flags, comprimido, descomprimido, posicaoLocal, diretorio });
    p += 46 + nomeLen + extraLen + comentLen;
    if (p > inicioCd + tamanhoCd) return { ok: false, erro: ERRO_ESTRUTURA };
  }

  if (p !== inicioCd + tamanhoCd) return { ok: false, erro: ERRO_ESTRUTURA };

  // Estrutura mínima de um OOXML. Sem allowlist rígida: planilhas legítimas
  // trazem docProps, customXml, estilos, imagens e outros itens válidos.
  const obrigatorios = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml'];
  for (const exigido of obrigatorios) {
    if (!vistos.has(exigido.toLowerCase())) return { ok: false, erro: ERRO_ESTRUTURA };
  }

  return conferirConteudo(dv, bytes, lista, inicioCd);
}

// Segunda camada: confere o cabeçalho local de cada entrada e descomprime de
// verdade, sem confiar no que o diretório central declarou.
async function conferirConteudo(
  dv: DataView,
  bytes: Uint8Array,
  lista: EntradaCentral[],
  inicioCd: number,
): Promise<ResultadoZip> {
  let descomprimidoTotal = 0;
  let maiorEntrada = 0;
  let maiorTaxa = 0;

  for (const entrada of lista) {
    const local = entrada.posicaoLocal;
    if (!cabe(dv, local, 30) || dv.getUint32(local, true) !== ASSINATURA_LOCAL) {
      return { ok: false, erro: ERRO_ESTRUTURA };
    }
    const flagsLocal = dv.getUint16(local + 6, true);
    const metodoLocal = dv.getUint16(local + 8, true);
    const nomeLenLocal = dv.getUint16(local + 26, true);
    const extraLenLocal = dv.getUint16(local + 28, true);
    if (metodoLocal !== entrada.metodo) return { ok: false, erro: ERRO_ESTRUTURA };
    // Os dois cabecalhos precisam concordar: divergencia indica arquivo
    // montado para que o validador leia uma coisa e o parser, outra.
    if (flagsLocal !== entrada.flags) return { ok: false, erro: ERRO_ESTRUTURA };
    if (flagsLocal & 0x0001) return { ok: false, erro: ERRO_METODO };
    if (!cabe(dv, local + 30, nomeLenLocal)) return { ok: false, erro: ERRO_ESTRUTURA };

    const nomeLocal = new TextDecoder().decode(
      new Uint8Array(dv.buffer, dv.byteOffset + local + 30, nomeLenLocal),
    );
    if (nomeLocal !== entrada.nome) return { ok: false, erro: ERRO_ESTRUTURA };

    // Com data descriptor os tamanhos ficam zerados aqui; os do diretório
    // central localizam os dados, e os limites continuam sendo conferidos.
    const inicioDados = local + 30 + nomeLenLocal + extraLenLocal;
    if (inicioDados + entrada.comprimido > dv.byteLength) return { ok: false, erro: ERRO_ESTRUTURA };
    // Os dados precisam terminar antes do diretório central. Sem isto, uma
    // entrada poderia apontar para dentro do próprio diretório ou do EOCD e
    // fazer o validador medir bytes que o parser leria de outro jeito.
    if (inicioDados + entrada.comprimido > inicioCd) return { ok: false, erro: ERRO_ESTRUTURA };
    if (local >= inicioCd) return { ok: false, erro: ERRO_ESTRUTURA };

    // Marcador de pasta: cabeçalho já validado acima, e não há o que medir.
    if (entrada.diretorio) {
      if (entrada.comprimido !== 0 || entrada.descomprimido !== 0) {
        return { ok: false, erro: ERRO_ESTRUTURA };
      }
      continue;
    }

    const restante = LIMITES_XLSX_ZIP.descomprimidoTotal - descomprimidoTotal;
    if (restante <= 0) return { ok: false, erro: ERRO_GRANDE };

    let real: number;
    if (entrada.metodo === METODO_ARMAZENADO) {
      real = entrada.comprimido;
      if (real !== entrada.descomprimido) return { ok: false, erro: ERRO_ESTRUTURA };
      if (real > LIMITES_XLSX_ZIP.descomprimidoPorEntrada || real > restante) {
        return { ok: false, erro: ERRO_GRANDE };
      }
    } else {
      const dados = bytes.subarray(inicioDados, inicioDados + entrada.comprimido);
      const medida = await tamanhoRealDeflate(dados, LIMITES_XLSX_ZIP.descomprimidoPorEntrada, restante);
      if (medida.falhou) return { ok: false, erro: ERRO_ESTRUTURA };
      if (medida.estourou) return { ok: false, erro: ERRO_GRANDE };
      // O tamanho REAL precisa bater com o declarado: divergência significa
      // que o diretório central mentiu, que é o ataque que isto previne.
      if (medida.total !== entrada.descomprimido) return { ok: false, erro: ERRO_ESTRUTURA };
      real = medida.total;
    }

    const taxa = entrada.comprimido > 0 ? real / entrada.comprimido : 0;
    if (taxa > LIMITES_XLSX_ZIP.taxaCompressaoPorEntrada) return { ok: false, erro: ERRO_TAXA };

    descomprimidoTotal += real;
    maiorEntrada = Math.max(maiorEntrada, real);
    maiorTaxa = Math.max(maiorTaxa, taxa);
    if (descomprimidoTotal > LIMITES_XLSX_ZIP.descomprimidoTotal) return { ok: false, erro: ERRO_GRANDE };
  }

  const comConteudo = lista.filter((e) => !e.diretorio).length;
  return { ok: true, metricas: { entradas: comConteudo, descomprimidoTotal, maiorEntrada, maiorTaxa } };
}
