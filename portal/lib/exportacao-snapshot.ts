import type { BancoLocal } from './sqlite-local.ts';
import { EntradaInvalida } from './limites-entrada.ts';
export const CONSULTAS_EXPORTACAO = {
  users: 'SELECT id,name,email,role,active,daily_report_enabled,daily_report_time,created_at FROM users ORDER BY created_at',
  suppliers: 'SELECT * FROM suppliers ORDER BY legal_name',
  locations: 'SELECT * FROM locations ORDER BY state,city',
  vehicleModels: 'SELECT * FROM vehicle_models ORDER BY name',
  importItemMappings: 'SELECT * FROM import_item_mappings ORDER BY source_key',
  importUnitMappings: 'SELECT * FROM import_unit_mappings ORDER BY source_key',
  importModelMappings: 'SELECT * FROM import_model_mappings ORDER BY source_key',
  units: 'SELECT * FROM units ORDER BY code',
  agreements: 'SELECT * FROM agreements ORDER BY created_at',
  agreementLocations: 'SELECT * FROM agreement_locations',
  imports: 'SELECT * FROM imports ORDER BY created_at',
  agreementVersions: "SELECT * FROM agreement_versions WHERE status='published' ORDER BY agreement_id,version_number",
  agreementItems: "SELECT * FROM agreement_items WHERE version_id IN (SELECT id FROM agreement_versions WHERE status='published') ORDER BY version_id,created_at",
  tickets: 'SELECT * FROM tickets ORDER BY created_at',
  ticketEvents: 'SELECT * FROM ticket_events ORDER BY created_at',
  emailNotifications: 'SELECT * FROM email_notifications ORDER BY created_at',
  solicitacoes: 'SELECT id,codigo,tipo,cnpj,razao_social,nome_fantasia,situacao_cadastral,cnae_codigo,cnae_descricao,consulta_fonte,consultada_em,nao_verificado,logradouro,numero,complemento,bairro,cidade,uf,cep,telefone,email,atendimento_cidade,atendimento_uf,urgencia,status,solicitante_id,atendente_id,motivo_recusa,criado_em,atualizado_em,revision FROM solicitacoes ORDER BY criado_em,id',
  categoriasFornecedor: 'SELECT * FROM categorias_fornecedor ORDER BY nome',
  solicitacaoCategorias: 'SELECT * FROM solicitacao_categorias ORDER BY solicitacao_id,categoria_id',
  solicitacaoAndamentos: 'SELECT id,solicitacao_id,user_id,de_status,para_status,texto,criado_em FROM solicitacao_andamentos ORDER BY criado_em,id',
  estoques: 'SELECT * FROM estoques ORDER BY nome',
  baixasEstoque: 'SELECT id,codigo,numero_os,estoque_id,placa,status,solicitante_id,atendente_id,motivo_recusa,criado_em,atualizado_em,revision FROM baixas_estoque ORDER BY criado_em,id',
  baixaItens: 'SELECT id,baixa_id,item_id,quantidade_centesimos,status,motivo_recusa,atendente_id,atendido_em,criado_em,atualizado_em,revision FROM baixa_itens ORDER BY baixa_id,criado_em,id',
  catalogItems: 'SELECT * FROM catalog_items ORDER BY name',
  baixaAndamentos: 'SELECT id,baixa_id,user_id,de_status,para_status,texto,criado_em FROM baixa_andamentos ORDER BY criado_em,id',
  movimentosEstoque: 'SELECT id,estoque_id,item_id,tipo,quantidade_centesimos,documento,observacao,origem_tipo,origem_id,movimento_estornado_id,user_id,data_movimento,criado_em FROM movimentos_estoque ORDER BY criado_em,id',
  pagamentos: 'SELECT id,codigo,fornecedor,cnpj,numero_oc,numero_nf,valor_centavos,vencimento,link,observacao,status,motivo_recusa,solicitante_id,atendente_id,criado_em,atualizado_em,revision FROM pagamentos ORDER BY criado_em,id',
  pagamentoAnexos: 'SELECT id,pagamento_id,tipo,nome_arquivo,mime,tamanho,sha256,criado_em,user_id FROM pagamento_anexos ORDER BY pagamento_id,tipo',
  pagamentoAndamentos: 'SELECT id,pagamento_id,user_id,de_status,para_status,texto,criado_em FROM pagamento_andamentos ORDER BY criado_em,id',
  auditLogs: 'SELECT * FROM audit_logs ORDER BY created_at',
  reportJobs: 'SELECT * FROM report_jobs',
  dailyReportDeliveries: 'SELECT * FROM daily_report_deliveries',
};

// A exportacao JSON e uma ferramenta de dados; backups SQLite continuam sem
// este teto. Falha explicita em vez de entregar um arquivo truncado.
export const MAX_LINHAS_EXPORTACAO = 10_000;
export const MAX_BYTES_LOG_EXPORTACAO = 8 * 1024 * 1024;

// O lote executa as leituras no mesmo snapshot SQLite.
export async function exportarTabelas(db: Pick<BancoLocal, 'prepare' | 'batch'>) {
  const entradas=Object.entries(CONSULTAS_EXPORTACAO);
  const consultas=entradas.map(([,sql])=>db.prepare(`${sql} LIMIT ${MAX_LINHAS_EXPORTACAO + 1}`));
  // O limite de logs e verificado no mesmo snapshot; se exceder, sua leitura
  // nao e materializada. Preserva o log integral nas exportacoes permitidas.
  const indiceJobs=entradas.findIndex(([nome])=>nome==='reportJobs');
  consultas[indiceJobs]=db.prepare(`SELECT * FROM report_jobs WHERE (SELECT COALESCE(SUM(length(CAST(log AS BLOB))),0) FROM report_jobs)<=${MAX_BYTES_LOG_EXPORTACAO} LIMIT ${MAX_LINHAS_EXPORTACAO + 1}`);
  const resultados=await db.batch([
    db.prepare('SELECT COALESCE(SUM(length(CAST(log AS BLOB))),0) bytes FROM report_jobs'),
    ...consultas,
  ]);
  if(Number((resultados[0].results?.[0] as {bytes?:number})?.bytes||0)>MAX_BYTES_LOG_EXPORTACAO)
    throw new EntradaInvalida('Exportação JSON excede o limite de logs. Utilize o backup SQLite íntegro; nenhum histórico foi apagado.');
  for(let i=0;i<entradas.length;i++)if((resultados[i+1].results?.length||0)>MAX_LINHAS_EXPORTACAO)
    throw new EntradaInvalida(`Exportação JSON excede ${MAX_LINHAS_EXPORTACAO} registros em ${entradas[i][0]}. Utilize o backup SQLite íntegro; nenhum arquivo parcial foi gerado.`);
  return Object.fromEntries(entradas.map(([nome],i)=>[nome,resultados[i+1].results]));
}
