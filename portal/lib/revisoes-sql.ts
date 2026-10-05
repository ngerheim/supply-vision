// A revisão também avança em importações e UPSERTs, independentemente de quem
// escreveu. O WHEN impede recursão se recursive_triggers estiver habilitado.
export const TRIGGERS_REVISAO = ['agreements', 'agreement_items'].map((tabela) =>
  `CREATE TRIGGER IF NOT EXISTS ${tabela}_revision AFTER UPDATE ON ${tabela}
   WHEN NEW.revision=OLD.revision BEGIN
     UPDATE ${tabela} SET revision=OLD.revision+1 WHERE id=NEW.id;
   END`,
);

export function revisaoConfere(esperada: unknown, atual: number): boolean {
  return typeof esperada === 'number' && Number.isSafeInteger(esperada) && esperada >= 0 && esperada === atual;
}
