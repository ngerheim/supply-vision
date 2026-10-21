// Partida, health e restauracao devem conferir os mesmos endpoints locais.
export function portaRelatorios(config = {}) {
  const porta = Number(config.RELATORIOS_PORTA || 3001);
  if (!Number.isInteger(porta) || porta < 1024 || porta > 65535) throw new Error('RELATORIOS_PORTA deve ser uma porta entre 1024 e 65535.');
  return porta;
}
export function portasOperacao(config = {}) {
  // PORTAL_URL pode ser uma URL publica com proxy; a porta local e explicita.
  const portal = Number(config.PORTAL_PORTA || 3000);
  const relatorios = portaRelatorios(config);
  if (![portal, relatorios].every(p => Number.isInteger(p) && p >= 1 && p <= 65535) || portal === relatorios) throw new Error('Portas da operacao invalidas.');
  return { portal, relatorios };
}
