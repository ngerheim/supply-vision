export const TRAVA_VALIDADE_MS = 30 * 60 * 1000;
export const LIMPAR_TRAVAS_VENCIDAS_SQL = 'DELETE FROM travas WHERE adquirida_em < ?';
