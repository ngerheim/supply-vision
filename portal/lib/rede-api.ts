import { pode } from './permissoes.ts';
import { comAcaoEscrita } from './autor-escrita.ts';
import { type ContextoApi, type User } from './api-compartilhada.ts';
import { auditoriaNoLote } from './auditoria-api.ts';
import { SITUACAO_EFETIVA_SQL } from './situacao-acordos.ts';
import { dataDeNegocio } from './data-negocio.ts';
import { inteiroPositivo } from './paginacao.ts';
import {
  FRACAO_MINIMA_REDE, POR_PAGINA_REDE, RAIOS_REDE, RAIO_PADRAO_REDE, buscaFornecedor, filtrarRede, localizarMunicipio,
  municipios, validarSnapshotRede, type LinhaRede,
} from './rede.ts';

type FornecedorRow = {
  codigo: string; nome_fantasia: string; razao_social: string | null; cidade: string | null; uf: string | null; ibge: string | null;
  cnpj: string | null; telefone: string | null; email: string | null; ultimo_pedido: string | null; busca: string;
};
// Varias linhas por INSERT: a copia diaria tem milhares de fornecedores.
const LOTE_INSERT = 50;
const SEM_ACESSO = 'Seu perfil não tem acesso à Rede.';
const SEM_GESTAO = 'Seu perfil não permite desconsiderar fornecedores da Rede.';

