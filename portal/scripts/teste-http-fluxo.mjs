// Testes HTTP de baixo nivel e da trava concorrente. So rodam contra a
// instalacao descartavel criada por teste-instalacao-nova.ps1.
import { requisitar } from './cliente-http.mjs';

const cookie = process.env.PORTAL_TESTE_COOKIE;
const porta = Number(process.env.PORTAL_TESTE_PORTA);
if (process.env.PORTAL_TESTE_DESCARTAVEL !== 'SIM' || !cookie || !Number.isInteger(porta) || porta <= 0 || porta === 3000) {
  console.error('Este teste exige uma instalacao descartavel explicitamente marcada e fora da porta 3000.');
  process.exit(2);
}

const pedir = (opcoes) => requisitar({ ...opcoes, porta });
const detalhe = (r) => `veio ${r.status}${r.erro ? ` (${r.erro})` : ''}${r.corpo ? `: ${r.corpo.slice(0, 180)}` : ''}`;
let ok = 0, falhou = 0;
const verifica = (nome, condicao, detalhe = '') => {
  if (condicao === true) { ok++; console.log('  [OK]    ' + nome); }
  else { falhou++; console.log('  [FALHA] ' + nome + '  ->  ' + (condicao || detalhe)); }
};

console.log('\n  TESTES HTTP EM FLUXO\n  --------------------');

{
  const r = await pedir({ metodo: 'GET', caminho: '/api/bootstrap',
    cabecalhos: { cookie: `outro=%; ${cookie}` } });
  verifica('Cookie malformado nao interrompe a sessao real', r.status === 200 || detalhe(r));
  const invalida = await pedir({ metodo: 'GET', caminho: '/api/bootstrap',
    cabecalhos: { cookie: 'acordos_session=%' } });
  verifica('Cookie de sessao malformado devolve 401', invalida.status === 401 || detalhe(invalida));
}

{
  const pedacos = ['{"name":"', ...Array.from({ length: 12 }, () => 'B'.repeat(8192)), '"}'];
  const r = await pedir({ caminho: '/api/catalogs/models', pedacos,
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
  const r = await pedir({ caminho: '/api/catalogs/models', corpo,
    cabecalhos: { cookie, 'content-type': 'application/json', 'content-length': Buffer.byteLength(corpo) } });
  let removeu = false;
  if (r.status === 201) {
    const criado = JSON.parse(r.corpo);
    const exclusao = await pedir({ metodo: 'DELETE', caminho: `/api/catalogs/models/${criado.id}`, cabecalhos: { cookie } });
    removeu = exclusao.status === 200;
  }
  verifica('Corpo dentro do limite e limpeza continuam funcionando',
    (r.status === 201 && removeu) || `criacao ${r.status}, limpeza ${removeu}`);
}

console.log('\n  --------------------');
console.log(`  ${ok} passaram, ${falhou} falharam.\n`);
process.exit(falhou > 0 ? 1 : 0);
