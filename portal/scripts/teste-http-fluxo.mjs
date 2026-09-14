// Testes HTTP de baixo nivel e da trava concorrente. So rodam contra a
// instalacao descartavel criada por teste-instalacao-nova.ps1.
import { abrirRequisicao, multipart, requisitar } from './cliente-http.mjs';

const cookie = process.env.PORTAL_TESTE_COOKIE;
const porta = Number(process.env.PORTAL_TESTE_PORTA);
if (process.env.PORTAL_TESTE_DESCARTAVEL !== 'SIM' || !cookie || !Number.isInteger(porta) || porta <= 0 || porta === 3000) {
  console.error('Este teste exige uma instalacao descartavel explicitamente marcada e fora da porta 3000.');
  process.exit(2);
}

const pedir = (opcoes) => requisitar({ ...opcoes, porta });
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const detalhe = (r) => `veio ${r.status}${r.erro ? ` (${r.erro})` : ''}${r.corpo ? `: ${r.corpo.slice(0, 180)}` : ''}`;
let ok = 0, falhou = 0;
const verifica = (nome, condicao, detalhe = '') => {
  if (condicao === true) { ok++; console.log('  [OK]    ' + nome); }
  else { falhou++; console.log('  [FALHA] ' + nome + '  ->  ' + (condicao || detalhe)); }
};

console.log('\n  TESTES HTTP EM FLUXO\n  --------------------');

{
  const pedacos = ['{"name":"', ...Array.from({ length: 12 }, () => 'B'.repeat(8192)), '"}'];
  const r = await pedir({ caminho: '/api/catalogs/brands', pedacos,
    cabecalhos: { cookie, 'content-type': 'application/json', 'transfer-encoding': 'chunked' } });
  verifica('JSON chunked sem Content-Length e limitado pelos bytes reais', r.status === 413 || detalhe(r));
}

{
  const pedacos = ['{"email":"a@b.com","password":"', ...Array.from({ length: 4 }, () => 'P'.repeat(2048)), '"}'];
  const r = await pedir({ caminho: '/api/login', pedacos,
    cabecalhos: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } });
  verifica('Login chunked acima de 2 KB e recusado sem revelar o motivo', r.status === 401 || detalhe(r));
}

{
  const corpo = JSON.stringify({ name: 'MARCA TESTE FLUXO ' + Date.now() });
  const r = await pedir({ caminho: '/api/catalogs/brands', corpo,
    cabecalhos: { cookie, 'content-type': 'application/json', 'content-length': Buffer.byteLength(corpo) } });
  let removeu = false;
  if (r.status === 201) {
    const criado = JSON.parse(r.corpo);
    const exclusao = await pedir({ metodo: 'DELETE', caminho: `/api/catalogs/brands/${criado.id}`, cabecalhos: { cookie } });
    removeu = exclusao.status === 200;
  }
  verifica('Corpo dentro do limite e limpeza continuam funcionando',
    (r.status === 201 && removeu) || `criacao ${r.status}, limpeza ${removeu}`);
}

{
  const grande = multipart('grande.xlsx', Buffer.alloc(16 * 1024 * 1024 + 1024, 0x41));
  const pedacos = [];
  for (let i = 0; i < grande.corpo.length; i += 64 * 1024) pedacos.push(grande.corpo.subarray(i, i + 64 * 1024));
  const r = await pedir({ caminho: '/api/imports/legacy', pedacos, timeoutMs: 60000,
    cabecalhos: { cookie, 'content-type': grande.tipo, 'transfer-encoding': 'chunked' } });
  verifica('Upload multipart chunked acima de 16 MB devolve 413', r.status === 413 || `veio ${r.status}`);
}

console.log('\n  TRAVA DE IMPORTACAO CONCORRENTE\n  -------------------------------');

{
  const invalido = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3, 4]);
  const a = multipart('a.xlsx', invalido);
  const primeira = abrirRequisicao({ porta, caminho: '/api/imports/legacy', timeoutMs: 30000,
    cabecalhos: { cookie, 'content-type': a.tipo, 'transfer-encoding': 'chunked' } });
  const corte = Math.max(1, Math.floor(a.corpo.length / 2));
  await primeira.escrever(a.corpo.subarray(0, corte));
  await esperar(500);

  const b = multipart('b.xlsx', invalido);
  const segunda = await pedir({ caminho: '/api/imports/legacy', corpo: b.corpo,
    cabecalhos: { cookie, 'content-type': b.tipo, 'content-length': b.corpo.length } });
  primeira.terminar(a.corpo.subarray(corte));
  const respostaPrimeira = await primeira.resposta;

  verifica('Importacao mantida aberta segura a trava e a concorrente recebe 409',
    (respostaPrimeira.status === 400 && segunda.status === 409) ||
      `primeira ${respostaPrimeira.status}, segunda ${segunda.status}`);
}

{
  const invalido = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3, 4]);
  const m = multipart('c.xlsx', invalido);
  const r = await pedir({ caminho: '/api/imports/legacy', corpo: m.corpo,
    cabecalhos: { cookie, 'content-type': m.tipo, 'content-length': m.corpo.length } });
  verifica('Depois do erro, a trava e liberada e a proxima importacao chega ao validador',
    r.status === 400 || `veio ${r.status}`);
}

console.log('\n  --------------------');
console.log(`  ${ok} passaram, ${falhou} falharam.\n`);
process.exit(falhou > 0 ? 1 : 0);
