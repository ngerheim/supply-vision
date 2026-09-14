// Testes da inspeção do contêiner ZIP do XLSX.
//
// Os arquivos maliciosos são montados aqui, byte a byte: nada grande entra no
// repositório, e o teste fica legível sobre o que exatamente está sendo
// atacado.

import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import test from 'node:test';

import { LIMITES_XLSX_ZIP, inspecionarXlsxZip } from '../lib/xlsx-zip-guard.ts';

type Item = { nome: string; conteudo: Uint8Array; metodo?: 0 | 8; descomprimidoFalso?: number };

// Monta um ZIP válido; os parâmetros permitem fabricar as versões maliciosas.
function montarZip(itens: Item[], opcoes: { entradasFalsas?: number; inicioCdFalso?: number } = {}) {
  const locais: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let posicao = 0;

  for (const item of itens) {
    const metodo = item.metodo ?? 8;
    const nome = new TextEncoder().encode(item.nome);
    const dados = metodo === 8 ? new Uint8Array(deflateRawSync(item.conteudo)) : item.conteudo;
    const declarado = item.descomprimidoFalso ?? item.conteudo.length;

    const local = new Uint8Array(30 + nome.length + dados.length);
    const dvl = new DataView(local.buffer);
    dvl.setUint32(0, 0x04034b50, true);
    dvl.setUint16(4, 20, true);
    dvl.setUint16(8, metodo, true);
    dvl.setUint32(14, 0, true);
    dvl.setUint32(18, dados.length, true);
    dvl.setUint32(22, declarado, true);
    dvl.setUint16(26, nome.length, true);
    local.set(nome, 30);
    local.set(dados, 30 + nome.length);
    locais.push(local);

    const central = new Uint8Array(46 + nome.length);
    const dvc = new DataView(central.buffer);
    dvc.setUint32(0, 0x02014b50, true);
    dvc.setUint16(10, metodo, true);
    dvc.setUint32(20, dados.length, true);
    dvc.setUint32(24, declarado, true);
    dvc.setUint16(28, nome.length, true);
    dvc.setUint32(42, posicao, true);
    central.set(nome, 46);
    centrais.push(central);

    posicao += local.length;
  }

  const corpoLocal = concat(locais);
  const corpoCentral = concat(centrais);
  const eocd = new Uint8Array(22);
  const dve = new DataView(eocd.buffer);
  dve.setUint32(0, 0x06054b50, true);
  dve.setUint16(8, opcoes.entradasFalsas ?? itens.length, true);
  dve.setUint16(10, opcoes.entradasFalsas ?? itens.length, true);
  dve.setUint32(12, corpoCentral.length, true);
  dve.setUint32(16, opcoes.inicioCdFalso ?? corpoLocal.length, true);
  return concat([corpoLocal, corpoCentral, eocd]);
}

function concat(partes: Uint8Array[]) {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const saida = new Uint8Array(total);
  let i = 0;
  for (const p of partes) { saida.set(p, i); i += p.length; }
  return saida;
}

const texto = (s: string) => new TextEncoder().encode(s);

// Estrutura mínima que a inspeção exige de um OOXML.
const base = (): Item[] => [
  { nome: '[Content_Types].xml', conteudo: texto('<Types/>') },
  { nome: '_rels/.rels', conteudo: texto('<Relationships/>') },
  { nome: 'xl/workbook.xml', conteudo: texto('<workbook/>') },
];

void test('aceita um XLSX bem formado', async () => {
  const r = await inspecionarXlsxZip(montarZip(base()));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.metricas.entradas, 3);
});

void test('aceita entrada armazenada sem compressão', async () => {
  const itens = base();
  itens.push({ nome: 'xl/styles.xml', conteudo: texto('<styleSheet/>'), metodo: 0 });
  const r = await inspecionarXlsxZip(montarZip(itens));
  assert.equal(r.ok, true);
});

void test('recusa arquivo sem EOCD', async () => {
  const r = await inspecionarXlsxZip(texto('isto nao e um zip'));
  assert.equal(r.ok, false);
});

void test('recusa ZIP truncado', async () => {
  const inteiro = montarZip(base());
  const r = await inspecionarXlsxZip(inteiro.subarray(0, Math.floor(inteiro.length / 2)));
  assert.equal(r.ok, false);
});