export function redeApi(contexto: ContextoApi) {
  const { rawDb, now, ok, fail, all, first, jsonBody } = contexto;

  // Rota interna (token do Alertas): troca a copia inteira numa transacao.
  async function receber(request: Request) {
    const { linhas, aceitarQueda } = validarSnapshotRede(await jsonBody(request, 24 * 1024 * 1024));
    if (!linhas.length) return fail('Nenhum fornecedor recebido; a lista atual da Rede foi mantida.', 400);
    const atual = await first<{ linhas: number }>('SELECT linhas FROM rede_atualizacao WHERE id=1');
    if (atual && linhas.length < atual.linhas * FRACAO_MINIMA_REDE && !aceitarQueda) {
      return fail(`A lista recebida tem ${linhas.length} fornecedores, menos da metade dos ${atual.linhas} atuais. ` +
        'A lista atual foi mantida; confira a pasta do Qlik ou reenvie com --aceitar-queda.', 409);
    }
    const db = rawDb(), ts = now();
    const statements = [db.prepare('DELETE FROM rede_segmentos'), db.prepare('DELETE FROM rede_fornecedores')];
    let semCoordenada = 0;
    const fornecedores: unknown[][] = [], segmentos: unknown[][] = [];
    for (const f of linhas) {
      const municipio = localizarMunicipio(f.cidade, f.uf);
      if (!municipio) semCoordenada++;
      fornecedores.push([f.codigo, f.nomeFantasia, f.razaoSocial, f.cidade, f.uf, municipio?.ibge ?? null, f.cnpj, f.telefone, f.email,
        f.ultimoPedido, buscaFornecedor(f)]);
      for (const s of f.segmentos) segmentos.push([f.codigo, s]);
    }
    for (let i = 0; i < fornecedores.length; i += LOTE_INSERT) {
      const lote = fornecedores.slice(i, i + LOTE_INSERT);
      statements.push(db.prepare(`INSERT INTO rede_fornecedores(codigo,nome_fantasia,razao_social,cidade,uf,ibge,cnpj,telefone,email,
        ultimo_pedido,busca) VALUES ${lote.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',')}`).bind(...lote.flat()));
    }
    for (let i = 0; i < segmentos.length; i += LOTE_INSERT) {
      const lote = segmentos.slice(i, i + LOTE_INSERT);
      statements.push(db.prepare(`INSERT INTO rede_segmentos(codigo,segmento) VALUES ${lote.map(() => '(?,?)').join(',')}`).bind(...lote.flat()));
    }
    statements.push(db.prepare(`INSERT INTO rede_atualizacao(id,recebida_em,linhas,sem_coordenada) VALUES(1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET recebida_em=excluded.recebida_em,linhas=excluded.linhas,sem_coordenada=excluded.sem_coordenada`)
      .bind(ts, linhas.length, semCoordenada));
    await db.batch(statements);
    return ok({ success: true, linhas: linhas.length, semCoordenada });
  }

  // Fornecedores visiveis: sem exclusao individual e com ao menos um segmento
  // nao excluido (quem nao tem segmento continua visivel).
  async function carregar(): Promise<{ linhas: LinhaRede[]; contagemSegmentos: Map<string, number> }> {
    const [fornecedores, segmentos, segmentosExcluidos, acordos] = await Promise.all([
      all<FornecedorRow>('SELECT f.* FROM rede_fornecedores f WHERE NOT EXISTS (SELECT 1 FROM rede_exclusoes e WHERE e.codigo=f.codigo)'),
      all<{ codigo: string; segmento: string }>('SELECT codigo,segmento FROM rede_segmentos ORDER BY segmento'),
      all<{ segmento: string }>('SELECT segmento FROM rede_segmentos_excluidos'),
      all<{ cnpj: string; numero: string }>(`SELECT s.cnpj cnpj, a.number numero FROM agreements a JOIN suppliers s ON s.id=a.supplier_id
        WHERE (${SITUACAO_EFETIVA_SQL}) IN ('active','expiring') ORDER BY a.number`, [dataDeNegocio()]),
    ]);
    const fora = new Set(segmentosExcluidos.map(s => s.segmento));
    const porCodigo = new Map<string, string[]>();
    for (const s of segmentos) {
      const lista = porCodigo.get(s.codigo);
      if (lista) lista.push(s.segmento); else porCodigo.set(s.codigo, [s.segmento]);
    }
    const acordosPorCnpj = new Map<string, string[]>();
    for (const a of acordos) {
      const cnpj = String(a.cnpj ?? '').replace(/\D/g, '');
      if (!cnpj) continue;
      const lista = acordosPorCnpj.get(cnpj);
      if (lista) lista.push(a.numero); else acordosPorCnpj.set(cnpj, [a.numero]);
    }
    const contagemSegmentos = new Map<string, number>();
    const linhas: LinhaRede[] = [];
    for (const f of fornecedores) {
      const todos = porCodigo.get(f.codigo) ?? [];
      const visiveis = todos.filter(s => !fora.has(s));
      if (todos.length && !visiveis.length) continue;
      for (const s of visiveis) contagemSegmentos.set(s, (contagemSegmentos.get(s) ?? 0) + 1);
      linhas.push({
        codigo: f.codigo, nome: f.nome_fantasia, razaoSocial: f.razao_social, cidade: f.cidade, uf: f.uf, ibge: f.ibge, cnpj: f.cnpj,
        telefone: f.telefone, email: f.email, ultimoPedido: f.ultimo_pedido, busca: f.busca, segmentos: visiveis,
        acordos: (f.cnpj && acordosPorCnpj.get(f.cnpj)) || [],
      });
    }
    return { linhas, contagemSegmentos };
  }

  async function consultar(user: User, params: URLSearchParams) {
    if (!pode(user, 'aba:rede')) return fail(SEM_ACESSO, 403);
    const codigoCidade = params.get('cidade') || '';
    const centro = codigoCidade ? municipios().porCodigo.get(codigoCidade) ?? null : null;
    if (codigoCidade && !centro) return fail('Cidade não encontrada.', 400);
    const raioPedido = Number(params.get('raio') || RAIO_PADRAO_REDE);
    const raioKm = (RAIOS_REDE as readonly number[]).includes(raioPedido) ? raioPedido : RAIO_PADRAO_REDE;
    const [{ linhas, contagemSegmentos }, atualizacao] = await Promise.all([
      carregar(),
      first<{ recebida_em: string; linhas: number }>('SELECT recebida_em,linhas FROM rede_atualizacao WHERE id=1'),
    ]);
    const filtradas = filtrarRede(linhas, {
      centro, raioKm, segmentos: params.getAll('segmento').filter(Boolean), texto: (params.get('q') || '').slice(0, 200),
      soAcordo: params.get('acordo') === '1',
    });
    const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA_REDE));
    const pagina = Math.min(paginas, inteiroPositivo(params.get('pagina'), 1));
    const naCidade = centro ? filtradas.filter(l => l.mesmaCidade).length : 0;
    return ok({
      linhas: filtradas.slice((pagina - 1) * POR_PAGINA_REDE, pagina * POR_PAGINA_REDE).map(l => ({
        codigo: l.codigo, nome: l.nome, razaoSocial: l.razaoSocial && l.razaoSocial !== l.nome ? l.razaoSocial : null, cidade: l.cidade,
        uf: l.uf, distanciaKm: l.distanciaKm, mesmaCidade: l.mesmaCidade, segmentos: l.segmentos, telefone: l.telefone, email: l.email,
        cnpj: l.cnpj, ultimoPedido: l.ultimoPedido, acordos: l.acordos,
      })),
      total: filtradas.length, pagina, paginas, raio: raioKm,
      cidade: centro ? { id: centro.ibge, nome: `${centro.nome}/${centro.uf}` } : null,
      naCidade, proximas: centro ? filtradas.length - naCidade : 0,
      segmentos: [...contagemSegmentos].map(([nome, total]) => ({ nome, total })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
      atualizacao: atualizacao ? { recebidaEm: atualizacao.recebida_em, linhas: atualizacao.linhas } : null,
    });
  }

  function cidades(user: User) {
    if (!pode(user, 'aba:rede')) return fail(SEM_ACESSO, 403);
    return ok({ cidades: municipios().opcoes });
  }

  async function exclusoes(user: User) {
    if (!pode(user, 'rede:gerenciar')) return fail(SEM_GESTAO, 403);
    const [fornecedores, segmentos, todosSegmentos, semCoordenada] = await Promise.all([
      all(`SELECT e.codigo, e.nome, e.motivo, e.criado_em criadoEm, u.name por, (f.codigo IS NOT NULL) presente FROM rede_exclusoes e
        LEFT JOIN users u ON u.id=e.user_id LEFT JOIN rede_fornecedores f ON f.codigo=e.codigo ORDER BY e.criado_em DESC, e.codigo`),
      all(`SELECT x.segmento, x.criado_em criadoEm, u.name por, (SELECT COUNT(*) FROM rede_segmentos s WHERE s.segmento=x.segmento) fornecedores
        FROM rede_segmentos_excluidos x LEFT JOIN users u ON u.id=x.user_id ORDER BY x.segmento`),
      all('SELECT segmento nome, COUNT(*) total FROM rede_segmentos GROUP BY segmento ORDER BY segmento'),
      all(`SELECT cidade, uf, COUNT(*) total FROM rede_fornecedores WHERE ibge IS NULL GROUP BY cidade, uf ORDER BY total DESC, cidade`),
    ]);
    return ok({ fornecedores, segmentos, todosSegmentos, semCoordenada });
  }

  async function desconsiderarFornecedor(request: Request, user: User) {
    return comAcaoEscrita('rede:gerenciar', async () => {
      const body = await jsonBody<{ codigo?: unknown; motivo?: unknown }>(request);
      const codigo = typeof body.codigo === 'string' ? body.codigo.trim() : '';
      const motivo = typeof body.motivo === 'string' ? body.motivo.trim().slice(0, 300) || null : null;
      const fornecedor = codigo ? await first<{ nome_fantasia: string }>('SELECT nome_fantasia FROM rede_fornecedores WHERE codigo=?', [codigo]) : null;
      if (!fornecedor) return fail('Fornecedor não encontrado na Rede.', 404);
      if (await first('SELECT 1 ok FROM rede_exclusoes WHERE codigo=?', [codigo])) return fail('Este fornecedor já está desconsiderado.', 409);
      const db = rawDb();
      await db.batch([
        db.prepare('INSERT INTO rede_exclusoes(codigo,nome,motivo,user_id,criado_em) VALUES (?,?,?,?,?)').bind(codigo, fornecedor.nome_fantasia, motivo, user.id, now()),
        auditoriaNoLote(contexto, user.id, 'CREATE', 'rede_exclusoes', codigo, `${fornecedor.nome_fantasia} (código ${codigo}) desconsiderado na Rede${motivo ? ` · Motivo: ${motivo}` : ''}`),
      ]);
      return ok({ success: true });
    });
  }

  async function reconsiderarFornecedor(user: User, codigo: string) {
    return comAcaoEscrita('rede:gerenciar', async () => {
      const atual = await first<{ nome: string }>('SELECT nome FROM rede_exclusoes WHERE codigo=?', [codigo]);
      if (!atual) return fail('Este fornecedor não está desconsiderado.', 404);
      const db = rawDb();
      await db.batch([
        db.prepare('DELETE FROM rede_exclusoes WHERE codigo=?').bind(codigo),
        auditoriaNoLote(contexto, user.id, 'DELETE', 'rede_exclusoes', codigo, `${atual.nome} (código ${codigo}) volta a aparecer na Rede`),
      ]);
      return ok({ success: true });
    });
  }

  async function desconsiderarSegmento(request: Request, user: User) {
    return comAcaoEscrita('rede:gerenciar', async () => {
      const body = await jsonBody<{ segmento?: unknown }>(request);
      const segmento = typeof body.segmento === 'string' ? body.segmento.trim() : '';
      if (!segmento || !await first('SELECT 1 ok FROM rede_segmentos WHERE segmento=? LIMIT 1', [segmento])) return fail('Segmento não encontrado na Rede.', 404);
      if (await first('SELECT 1 ok FROM rede_segmentos_excluidos WHERE segmento=?', [segmento])) return fail('Este segmento já está desconsiderado.', 409);
      const db = rawDb();
      await db.batch([
        db.prepare('INSERT INTO rede_segmentos_excluidos(segmento,user_id,criado_em) VALUES (?,?,?)').bind(segmento, user.id, now()),
        auditoriaNoLote(contexto, user.id, 'CREATE', 'rede_segmentos_excluidos', null, `Segmento "${segmento}" desconsiderado na Rede`),
      ]);
      return ok({ success: true });
    });
  }

  async function reconsiderarSegmento(user: User, segmento: string) {
    return comAcaoEscrita('rede:gerenciar', async () => {
      if (!await first('SELECT 1 ok FROM rede_segmentos_excluidos WHERE segmento=?', [segmento])) return fail('Este segmento não está desconsiderado.', 404);
      const db = rawDb();
      await db.batch([
        db.prepare('DELETE FROM rede_segmentos_excluidos WHERE segmento=?').bind(segmento),
        auditoriaNoLote(contexto, user.id, 'DELETE', 'rede_segmentos_excluidos', null, `Segmento "${segmento}" volta a aparecer na Rede`),
      ]);
      return ok({ success: true });
    });
  }

  return { receber, consultar, cidades, exclusoes, desconsiderarFornecedor, reconsiderarFornecedor, desconsiderarSegmento, reconsiderarSegmento };
}
