import { pode } from './permissoes.ts';
import { montarPowerBiUrl } from './powerbi.ts';
import { type ContextoApi, type User } from './api-compartilhada.ts';

export function bootstrapApi(contexto: ContextoApi, acordos: Pick<ReturnType<typeof import('./acordos-api.ts').acordosApi>, 'agreementList'>, importacoes: Pick<ReturnType<typeof import('./importacoes-api.ts').importacoesApi>, 'importList' | 'totalImportacoes'>) {
  const { env, ok, all } = contexto;
  const { agreementList } = acordos;
  const { importList, totalImportacoes } = importacoes;

  // Endereco do relatorio de Manutencao. Vai so na resposta do bootstrap, que
  // exige login; ver lib/powerbi.ts.
  function relatorioManutencao() {
    const vars = env as unknown as { PBI_RELATORIO_URL?: string; PBI_PAGINA?: string };
    return montarPowerBiUrl(vars.PBI_RELATORIO_URL, vars.PBI_PAGINA);
  }

  async function bootstrap(user: User) {
    if (!pode(user, 'portal:consultar-gestao')) {
      const [suppliers, items, models, locations] = await Promise.all([
        all('SELECT id,trade_name AS tradeName FROM suppliers ORDER BY trade_name'),
        all('SELECT id,name FROM catalog_items ORDER BY name'),
        all('SELECT id,name FROM vehicle_models ORDER BY name'),
        all('SELECT id,revision,city,state FROM locations ORDER BY state,city'),
      ]);
      return ok({ user, agreements: [], totalAcordos: 0, catalogs: { suppliers, items, models, locations, units: [] }, imports: [], manutencao: relatorioManutencao() });
    }
    const [agreements, suppliers, items, models, units, locations, imports] = await Promise.all([
      agreementList(), all('SELECT id,revision,legal_name AS legalName,trade_name AS tradeName,cnpj,city,state,active FROM suppliers ORDER BY trade_name'),
      all('SELECT id,revision,name,active FROM catalog_items ORDER BY name'), all('SELECT id,revision,name,active FROM vehicle_models ORDER BY name'),
      all('SELECT id,revision,code,name,active FROM units ORDER BY code'),
      all('SELECT id,revision,city,state FROM locations ORDER BY state,city'), pode(user, 'importacao:consultar') ? importList() : Promise.resolve([]),
    ]);
    return ok({ user, agreements, totalAcordos: agreements.length, catalogs: { suppliers, items, models, units, locations }, imports, totalImports: pode(user, 'importacao:consultar') ? await totalImportacoes() : 0, manutencao: relatorioManutencao() });
  }

  return { bootstrap };
}
