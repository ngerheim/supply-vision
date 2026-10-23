export async function semearAcordos(api, cadastros) {
  const { locais, fornecedores, itens, modelos, unidade } = cadastros;
  const existentes = (await api('/bootstrap')).agreements;
  const ano = new Date().getFullYear();
  for (let i = 0; i < 5; i++) {
    const number = `DEMO-ACORDO-${i + 1}`;
    let acordo = existentes.find(a => a.number === number);
    if (!acordo) acordo = await api('/agreements', 'POST', {
      number, supplierId: fornecedores[i % 3], locationIds: [locais[i % 3]], status: 'active',
      startDate: `${ano - 1}-01-01`, endDate: `${i < 3 ? ano + 1 : ano - 1}-12-31`,
      notes: 'Demonstracao ficticia. Pagamento em 28 dias; garantia de 90 dias; prazo de atendimento de 2 dias uteis.',
    });
    const detalhe = await api(`/agreements/${acordo.id}`);
    for (let j = 0; j < itens.length; j++) {
      if (detalhe.items.some(item => item.catalogItemId === itens[j])) continue;
      await api(`/agreements/${acordo.id}/items`, 'POST', {
        catalogItemId: itens[j], locationId: locais[i % 3], unitId: unidade, modelIds: modelos,
        price: [39.90, 189.50, 120][j] + i * 5, brands: 'MARCA EXEMPLO', notes: 'Preco unitario ficticio para avaliacao visual.',
      });
    }
  }
}
