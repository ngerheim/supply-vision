import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { portalPrivado } from '../scripts/caminhos.mjs';
import { comAcaoEscrita } from './autor-escrita.ts';
import { pode } from './permissoes.ts';
import { dataDeNegocio } from './data-negocio.ts';
import { isRecord } from './domain.ts';
import { type ContextoApi, type User } from './api-compartilhada.ts';
import {
  CAMPOS_CONTRATO, CAMPOS_FIXOS_ANTIGOS, PARTES_ENDERECO, TemplateInvalido, camposDoTemplate, dataPorExtenso, gerarContrato,
  montarEndereco, numeroPorExtenso, type CampoContrato, type EnderecoContrato,
} from './contratos.ts';

// O template contem dados da empresa: mora so na pasta privada do servidor.
const NOME_TEMPLATE = 'contrato-fornecimento';
export const caminhoTemplateContrato = () => path.join(portalPrivado, 'contratos', `${NOME_TEMPLATE}.docx`);
const LIMITE_TEMPLATE = 5 * 1024 * 1024;
const LIMITE_CAMPO = 300;

async function lerTemplate(): Promise<Uint8Array | null> {
  try {
    const info = await stat(caminhoTemplateContrato());
    if (!info.isFile() || info.size > LIMITE_TEMPLATE) return null;
    return new Uint8Array(await readFile(caminhoTemplateContrato()));
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw erro;
  }
}

const nomeArquivo = (texto: string) => texto.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'fornecedor';

export function contratosApi(contexto: ContextoApi) {
  const { NextResponse, ok, fail, jsonBody, audit } = contexto;

  // Situacao do template para a tela.
  async function preparar(user: User) {
    if (!pode(user, 'acordo:consultar-completo')) return fail('Seu perfil não permite gerar contratos.', 403);
    const template = await lerTemplate();
    let campos: string[] = [];
    let erroTemplate = '';
    if (template) {
      try { campos = camposDoTemplate(template); }
      catch (erro) { if (erro instanceof TemplateInvalido) erroTemplate = erro.message; else throw erro; }
      const fixos = CAMPOS_FIXOS_ANTIGOS.filter(c => campos.includes(c));
      if (fixos.length) erroTemplate = `No template, tire ou escreva o texto fixo no lugar de ${fixos.map(c => `{{${c}}}`).join(', ')}. O Portal não preenche mais esses campos.`;
    }
    const resposta: Record<string, unknown> = { template: !!template && !erroTemplate, erroTemplate, campos, hoje: dataDeNegocio() };
    return ok(resposta);
  }

  async function gerar(request: Request, user: User) {
    return comAcaoEscrita('acordo:consultar-completo', async () => {
      if (!pode(user, 'acordo:consultar-completo')) return fail('Seu perfil não permite gerar contratos.', 403);
      const body = await jsonBody<{ campos?: unknown; endereco?: unknown; prazoDias?: unknown; data?: unknown }>(request);
      if (!isRecord(body.campos)) return fail('Preencha os campos do contrato.');
      const prazo = Number(body.prazoDias);
      if (!Number.isInteger(prazo) || prazo < 1 || prazo > 365) return fail('Informe o prazo de pagamento em dias (1 a 365).');
      const data = typeof body.data === 'string' ? body.data : '';
      let dataExtenso: string;
      try { dataExtenso = dataPorExtenso(data); } catch { return fail('Informe uma data de assinatura válida.'); }
      const template = await lerTemplate();
      if (!template) return fail('Template do contrato não encontrado na pasta privada do servidor.', 409);

      const editaveis: CampoContrato[] = ['FORNECEDOR_RAZAO_SOCIAL', 'FORNECEDOR_CNPJ'];
      const campos = {} as Record<CampoContrato, string>;
      for (const nome of editaveis) {
        const valor = body.campos[nome];
        if (typeof valor !== 'string' || !valor.trim()) return fail('Preencha todos os campos do contrato.');
        if (valor.length > LIMITE_CAMPO) return fail('Campo do contrato acima do limite.');
        campos[nome] = valor.trim();
      }
      const e = isRecord(body.endereco) ? body.endereco : {};
      const endereco = {} as EnderecoContrato;
      for (const parte of PARTES_ENDERECO) {
        const valor = e[parte];
        if (valor !== undefined && typeof valor !== 'string') return fail('Endereço inválido.');
        endereco[parte] = String(valor ?? '').trim().slice(0, 120);
        if (parte !== 'complemento' && !endereco[parte]) return fail('Preencha o endereço do fornecedor (só o complemento é opcional).');
      }
      if (!/^[A-Za-z]{2}$/.test(endereco.uf)) return fail('Informe a UF com 2 letras.');
      if (!/^\d{8}$/.test(endereco.cep.replace(/\D/g, ''))) return fail('Informe o CEP com 8 dígitos.');
      campos.FORNECEDOR_ENDERECO = montarEndereco(endereco);
      campos.PRAZO_PAGAMENTO_DIAS = String(prazo);
      campos.PRAZO_PAGAMENTO_EXTENSO = numeroPorExtenso(prazo);
      campos.DATA_ASSINATURA = dataExtenso;
      for (const nome of CAMPOS_CONTRATO) if (campos[nome] === undefined) return fail('Campo do contrato ausente.');

      let arquivo: Uint8Array;
      try { arquivo = gerarContrato(template, campos); }
      catch (erro) { if (erro instanceof TemplateInvalido) return fail(erro.message, 409); throw erro; }
      const cnpj = campos.FORNECEDOR_CNPJ.replace(/\D/g, '');
      await audit(user.id, 'EXPORT', 'contrato', cnpj || null, `Contrato de fornecimento gerado: ${campos.FORNECEDOR_RAZAO_SOCIAL} (prazo ${prazo} dias)`);
      return new NextResponse(Buffer.from(arquivo), { headers: {
        'cache-control': 'no-store',
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename="Contrato_${nomeArquivo(campos.FORNECEDOR_RAZAO_SOCIAL)}.docx"`,
        'x-content-type-options': 'nosniff',
      } });
    });
  }

  return { preparar, gerar };
}