void test('recusa quantidade de entradas falsa', async () => {
  const r = await inspecionarXlsxZip(montarZip(base(), { entradasFalsas: 99 }));
  assert.equal(r.ok, false);
});

void test('recusa diretório central apontando para fora do arquivo', async () => {
  const r = await inspecionarXlsxZip(montarZip(base(), { inicioCdFalso: 999999 }));
  assert.equal(r.ok, false);
});

void test('recusa caminho com ..', async () => {
  const itens = base();
  itens.push({ nome: '../fora.xml', conteudo: texto('x') });
  const r = await inspecionarXlsxZip(montarZip(itens));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /caminhos internos/i);
});

void test('recusa caminho absoluto', async () => {
  const itens = base();
  itens.push({ nome: '/etc/senha', conteudo: texto('x') });
  assert.equal((await inspecionarXlsxZip(montarZip(itens))).ok, false);
});

void test('recusa barra invertida no caminho', async () => {
  const itens = base();
  itens.push({ nome: 'xl\\planilha.xml', conteudo: texto('x') });
  assert.equal((await inspecionarXlsxZip(montarZip(itens))).ok, false);
});

void test('recusa nome com byte NUL', async () => {
  const itens = base();
  itens.push({ nome: 'xl/planilha\0.xml', conteudo: texto('x') });
  assert.equal((await inspecionarXlsxZip(montarZip(itens))).ok, false);
});

void test('recusa entradas duplicadas', async () => {
  const itens = base();
  itens.push({ nome: 'xl/workbook.xml', conteudo: texto('<outro/>') });
  assert.equal((await inspecionarXlsxZip(montarZip(itens))).ok, false);
});

void test('recusa método de compressão desconhecido', async () => {
  const itens = base();
  itens.push({ nome: 'xl/x.xml', conteudo: texto('x'), metodo: 6 as unknown as 0 });
  const r = await inspecionarXlsxZip(montarZip(itens));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /compacta/i);
});

void test('recusa quando falta a estrutura mínima do OOXML', async () => {
  const r = await inspecionarXlsxZip(montarZip([{ nome: 'qualquer.xml', conteudo: texto('x') }]));
  assert.equal(r.ok, false);
});

// --- Os casos que só a descompressão real detecta ---
// Um leitor que apenas somasse os tamanhos declarados seria enganado por
// todos os três abaixo, que são justamente o ataque que isto previne.

void test('recusa declaração menor que a expansão real (zip bomb clássica)', async () => {
  // O conteúdo produz 5 MB, mas o ZIP declara 100 bytes. Somar o declarado
  // daria "100 bytes, tudo bem"; descomprimir revela a mentira.
  const itens = base();
  itens.push({
    nome: 'xl/sharedStrings.xml',
    conteudo: new Uint8Array(5 * 1024 * 1024),
    descomprimidoFalso: 100,
  });
  const r = await inspecionarXlsxZip(montarZip(itens));
  assert.equal(r.ok, false, 'expansão muito maior que o declarado precisa ser recusada');
});

void test('recusa declaração maior que a expansão real', async () => {
  const itens = base();
  itens.push({
    nome: 'xl/sharedStrings.xml',
    conteudo: texto('pequeno'),
    descomprimidoFalso: 50 * 1024 * 1024,
  });
  assert.equal((await inspecionarXlsxZip(montarZip(itens))).ok, false);
});

void test('recusa entrada acima do teto de expansão', async () => {
  // 60 MB de zeros comprimem muito bem: o arquivo fica pequeno, a saída não.
  const itens = base();
  const enorme = new Uint8Array(60 * 1024 * 1024);
  itens.push({ nome: 'xl/sharedStrings.xml', conteudo: enorme });
  const r = await inspecionarXlsxZip(montarZip(itens));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /grande|compacta/i);
});

void test('recusa DEFLATE corrompido', async () => {
  const zip = montarZip(base());
  // Estraga bytes no meio dos dados comprimidos da primeira entrada.
  const copia = zip.slice();
  for (let i = 60; i < 70 && i < copia.length; i++) copia[i] = 0xff;
  const r = await inspecionarXlsxZip(copia);
  assert.equal(r.ok, false);
});

void test('mensagens de erro não expõem detalhe interno', async () => {
  const itens = base();
  itens.push({ nome: '../fora.xml', conteudo: texto('x') });
  const r = await inspecionarXlsxZip(montarZip(itens));
  assert.equal(r.ok, false);
  if (!r.ok) {
    // Nada de deslocamento, nome de entrada ou termo técnico de ZIP.
    assert.doesNotMatch(r.erro, /0x|offset|EOCD|deslocamento|\.\./i);
    assert.match(r.erro, /planilha/i);
  }
});

