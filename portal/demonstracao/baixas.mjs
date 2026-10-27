import { modoEnsaio } from '../scripts/modo-ensaio.mjs';

export async function semearBaixas(clienteApi, base, exemplo, estado, salvar) {
  if (!modoEnsaio()) throw new Error('Baixas de demonstracao exigem ensaio.');
  const consulta = clienteApi(base),
    suprimentos = clienteApi(base),
    administrador = clienteApi(base);
  await consulta(
    '/login',
    'POST',
    exemplo.usuarios.find((u) => u.role === 'viewer'),
  );
  await suprimentos(
    '/login',
    'POST',
    exemplo.usuarios.find((u) => u.role === 'editor'),
  );
  await administrador('/login', 'POST', exemplo.usuarios.find((u) => u.role === 'admin'));
  try {
    const itens = (await administrador('/bootstrap')).catalogs.items;
    const chaveItem=texto=>String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleUpperCase('pt-BR').trim();
    const catalogo=[];
    for (const [descricao, unidade] of [['Filtro de óleo fictício','un'],['Óleo de motor fictício','L'],['Fluido fictício','L']]) {
      const existente=itens.find(item => chaveItem(item.name) === chaveItem(descricao));
      let item;
      if (!existente) { const criado=await administrador('/catalogs/items','POST',{name:descricao,unidadeEstoque:unidade});item={id:criado.id,descricao,unidade};itens.push({id:item.id,name:descricao,unidadeEstoque:unidade,active:1,revision:0}); }
      else { item={id:existente.id,descricao:existente.name,unidade:existente.unidadeEstoque||unidade};if(!existente.active)await administrador(`/catalogs/items/${item.id}`,'PUT',{name:existente.name,unidadeEstoque:item.unidade,active:true,expectedRevision:existente.revision}); }
      catalogo.push(item);
    }
    const marcadorEntrada='estoque-entrada-ficticia',marcadorAjuste='estoque-ajuste-ficticio';
    const registrosEstoque=await administrador('/estoques'),estoqueInicial=registrosEstoque.estoques.find(e=>e.nome==='Estoque Demonstração A')||await administrador('/estoques','POST',{nome:'Estoque Demonstração A'});
    const hoje=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if(!estado[marcadorEntrada]){await administrador('/estoque/entradas','POST',{estoqueId:estoqueInicial.id,dataMovimento:hoje,documento:'Entrada fictícia de demonstração',observacao:'Carga inicial demonstrativa',itens:catalogo.map(item=>({itemId:item.id,quantidade:item.unidade==='un'?20:20.5}))},'demonstracao-entrada-estoque');estado[marcadorEntrada]=true;salvar();}
    if(!estado[marcadorAjuste]){await administrador('/estoque/ajustes','POST',{estoqueId:estoqueInicial.id,dataMovimento:hoje,documento:'Inventário fictício',observacao:'Conferência demonstrativa',itens:[{itemId:catalogo[0].id,quantidade:2}]},'demonstracao-ajuste-estoque');estado[marcadorAjuste]=true;salvar();}
    const estados = ['aberta', 'aberta', 'baixada', 'recusada'];
    const placas = ['FIC1234', 'FIC1A23', 'DEM5678', 'DEM5B67'];
    for (let i = 0; i < estados.length; i++) {
      const chave = `baixa-${i}`;
      if (estado[chave]) continue;
      const existentes = await administrador('/estoques');
      const nome = `Estoque Demonstração ${String.fromCharCode(65 + i)}`;
      const estoque = existentes.estoques.find((e) => e.nome === nome) || await administrador('/estoques', 'POST', { nome });
      const criada = await consulta(
        '/baixas',
        'POST',
        {
          numero_os: String(900001 + i),
          placa: placas[i],
          estoque_id: estoque.id,
          itens: catalogo.slice(0,(i%3)+1).map((item,j)=>({itemId:item.id,quantidade:item.unidade==='un'?j+1:j+1.25})),
        },
        `demonstracao-baixa-${i}`,
      );
      const registro = (await consulta(`/baixas/${criada.id}`)).baixa;
      if (estados[i] !== 'aberta' && registro.status === 'aberta')
        await suprimentos(
          `/baixas/${registro.id}/transicao`,
          'POST',
          {
            para: estados[i],
            expectedRevision: registro.revision,
            texto:
              estados[i] === 'recusada'
                ? 'OS ficticia sem saldo para baixa no ERP.'
                : '',
          },
          `demonstracao-baixa-final-${i}`,
        );
      estado[chave] = registro.id;
      salvar();
    }
  } finally {
    await consulta('/logout', 'POST');
    await suprimentos('/logout', 'POST');
    await administrador('/logout', 'POST');
  }
}
