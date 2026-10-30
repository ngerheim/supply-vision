import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { portalPrivado } from '../scripts/caminhos.mjs';
import { comAcaoEscrita } from './autor-escrita.ts';
import { pode } from './permissoes.ts';
import { dataDeNegocio } from './data-negocio.ts';
import { isRecord } from './domain.ts';
import { type ContextoApi, type User } from './api-compartilhada.ts';
import {
  CAMPOS_CONTRATO, TemplateInvalido, camposDoTemplate, dataPorExtenso, formatarCnpj, gerarContrato,
  numeroPorExtenso, type CampoContrato, type ItemAnexo,
} from './contratos.ts';

// O template contem dados da empresa: mora so na pasta privada do servidor.
const NOME_TEMPLATE = 'contrato-fornecimento';
export const caminhoTemplateContrato = () => path.join(portalPrivado, 'contratos', `${NOME_TEMPLATE}.docx`);
const LIMITE_TEMPLATE = 5 * 1024 * 1024;
const LIMITE_CAMPO = 300;

type Acordo = { id: string; number: string; legal_name: string; trade_name: string; cnpj: string; city: string | null; state: string | null };

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
  const { NextResponse, ok, fail, first, all, jsonBody, audit } = contexto;

  async function acordo(acordoId: string) {
    return first<Acordo>(`SELECT a.id,a.number,s.legal_name,s.trade_name,s.cnpj,s.city,s.state
      FROM agreements a JOIN suppliers s ON s.id=a.supplier_id WHERE a.id=?`, [acordoId]);
  }

  async function itens(acordoId: string) {
    return all<Omit<ItemAnexo, 'cortesia'> & { cortesia: number }>(`SELECT l.city cidade,l.state uf,vm.name modelo,ci.name item,un.code unidade,
      ai.price preco,ai.courtesy cortesia,ai.brands_text marcas
      FROM agreements a JOIN agreement_items ai ON ai.version_id=a.current_version_id
      JOIN catalog_items ci ON ci.id=ai.catalog_item_id JOIN vehicle_models vm ON vm.id=ai.vehicle_model_id
      JOIN units un ON un.id=ai.unit_id JOIN locations l ON l.id=ai.location_id
      WHERE a.id=? ORDER BY l.state,l.city,vm.name,ci.name,ai.id`, [acordoId]);
  }

  // Situacao do template e dados do acordo para preencher o formulario.
  async function preparar(user: User, acordoId: string | null) {
    if (!pode(user, 'acordo:consultar-completo')) return fail('Seu perfil não permite gerar contratos.', 403);
    const template = await lerTemplate();
    let campos: string[] = [];
    let erroTemplate = '';
    if (template) {
      try { campos = camposDoTemplate(template); }
      catch (erro) { if (erro instanceof TemplateInvalido) erroTemplate = erro.message; else throw erro; }
    }
    const resposta: Record<string, unknown> = { template: !!template && !erroTemplate, erroTemplate, campos, hoje: dataDeNegocio() };
    if (acordoId) {
      const a = await acordo(acordoId);
      if (!a) return fail('Acordo não encontrado.', 404);
      const lista = await itens(acordoId);
      resposta.acordo = {
        id: a.id, numero: a.number, razaoSocial: a.legal_name, fantasia: a.trade_name, cnpj: formatarCnpj(a.cnpj),
        endereco: [a.city, a.state].filter(Boolean).join(' - '), itens: lista.length,
      };
    }
    return ok(resposta);
  }

  async function gerar(request: Request, user: User) {
    return comAcaoEscrita('acordo:consultar-completo', async () => {
      if (!pode(user, 'acordo:consultar-completo')) return fail('Seu perfil não permite gerar contratos.', 403);
      const body = await jsonBody<{ acordoId?: unknown; campos?: unknown; prazoDias?: unknown; data?: unknown }>(request);
      if (typeof body.acordoId !== 'string' || !isRecord(body.campos)) return fail('Escolha o acordo e preencha os campos.');
      const prazo = Number(body.prazoDias);
      if (!Number.isInteger(prazo) || prazo < 1 || prazo > 365) return fail('Informe o prazo de pagamento em dias (1 a 365).');
      const data = typeof body.data === 'string' ? body.data : '';
      let dataExtenso: string;
      try { dataExtenso = dataPorExtenso(data); } catch { return fail('Informe uma data de assinatura válida.'); }
      const a = await acordo(body.acordoId);
      if (!a) return fail('Acordo não encontrado.', 404);
      const template = await lerTemplate();
      if (!template) return fail('Template do contrato não encontrado na pasta privada do servidor.', 409);

      const editaveis: CampoContrato[] = ['FORNECEDOR_RAZAO_SOCIAL', 'FORNECEDOR_ENDERECO', 'FORNECEDOR_CNPJ', 'FORNECEDOR_REPRESENTANTE',
        'CIDADE_ASSINATURA', 'CONTRATANTE_REPRESENTANTE', 'TESTEMUNHA_1', 'TESTEMUNHA_2', 'TESTEMUNHA_3'];
      const campos = {} as Record<CampoContrato, string>;
      for (const nome of editaveis) {
        const valor = body.campos[nome];
        if (typeof valor !== 'string' || !valor.trim()) return fail('Preencha todos os campos do contrato.');
        if (valor.length > LIMITE_CAMPO) return fail('Campo do contrato acima do limite.');
        campos[nome] = valor.trim();
      }
      campos.PRAZO_PAGAMENTO_DIAS = String(prazo);
      campos.PRAZO_PAGAMENTO_EXTENSO = numeroPorExtenso(prazo);
      campos.DATA_ASSINATURA = dataExtenso;
      for (const nome of CAMPOS_CONTRATO) if (campos[nome] === undefined) return fail('Campo do contrato ausente.');

      const lista = (await itens(a.id)).map(i => ({ ...i, cortesia: !!i.cortesia }));
      let arquivo: Uint8Array;
      try { arquivo = gerarContrato(template, campos, lista); }
      catch (erro) { if (erro instanceof TemplateInvalido) return fail(erro.message, 409); throw erro; }
      await audit(user.id, 'EXPORT', 'agreement', a.id, `Contrato de fornecimento gerado: ${a.number} (prazo ${prazo} dias, ${lista.length} itens no Anexo I)`);
      return new NextResponse(Buffer.from(arquivo), { headers: {
        'cache-control': 'no-store',
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename="Contrato_${nomeArquivo(a.number)}_${nomeArquivo(a.trade_name)}.docx"`,
        'x-content-type-options': 'nosniff',
      } });
    });
  }

  return { preparar, gerar };
}