void test('métricas refletem o conteúdo real, não o declarado', async () => {
  const itens = base();
  // Conteúdo variado de propósito: 10 mil letras iguais comprimiriam ~300x e
  // seriam recusadas pelo teto de taxa, que é o comportamento correto.
  const variado = Array.from({ length: 4000 }, (_, i) => `<t>linha ${i} item ${i * 7}</t>`).join('');
  itens.push({ nome: 'xl/sharedStrings.xml', conteudo: texto(variado) });
  const r = await inspecionarXlsxZip(montarZip(itens));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.metricas.entradas, 4);
    assert.equal(r.metricas.maiorEntrada, texto(variado).length);
  }
});

void test('recusa taxa de compactação absurda', async () => {
  // 200 mil bytes iguais: comprime centenas de vezes. Nenhuma planilha real
  // chega perto disso — a maior medida no ACORDOS.xlsx foi 9,8x.
  const itens = base();
  itens.push({ nome: 'xl/sharedStrings.xml', conteudo: new Uint8Array(200000) });
  const r = await inspecionarXlsxZip(montarZip(itens));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /compacta|grande/i);
});

// --- Casos estruturais isolados ---
// Cada teste ataca UMA proteção. Onde há risco de outro limite recusar antes
// (a taxa de compressão, por exemplo), o conteúdo é escolhido para não
// disparar o limite errado — senão o teste passaria sem provar o que promete.

function comEocd(zip: Uint8Array, mudar: (dv: DataView, eocd: number) => void) {
  const copia = zip.slice();
  const dv = new DataView(copia.buffer);
  mudar(dv, copia.length - 22);
  return copia;
}

void test('recusa ZIP marcado como multidisco', async () => {
  const zip = comEocd(montarZip(base()), (dv, e) => dv.setUint16(e + 4, 1, true));
  assert.equal((await inspecionarXlsxZip(zip)).ok, false);
});

void test('recusa marcador de ZIP64 na quantidade de entradas', async () => {
  const zip = comEocd(montarZip(base()), (dv, e) => {
    dv.setUint16(e + 8, 0xffff, true);
    dv.setUint16(e + 10, 0xffff, true);
  });
  assert.equal((await inspecionarXlsxZip(zip)).ok, false);
});

void test('recusa entrada criptografada', async () => {
  const zip = montarZip(base());
  // Liga o bit 0 (criptografia) no primeiro cabeçalho central.
  const inicioCd = zip.length - 22 - (46 + 19) - (46 + 11) - (46 + 15);
  const dv = new DataView(zip.buffer);
  dv.setUint16(inicioCd + 8, 0x0001, true);
  assert.equal((await inspecionarXlsxZip(zip)).ok, false);
});

void test('recusa diretório com caminho perigoso', async () => {
  const itens = base();
  itens.push({ nome: '../pasta/', conteudo: new Uint8Array(0), metodo: 0 });
  const r = await inspecionarXlsxZip(montarZip(itens));
  assert.equal(r.ok, false, 'entrada de diretório também precisa passar pela checagem de caminho');
});

void test('recusa diretório absoluto', async () => {
  const itens = base();
  itens.push({ nome: '/raiz/', conteudo: new Uint8Array(0), metodo: 0 });
  assert.equal((await inspecionarXlsxZip(montarZip(itens))).ok, false);
});

void test('aceita EOCD com comentário legítimo', async () => {
  const zip = montarZip(base());
  const comentario = new TextEncoder().encode('planilha gerada pelo sistema');
  const comComentario = new Uint8Array(zip.length + comentario.length);
  comComentario.set(zip, 0);
  comComentario.set(comentario, zip.length);
  new DataView(comComentario.buffer).setUint16(zip.length - 2, comentario.length, true);
  assert.equal((await inspecionarXlsxZip(comComentario)).ok, true);
});

