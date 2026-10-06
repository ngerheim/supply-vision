export const TRAVA_VALIDADE_MS = 30 * 60 * 1000;
export const LIMPAR_TRAVAS_VENCIDAS_SQL = 'DELETE FROM travas WHERE adquirida_em < ?';
export const RENOVAR_TRAVA_SQL = 'UPDATE travas SET adquirida_em=? WHERE chave=? AND dono=? AND adquirida_em>=?';
export class TravaPerdida extends Error {
  constructor() { super('A importacao perdeu a reserva. Confira o resultado antes de tentar novamente.'); }
}
