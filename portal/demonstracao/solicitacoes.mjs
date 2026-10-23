import { cnpjFicticio } from '../lib/consultas-fornecedor-ensaio.ts';
import { modoEnsaio } from '../scripts/modo-ensaio.mjs';

export async function semearSolicitacoes(clienteApi, base, exemplo, estado, salvar) {
  if (!modoEnsaio()) throw new Error('Solicitacoes de demonstracao exigem ensaio.');
  const consulta = clienteApi(base), suprimentos = clienteApi(base);
  await consulta('/login', 'POST', exemplo.usuarios.find(u => u.role === 'viewer'));
  await suprimentos('/login', 'POST', exemplo.usuarios.find(u => u.role === 'editor'));
  try {
    const estados = ['aberta', 'em_analise', 'devolvida', 'cadastrado', 'recusado', 'aberta'];
    for (let i = 0; i < estados.length; i++) {
      const chave = `solicitacao-${i}`;
      if (estado[chave]) continue;
      // Consulta so na primeira abertura: o corpo da chave idempotente precisa
      // continuar identico na retomada, mesmo com um novo consultaId.
      const cnpj = cnpjFicticio(200 + i);
      const existente = (await consulta('/solicitacoes')).solicitacoes.find(s => s.cnpj === cnpj);
      let registro = existente;
      if (!registro) {
        const receita = i === 5 ? {} : await consulta(`/solicitacoes/cnpj/${cnpj}`);
        const criada = await consulta('/solicitacoes', 'POST', {
          ...(i === 5 ? { cnpj, razao_social: 'Fornecedor Manual Exemplo' } : { consultaId: receita.consultaId }),
          urgencia: i === 0 ? 'urgente' : 'normal', categorias: ['categoria_semente_1'],
        }, `demonstracao-solicitacao-${i}`);
        registro = (await consulta(`/solicitacoes/${criada.id}`)).solicitacao;
      }
      if (estados[i] !== 'aberta' && registro.status === 'aberta') {
        await suprimentos(`/solicitacoes/${registro.id}/transicao`, 'POST', { para: 'em_analise', expectedRevision: registro.revision }, `demonstracao-solicitacao-analise-${i}`);
        registro = (await consulta(`/solicitacoes/${registro.id}`)).solicitacao;
      }
      if (estados[i] !== registro.status) await suprimentos(`/solicitacoes/${registro.id}/transicao`, 'POST', {
        para: estados[i], expectedRevision: registro.revision,
        texto: estados[i] === 'devolvida' ? 'Corrigir endereco ficticio.' : estados[i] === 'recusado' ? 'Atividade ficticia fora do escopo.' : 'Cadastro ficticio concluido.',
      }, `demonstracao-solicitacao-final-${i}`);
      estado[chave] = registro.id; salvar();
    }
  } finally { await consulta('/logout', 'POST'); await suprimentos('/logout', 'POST'); }
}