void test('ignora assinatura falsa de EOCD dentro do comentário', async () => {
  // Um ZIP legítimo pode ter, no comentário, bytes iguais a 0x06054b50. A
  // busca precisa continuar para trás até achar o EOCD verdadeiro.
  const zip = montarZip(base());
  const falso = new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0]);
  const comComentario = new Uint8Array(zip.length + falso.length);
  comComentario.set(zip, 0);
  comComentario.set(falso, zip.length);
  new DataView(comComentario.buffer).setUint16(zip.length - 2, falso.length, true);
  const r = await inspecionarXlsxZip(comComentario);
  assert.equal(r.ok, true, 'o EOCD verdadeiro precisa ser encontrado apesar da assinatura falsa');
});

// --- Fronteiras exatas dos tetos de expansão ---
// Testam o limite em si, não uma aproximação. Usam método 0 (armazenado):
// sem compressão, o tamanho real é exatamente o declarado, então o teste
// isola o teto de tamanho sem esbarrar no de taxa.

function entradaDeTamanho(bytes: number): Item {
  // Conteúdo variado para o caso de alguém trocar o método depois.
  const dados = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) dados[i] = (i * 31) % 251;
  return { nome: 'xl/sharedStrings.xml', conteudo: dados, metodo: 0 };
}

void test('entrada exatamente no limite por entrada é aceita', async () => {
  const itens = base();
  itens.push(entradaDeTamanho(LIMITES_XLSX_ZIP.descomprimidoPorEntrada));
  const r = await inspecionarXlsxZip(montarZip(itens));
  assert.equal(r.ok, true, 'o valor do limite deve passar, não ser recusado');
});

void test('entrada um byte acima do limite por entrada é recusada', async () => {
  const itens = base();
  itens.push(entradaDeTamanho(LIMITES_XLSX_ZIP.descomprimidoPorEntrada + 1));
  const r = await inspecionarXlsxZip(montarZip(itens));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /grande/i);
});

// As três entradas obrigatórias também contam na soma; descontá-las é o que
// permite mirar o limite exato.
const tamanhoBase = base().reduce((s, i) => s + i.conteudo.length, 0);

void test('soma exatamente no limite total é aceita', () => {
  return (async () => {
    const itens = base();
    const primeira = LIMITES_XLSX_ZIP.descomprimidoPorEntrada;
    itens.push({ ...entradaDeTamanho(primeira), nome: 'xl/a.xml' });
    itens.push({
      ...entradaDeTamanho(LIMITES_XLSX_ZIP.descomprimidoTotal - primeira - tamanhoBase),
      nome: 'xl/b.xml',
    });
    const r = await inspecionarXlsxZip(montarZip(itens));
    assert.equal(r.ok, true, 'o valor exato do limite deve passar');
    if (r.ok) assert.equal(r.metricas.descomprimidoTotal, LIMITES_XLSX_ZIP.descomprimidoTotal);
  })();
});

void test('soma um byte acima do limite total é recusada', () => {
  return (async () => {
    const itens = base();
    const primeira = LIMITES_XLSX_ZIP.descomprimidoPorEntrada;
    itens.push({ ...entradaDeTamanho(primeira), nome: 'xl/a.xml' });
    itens.push({
      ...entradaDeTamanho(LIMITES_XLSX_ZIP.descomprimidoTotal - primeira - tamanhoBase + 1),
      nome: 'xl/b.xml',
    });
    const r = await inspecionarXlsxZip(montarZip(itens));
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.erro, /grande/i);
  })();
});

void test('nome exatamente no limite é aceito e um byte acima é recusado', async () => {
  const cabe = 'xl/' + 'n'.repeat(LIMITES_XLSX_ZIP.nomeEntrada - 3 - 4) + '.xml';
  assert.equal(cabe.length, LIMITES_XLSX_ZIP.nomeEntrada);
  const dentro = base(); dentro.push({ nome: cabe, conteudo: texto('x') });
  assert.equal((await inspecionarXlsxZip(montarZip(dentro))).ok, true);

  const fora = base(); fora.push({ nome: cabe + 'x', conteudo: texto('x') });
  assert.equal((await inspecionarXlsxZip(montarZip(fora))).ok, false);
});

void test('marcador de pasta é aceito e não conta na expansão', async () => {
  const itens = base();
  itens.push({ nome: 'xl/worksheets/', conteudo: new Uint8Array(0), metodo: 0 });
  const r = await inspecionarXlsxZip(montarZip(itens));
  assert.equal(r.ok, true);
  // Os 3 obrigatórios contam; o marcador de pasta não.
  if (r.ok) assert.equal(r.metricas.entradas, 3);
});
