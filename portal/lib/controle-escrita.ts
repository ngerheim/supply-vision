// Revisoes e reservas protegem a concorrencia das escritas. Este modulo e
// independente de database.ts: o schema e a API compartilham as mesmas regras
// sem que a inicializacao do banco importe seus proprios handlers.
export const TABELAS_CADASTRO = ['suppliers','locations','catalog_items','vehicle_models','units','import_item_mappings','import_model_mappings','import_unit_mappings'] as const;
// A revisão também avança em importações e UPSERTs, independentemente de quem
// escreveu. O WHEN impede recursão se recursive_triggers estiver habilitado.
export const TRIGGERS_REVISAO = ['agreements', 'agreement_items', 'users', ...TABELAS_CADASTRO].map((tabela) =>
  `CREATE TRIGGER IF NOT EXISTS ${tabela}_revision AFTER UPDATE ON ${tabela}
   WHEN NEW.revision=OLD.revision BEGIN
     UPDATE ${tabela} SET revision=OLD.revision+1 WHERE id=NEW.id;
   END`,
);

export function revisaoConfere(esperada: unknown, atual: number): boolean {
  return typeof esperada === 'number' && Number.isSafeInteger(esperada) && esperada >= 0 && esperada === atual;
}

export const TRAVA_VALIDADE_MS = 30 * 60 * 1000;
export const LIMPAR_TRAVAS_VENCIDAS_SQL = 'DELETE FROM travas WHERE adquirida_em < ?';
export const RENOVAR_TRAVA_SQL = 'UPDATE travas SET adquirida_em=? WHERE chave=? AND dono=? AND adquirida_em>=?';
export class TravaPerdida extends Error {
  constructor() { super('A importacao perdeu a reserva. Confira o resultado antes de tentar novamente.'); }
}

// A revisao esperada vem na query string: DELETE nao tem corpo no cliente.
export function revisaoDaQuery(request: Request): number | null {
  const valor = new URL(request.url).searchParams.get('expectedRevision');
  return valor !== null && /^\d+$/.test(valor) ? Number(valor) : null;
}

// A revisao existente do acordo tambem identifica mudancas na lista vigente.
// Versoes em preparo ou historicas nao invalidam paginas da versao publicada.
export const TRIGGERS_REVISAO_LISTA_ACORDO = [
  `CREATE TRIGGER IF NOT EXISTS acordo_lista_insert AFTER INSERT ON agreement_items BEGIN
    UPDATE agreements SET revision=revision+1 WHERE current_version_id=NEW.version_id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS acordo_lista_delete AFTER DELETE ON agreement_items BEGIN
    UPDATE agreements SET revision=revision+1 WHERE current_version_id=OLD.version_id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS acordo_lista_update AFTER UPDATE ON agreement_items
   WHEN (NEW.version_id,NEW.location_id,NEW.catalog_item_id,NEW.vehicle_model_id,NEW.unit_id,NEW.price,NEW.courtesy,NEW.brands_text,NEW.notes)
     IS NOT (OLD.version_id,OLD.location_id,OLD.catalog_item_id,OLD.vehicle_model_id,OLD.unit_id,OLD.price,OLD.courtesy,OLD.brands_text,OLD.notes)
   BEGIN
    UPDATE agreements SET revision=revision+1 WHERE current_version_id IN (OLD.version_id,NEW.version_id);
   END`,
];
