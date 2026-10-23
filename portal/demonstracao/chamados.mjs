export async function semearChamados(api, usuarios, estado, salvar) {
  const status = ['aberto', 'aguardando_fornecedor', 'fechado', 'cancelado'];
  for (let i = 0; i < status.length; i++) {
    const chave = `chamado-${i}`;
    if (estado[chave]) continue;
    // requestKey torna a abertura recuperavel mesmo se houver interrupcao antes
    // de salvar o progresso local. Mutacoes HTTP nunca sao repetidas automaticamente.
    const criado = await api('/tickets', 'POST', {
      supplierName: `Parceria ${i + 1} Exemplo`, assignedTo: i % 2 ? usuarios.admin : usuarios.editor,
      city: 'CIDADE AURORA EXEMPLO', state: 'GO', priority: i ? 'media' : 'alta',
      scope: 'Negociacao ficticia de pecas e servicos automotivos.',
    }, `demonstracao-parceria-${i}`);
    const detalhe = await api(`/tickets/${criado.id}`);
    if (detalhe.ticket.status !== status[i]) await api(`/tickets/${criado.id}`, 'PUT', {
      status: status[i], expectedRevision: detalhe.ticket.revision, statusMessage: 'Situacao de exemplo para homologacao visual.',
    });
    if (!detalhe.events.some(e => e.message === 'Andamento ficticio: proposta recebida e em avaliacao.')) await api(`/tickets/${criado.id}/events`, 'POST', { message: 'Andamento ficticio: proposta recebida e em avaliacao.' });
    estado[chave] = criado.id; salvar();
  }
}
