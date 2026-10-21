import { lerConfigEfetiva } from './configuracao.mjs';

export const CHAVES_SERVIDOR = ['INITIAL_ADMIN_PASSWORD', 'TRUSTED_PROXY', 'PORTAL_API_TOKEN', 'PBI_RELATORIO_URL', 'PBI_PAGINA', 'RELATORIOS_PORTA'];
export function configuracaoServidor(config = lerConfigEfetiva()) {
  return Object.fromEntries(CHAVES_SERVIDOR.map(chave => {
    const valor = String(config[chave] ?? '').trim();
    if (/[\r\n]/.test(valor)) throw new Error(`${chave} no portal.env nao pode ter quebra de linha.`);
    return [chave, valor];
  }));
}
export const env = configuracaoServidor();
