import { modoEnsaio } from '../scripts/modo-ensaio.mjs';
import { cnpjExemplo } from './cadastros.mjs';

// Rede ficticia em cidades reais vizinhas (so as coordenadas sao reais). Os
// dois primeiros CNPJs sao os dos fornecedores com acordo da demonstracao.
const CIDADES = [
  ['Belo Horizonte', 'MG'], ['Contagem', 'MG'], ['Betim', 'MG'], ['Nova Lima', 'MG'], ['Sabará', 'MG'], ['Sete Lagoas', 'MG'],
  ['Parauapebas', 'PA'], ['Canaã dos Carajás', 'PA'], ['Curionópolis', 'PA'], ['Marabá', 'PA'],
  ['Paracatu', 'MG'], ['Unaí', 'MG'], ['Campo Grande', 'MS'], ['Terenos', 'MS'],
];
const SEGMENTOS = [['Mecânica Automotiva'], ['Auto Elétrica'], ['Pneus', 'Alinhamento E Balanceamento'], ['Reboque de Veiculos'],
  ['Lanternagem E Pintura'], ['Mecanica Diesel Pesados', 'Peças Para Caminhão'], ['Auto Peças'], ['Ar Condicionado']];
const TIPOS = ['Oficina', 'Auto Elétrica', 'Pneus', 'Guincho', 'Funilaria', 'Diesel', 'Autopeças', 'Clima'];

export function fornecedoresRede() {
  const linhas = [];
  for (let i = 0; i < 42; i++) {
    const [cidade, uf] = CIDADES[i % CIDADES.length], tipo = i % TIPOS.length;
    linhas.push({ codigo: String(9001 + i), nomeFantasia: `${TIPOS[tipo]} Exemplo ${i + 1}`, razaoSocial: `${TIPOS[tipo]} Exemplo ${i + 1} Ltda`,
      cidade, uf, cnpj: i < 2 ? cnpjExemplo(i + 1) : cnpjExemplo(100 + i), telefone: '(00) 0000-0000', email: `contato${i + 1}@exemplo.invalid`,
      ultimoPedido: i % 5 === 0 ? null : `2026-0${1 + (i % 9)}-15`, segmentos: SEGMENTOS[tipo] });
  }
  linhas.push({ codigo: '9900', nomeFantasia: 'Banco Exemplo', razaoSocial: 'Banco Exemplo S.A.', cidade: 'Belo Horizonte', uf: 'MG', cnpj: cnpjExemplo(199),
    telefone: null, email: null, ultimoPedido: null, segmentos: ['Instituição Financeira'] });
  return linhas;
}

// Pela rota interna, como o Alertas faz; sem token configurado, nao semeia.
export async function semearRede(base, token, estado, salvar) {
  if (!modoEnsaio()) throw new Error('Rede de demonstracao exige ensaio.');
  if (estado.redeConcluida || !token) return;
  const resposta = await fetch(`${base}/api/internal/rede`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ linhas: fornecedoresRede() }) });
  if (!resposta.ok) throw new Error(`Falha ao semear a Rede ficticia (${resposta.status}).`);
  estado.redeConcluida = true; salvar();
}
