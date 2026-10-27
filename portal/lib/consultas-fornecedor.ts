import { isRecord, isValidCnpj, normalizeCnpj, normalizeText } from './domain.ts';
import { EntradaInvalida } from './limites-entrada.ts';
import { provedorConsultaEnsaio } from './consultas-fornecedor-ensaio.ts';

export type DadosReceita = {
  cnpj: string; razao_social: string; nome_fantasia: string; situacao_cadastral: string;
  cnae_codigo: string; cnae_descricao: string; logradouro: string; numero: string;
  complemento: string; bairro: string; cidade: string; uf: string; cep: string;
};
export type ProvedorConsulta = (url: URL, signal: AbortSignal) => Promise<unknown>;
export class FalhaConsulta extends Error {
  readonly status: number;
  constructor(message: string, status = 503) { super(message); this.status = status; }
}
export const CONSULTA_INDISPONIVEL = 'Consulta à Receita indisponível. Preencha os dados manualmente.';
const texto = (v: unknown, limite = 200) => typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, limite) : '';
const digitos = (v: unknown) => texto(v).replace(/\D/g, '');
const ensaio = () => process.env.MODO_ENSAIO === '1' || process.env.CI === 'true' || process.env.CI === '1' || Boolean(process.env.SV_PREPARO_RAIZ);

const provedorNode: ProvedorConsulta = async (url, signal) => {
  // URLs fechadas e redirect:error impedem redirecionamento a outros hosts.
  const resposta = await fetch(url, { signal, redirect: 'error' });
  if (resposta.status === 404) throw new FalhaConsulta('CNPJ ou CEP não encontrado.', 404);
  if (!resposta.ok) throw new Error('Provedor indisponivel');
  return resposta.json();
};

export function normalizarReceita(valor: unknown, cnpj: string, fonte: string): DadosReceita {
  if (!isRecord(valor)) throw new Error('Resposta invalida');
  if (valor.status === 'ERROR') throw new FalhaConsulta('CNPJ não encontrado.', 404);
  const reserva = fonte === 'ReceitaWS';
  const atividade = Array.isArray(valor.atividade_principal) && isRecord(valor.atividade_principal[0]) ? valor.atividade_principal[0] : {};
  const razao = texto(reserva ? valor.nome : valor.razao_social);
  const situacao = normalizeText(reserva ? valor.situacao : valor.descricao_situacao_cadastral);
  if (!razao || !situacao || normalizeCnpj(valor.cnpj) !== cnpj) throw new Error('Resposta invalida');
  return {
    cnpj, razao_social: razao, nome_fantasia: texto(reserva ? valor.fantasia : valor.nome_fantasia), situacao_cadastral: situacao,
    cnae_codigo: digitos(reserva ? atividade.code : valor.cnae_fiscal), cnae_descricao: texto(reserva ? atividade.text : valor.cnae_fiscal_descricao),
    logradouro: texto(valor.logradouro), numero: texto(valor.numero, 30), complemento: texto(valor.complemento), bairro: texto(valor.bairro),
    cidade: texto(valor.municipio, 80), uf: texto(valor.uf, 2), cep: digitos(valor.cep),
  };
}

export function criarConsultasFornecedor(opcoes: { provedor?: ProvedorConsulta; agora?: () => number } = {}) {
  const cache = new Map<string, { ate: number; valor: unknown }>();
  const agora = opcoes.agora ?? Date.now;
  async function chamar(url: string) {
    const destino = new URL(url);
    if (destino.protocol !== 'https:' || !['brasilapi.com.br', 'receitaws.com.br'].includes(destino.hostname)) throw new Error('Host nao permitido');
    // A escolha ocorre antes de qualquer I/O, inclusive durante PREPARAR.
    return (opcoes.provedor ?? (ensaio() ? provedorConsultaEnsaio : provedorNode))(destino, AbortSignal.timeout(10_000));
  }
  async function comCache<T>(chave: string, executar: () => Promise<T>): Promise<T> {
    const modo = `${ensaio() ? 'ensaio' : 'normal'}:${chave}`, anterior = cache.get(modo);
    if (anterior && anterior.ate > agora()) {
      const valor = anterior.valor as { falha?: string; status?: number };
      if (valor && typeof valor === 'object' && typeof valor.falha === 'string' && typeof valor.status === 'number') throw new FalhaConsulta(valor.falha, valor.status);
      return structuredClone(anterior.valor) as T;
    }
    let valor: T;
    try { valor = await executar(); }
    catch (erro) {
      if (!(erro instanceof FalhaConsulta) || (erro.status !== 404 && erro.status !== 503)) throw erro;
      for (const [k, v] of cache) if (v.ate <= agora()) cache.delete(k);
      if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
      cache.set(modo, { ate: agora() + (erro.status === 404 ? 60_000 : 30_000), valor: { falha: erro.message, status: erro.status } });
      throw erro;
    }
    // Cache limitado para nao reter indefinidamente chaves expiradas.
    for (const [k, v] of cache) if (v.ate <= agora()) cache.delete(k);
    if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
    cache.set(modo, { ate: agora() + 600_000, valor: structuredClone(valor) });
    return valor;
  }
  async function cnpj(entrada: string, atualizar = false) {
    if (!/^[\d./-]+$/.test(entrada) || !isValidCnpj(entrada)) throw new EntradaInvalida('Informe um CNPJ válido.');
    const numero = normalizeCnpj(entrada);
    if (atualizar) cache.delete(`${ensaio() ? 'ensaio' : 'normal'}:cnpj:${numero}`);
    return comCache(`cnpj:${numero}`, async () => {
      let naoEncontrados = 0;
      for (const [fonte, url] of [['BrasilAPI', `https://brasilapi.com.br/api/cnpj/v1/${numero}`], ['ReceitaWS', `https://receitaws.com.br/v1/cnpj/${numero}`]]) {
        try { return { dados: normalizarReceita(await chamar(url), numero, fonte), fonte }; }
        catch (erro) { if (erro instanceof FalhaConsulta && erro.status === 404) naoEncontrados++; }
      }
      if (naoEncontrados === 2) throw new FalhaConsulta('CNPJ não encontrado.', 404);
      throw new FalhaConsulta(CONSULTA_INDISPONIVEL);
    });
  }
  async function cep(entrada: string) {
    if (!/^\d{8}$/.test(entrada)) throw new EntradaInvalida('Informe um CEP com 8 dígitos.');
    return comCache(`cep:${entrada}`, async () => {
      try {
        const valor = await chamar(`https://brasilapi.com.br/api/cep/v2/${entrada}`);
        if (!isRecord(valor) || digitos(valor.cep) !== entrada || !texto(valor.city) || !texto(valor.state)) throw new Error('Resposta invalida');
        return { cep: entrada, logradouro: texto(valor.street), bairro: texto(valor.neighborhood), cidade: texto(valor.city, 80), uf: texto(valor.state, 2) };
      } catch (erro) {
        if (erro instanceof FalhaConsulta) throw erro;
        throw new FalhaConsulta('Consulta de CEP indisponível. Preencha o endereço manualmente.');
      }
    });
  }
  return { cnpj, cep };
}
