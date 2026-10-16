// Inventario reproduzivel. Uso: node scripts/inventario-metricas.mjs [--ref SHA]
// Sem --ref: arquivos rastreados no checkout (inclui alteracoes ainda nao commitadas).
// --ref: blobs daquela revisao, sem checkout, sem ler privado/ ou arquivos ignorados.
// Exclusoes: package-lock.json, qualquer diretorio vendor/, LICENSE, imagens e binarios.
// Categorias exclusivas: .md => docs; .github/ => CI; tests/, testes/ e nomes
// testar-/teste-/test_ => testes; demais textos rastreados => producao (inclui configs).
// Linhas fisicas: CRLF/CR normalizados, ultima linha sem terminador conta;
// terminador final nao cria linha extra. Vazio tem zero linhas.
// Caracteres: pontos de codigo Unicode; sem espacos em branco usa \s do JavaScript.
// Linhas acima de 300: comprimento inclui espacos e tabs, exclui CR/LF.
// Pequeno: arquivo de producao com <30 linhas, inclusive wrappers/configs.
// Contagens sao indicadores; nao objetivos de reducao.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function categorizar(arquivo){
  const partes=arquivo.split('/'),nome=partes.at(-1);
  if(partes.includes('privado')||partes.includes('vendor')||nome==='package-lock.json'||nome==='LICENSE'||/\.(svg|png|jpe?g|gif|ico|tgz|zip|pdf|sqlite)$/i.test(nome))return null;
  if(nome.endsWith('.md'))return 'docs';
  if(partes[0]==='.github')return 'ci';
  if(partes.includes('tests')||partes.includes('testes')||/^(testar-|teste-|test_)/.test(nome))return 'testes';
  return 'producao';
}
export function contarLinhas(texto){
  if(!texto)return 0;
  const linhas=texto.replace(/\r\n?/g,'\n').split('\n');
  return linhas.length-(linhas.at(-1)===''?1:0);
}
export function inventario(arquivos){
  const categorias=Object.fromEntries(['producao','testes','docs','ci'].map(c=>[c,{
    arquivos:0,linhas:0,caracteresSemEspacos:0,
  }])),itens=[],arquivosComLinhasLongas=[];
  for(const {arquivo,conteudo} of arquivos){
    const categoria=categorizar(arquivo);
    if(!categoria||conteudo.includes(0))continue;
    const texto=conteudo.toString('utf8'),linhas=contarLinhas(texto);
    const caracteresSemEspacos=Array.from(texto.replace(/\s/gu,'')).length;
    const comprimentos=texto.replace(/\r\n?/g,'\n').split('\n').map(l=>Array.from(l).length);
    const longas=comprimentos.filter(n=>n>300);
    categorias[categoria].arquivos++;categorias[categoria].linhas+=linhas;
    categorias[categoria].caracteresSemEspacos+=caracteresSemEspacos;
    itens.push({arquivo,categoria,linhas});
    if(longas.length)arquivosComLinhasLongas.push({
      arquivo,categoria,linhasAcimaDe300:longas.length,maiorLinha:longas.reduce((a,n)=>Math.max(a,n),0),
    });
  }
  return {
    categorias,
    // Preserva o contrato existente de total (arquivos/linhas).
    total:Object.values(categorias).reduce((a,c)=>({
      arquivos:a.arquivos+c.arquivos,linhas:a.linhas+c.linhas,
    }),{arquivos:0,linhas:0}),
    totalCaracteresSemEspacos:Object.values(categorias).reduce((a,c)=>a+c.caracteresSemEspacos,0),
    arquivosComLinhasLongas:arquivosComLinhasLongas.sort((a,b)=>a.arquivo.localeCompare(b.arquivo)),
    pequenos:itens.filter(i=>i.categoria==='producao'&&i.linhas<30).sort((a,b)=>a.arquivo.localeCompare(b.arquivo)),
    maiores:itens.sort((a,b)=>b.linhas-a.linhas||a.arquivo.localeCompare(b.arquivo)).slice(0,10),
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const raiz=path.resolve(import.meta.dirname,'..'),pos=process.argv.indexOf('--ref');
  let ref=null;
  if(pos>=0){
    if(!process.argv[pos+1])throw new Error('--ref exige revisao.');
    ref=execFileSync('git',['rev-parse','--verify','--end-of-options',process.argv[pos+1]+'^{commit}'],{cwd:raiz,encoding:'utf8'}).trim();
  }
  const nomes=execFileSync('git',ref?['ls-tree','-r','-z','--name-only',ref]:['ls-files','-z'],{cwd:raiz,encoding:'utf8'}).split('\0').filter(Boolean);
  const arquivos=nomes.filter(n=>categorizar(n)).map(arquivo=>({arquivo,conteudo:ref?execFileSync('git',['show',ref+':'+arquivo],{cwd:raiz,maxBuffer:32*1024*1024}):fs.readFileSync(path.join(raiz,arquivo))}));
  console.log(JSON.stringify({revisao:ref||'checkout',...inventario(arquivos)},null,2));
}
