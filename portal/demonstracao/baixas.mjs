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
    const estoques = [];
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
