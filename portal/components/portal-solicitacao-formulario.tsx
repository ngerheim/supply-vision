'use client';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, errorText } from '@/lib/api';
import {
  AVISO_MANUAL,
  UFS,
  corpoJson,
  dataHoraSolicitacao,
  erroDeRevisao,
  formatarCnae,
  mascaraCep,
  mascaraCnpj,
  mascaraTelefone,
  rotuloSituacao,
} from '@/lib/solicitacoes-cliente';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { type AnyRow, Field, Info } from './portal-presentation';
import { PageHeader } from './page-header';
import { Status } from './status';
import { gerarChaveRelatorio } from '@/lib/relatorios';

const receitaCampos = [
  ['razao_social', 'Razão social'],
  ['nome_fantasia', 'Nome fantasia'],
  ['situacao_cadastral', 'Situação cadastral'],
  ['cnae_codigo', 'CNAE'],
  ['cnae_descricao', 'Descrição do CNAE'],
];
const enderecoCampos = [
  ['logradouro', 'Logradouro'],
  ['numero', 'Número'],
  ['complemento', 'Complemento'],
  ['bairro', 'Bairro'],
  ['cidade', 'Cidade'],
];
function SeletorUf({ nome, valor, mudar }: { nome: string; valor: string; mudar: (nome: string, valor: string) => void }) {
  return (
    <NativeSelect
      name={nome}
      value={valor}
      onChange={(e) => mudar(nome, e.target.value)}
    >
      <NativeSelectOption value="">—</NativeSelectOption>
      {UFS.map((uf) => (
        <NativeSelectOption key={uf} value={uf}>
          {uf}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
export function FormularioSolicitacao({
  value,
  categoriasIniciais = [],
  devolucao,
  onCancel,
  onSaved,
  onOpen,
}: {
  value?: AnyRow;
  categoriasIniciais?: AnyRow[];
  devolucao?: string;
  onCancel: () => void;
  onSaved: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const [campos, setCampos] = useState<AnyRow>(() => ({
    ...value,
    cnpj: mascaraCnpj(value?.cnpj || ''),
    cep: mascaraCep(value?.cep || ''),
    telefone: mascaraTelefone(value?.telefone || ''),
    urgencia: value?.urgencia || 'normal',
  }));
  const [consultaId, setConsultaId] = useState<string | undefined>(undefined),
    [pronto, setPronto] = useState(Boolean(value)),
    [manual, setManual] = useState(Boolean(value?.nao_verificado));
  const [categorias, setCategorias] = useState<AnyRow[]>([]),
    [selecionadas, setSelecionadas] = useState<string[]>(() =>
      categoriasIniciais.map((c) => c.id),
    );
  const [categoriasProntas, setCategoriasProntas] = useState(false),
    [tentativa, setTentativa] = useState(0);
  const [erro, setErro] = useState(''),
    [erroCategorias, setErroCategorias] = useState(''),
    [erroCep, setErroCep] = useState(''),
    [existente, setExistente] = useState<AnyRow | null>(null);
  const [busy, setBusy] = useState(false),
    [consultandoCep, setConsultandoCep] = useState(false);
  const trava = useRef(false),
    tentativaEnvio = useRef({ corpo: '', chave: '' }),
    sequenciaCep = useRef(0),
    montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setErroCategorias('');
        setCategoriasProntas(false);
      }
    });
    void api('/api/categorias-fornecedor', { signal: controller.signal })
      .then((x) => {
        if (controller.signal.aborted) return;
        const ativas = x.categorias.filter((c: AnyRow) => Boolean(c.ativo));
        setCategorias(ativas);
        setCategoriasProntas(true);
        setSelecionadas((atuais) =>
          atuais.filter((id) => ativas.some((c: AnyRow) => c.id === id)),
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setErroCategorias(errorText(e));
      });
    return () => controller.abort();
  }, [tentativa]);
  const mudar = (nome: string, valor: string) => {
    sequenciaCep.current++;
    setConsultandoCep(false);
    setCampos((atual) => ({ ...atual, [nome]: valor }));
  };
  const consultar = async () => {
    if (trava.current) return;
    trava.current = true;
    setBusy(true);
    setErro('');
    setExistente(null);
    try {
      const x = await api(
        `/api/solicitacoes/cnpj/${campos.cnpj.replace(/\D/g, '')}`,
      );
      if (!montado.current) return;
      const { consultaId: token, ...dadosReceita } = x;
      setCampos((atual) => ({
        ...atual,
        ...dadosReceita,
        cnpj: mascaraCnpj(x.cnpj),
      }));
      setConsultaId(token);
      setManual(false);
      setPronto(true);
    } catch (e) {
      if (!montado.current) return;
      if (e instanceof ApiError && e.details.status === 503 && e.details.codigo !== 'validacao') {
        setManual(true);
        setPronto(true);
        setConsultaId(undefined);
      } else setErro(errorText(e));
    } finally {
      trava.current = false;
      if (montado.current) setBusy(false);
    }
  };
  const consultarCep = async () => {
    const cep = String(campos.cep || '').replace(/\D/g, '');
    if (!cep) return;
    if (cep.length !== 8) {
      setErroCep('Informe um CEP com 8 dígitos.');
      return;
    }
    const atual = ++sequenciaCep.current;
    setErroCep('');
    setConsultandoCep(true);
    try {
      const x = await api(`/api/solicitacoes/cep/${cep}`);
      if (montado.current && atual === sequenciaCep.current)
        setCampos((antes) => ({ ...antes, ...x }));
    } catch (e) {
      if (montado.current && atual === sequenciaCep.current)
        setErroCep(errorText(e));
    } finally {
      if (montado.current && atual === sequenciaCep.current)
        setConsultandoCep(false);
    }
  };
  const enviar = async () => {
    if (trava.current || !pronto || !categoriasProntas || consultandoCep)
      return;
    trava.current = true;
    setBusy(true);
    setErro('');
    setExistente(null);
    const body = {
      ...campos,
      cnpj: campos.cnpj.replace(/\D/g, ''),
      cep: String(campos.cep || '').replace(/\D/g, ''),
      categorias: selecionadas,
      consultaId,
      ...(value ? { expectedRevision: value.revision } : {}),
    };
    const corpo = JSON.stringify(body);
    if (tentativaEnvio.current.corpo !== corpo)
      tentativaEnvio.current = { corpo, chave: gerarChaveRelatorio() };
    try {
      const x = await api(
        value
          ? `/api/solicitacoes/${encodeURIComponent(value.id)}`
          : '/api/solicitacoes',
        { ...corpoJson(value ? 'PUT' : 'POST', body), headers: { 'content-type': 'application/json', 'idempotency-key': tentativaEnvio.current.chave } },
      );
      tentativaEnvio.current = { corpo: '', chave: '' };
      if (montado.current) onSaved(value?.id || x.id);
    } catch (e) {
      if (montado.current) {
        setErro(value ? erroDeRevisao(e) : errorText(e));
        if (e instanceof ApiError && e.details.existente)
          setExistente(e.details.existente);
      }
    } finally {
      trava.current = false;
      if (montado.current) setBusy(false);
    }
  };
  return (
    <div className="patio-page">
      <PageHeader
        back={{ label: '← Chamados', onClick: onCancel }}
        title={value ? 'Corrigir e reenviar' : 'Nova solicitação de cadastro'}
      />
      {devolucao && (
        <div
          role="note"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900"
        >
          <b>Mensagem da devolução</b>
          <p className="whitespace-pre-wrap">{devolucao}</p>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void (pronto ? enviar() : consultar());
        }}
      >
        <fieldset disabled={busy} className="space-y-5">
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3">
              <Field label="CNPJ">
                <Input
                  name="cnpj"
                  inputMode="numeric"
                  placeholder="00.000.000/0000-00"
                  maxLength={18}
                  value={campos.cnpj}
                  readOnly={Boolean(value)}
                  required
                  onChange={(e) => {
                    const cnpj = mascaraCnpj(e.target.value);
                    sequenciaCep.current++;
                    setConsultandoCep(false);
                    setCampos((atual) => ({
                      cnpj,
                      // Mantém apenas dados do pedido que não identificam o fornecedor.
                      atendimento_cidade: atual.atendimento_cidade || '',
                      atendimento_uf: atual.atendimento_uf || '',
                      urgencia: atual.urgencia || 'normal',
                    }));
                    setPronto(false);
                    setManual(false);
                    setConsultaId(undefined);
                    setExistente(null);
                    setErro('');
                  }}
                />
              </Field>
              {!value && (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void consultar()}
                >
                  Consultar
                </Button>
              )}
            </CardContent>
          </Card>
          {manual && (
            <output className="block rounded-lg border p-3">
              {AVISO_MANUAL}
            </output>
          )}
          {pronto && (
            <>
              <Card>
                <CardContent className="space-y-4">
                  <h3 className="text-lg font-semibold">Receita</h3>
                  {manual ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {receitaCampos.map(([nome, label]) => (
                        <Field key={nome} label={label}>
                          <Input
                            name={nome}
                            value={campos[nome] || ''}
                            required={nome === 'razao_social'}
                            maxLength={200}
                            onChange={(e) => mudar(nome, e.target.value)}
                          />
                        </Field>
                      ))}
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Info
                          label="Razão social"
                          value={campos.razao_social || '—'}
                        />
                        {campos.nome_fantasia && (
                          <Info
                            label="Nome fantasia"
                            value={campos.nome_fantasia}
                          />
                        )}
                        <Info
                          label="Situação cadastral"
                          value={
                            <Status
                              value={
                                campos.situacao_cadastral === 'ATIVA'
                                  ? 'concluido'
                                  : 'cancelado'
                              }
                            >
                              {campos.situacao_cadastral || '—'}
                            </Status>
                          }
                        />
                        <Info
                          label="CNAE"
                          value={
                            [
                              formatarCnae(campos.cnae_codigo),
                              campos.cnae_descricao,
                            ]
                              .filter(Boolean)
                              .join(' — ') || '—'
                          }
                        />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Verificado na Receita
                        {campos.consultada_em
                          ? ` em ${dataHoraSolicitacao(campos.consultada_em)}`
                          : ''}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
              {campos.situacao_cadastral &&
                campos.situacao_cadastral !== 'ATIVA' &&
                !manual && (
                  <p role="alert">
                    CNPJ com situação cadastral {campos.situacao_cadastral}.
                    Somente empresas ATIVAS podem ser solicitadas.
                  </p>
                )}
              <Card>
                <CardContent className="space-y-4">
                  <h3 className="text-lg font-semibold">Endereço</h3>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="CEP">
                      <Input
                        name="cep"
                        inputMode="numeric"
                        placeholder="00000-000"
                        maxLength={9}
                        value={campos.cep || ''}
                        onChange={(e) =>
                          mudar('cep', mascaraCep(e.target.value))
                        }
                        onBlur={() => void consultarCep()}
                      />
                    </Field>
                    {enderecoCampos.map(([nome, label]) => (
                      <Field key={nome} label={label}>
                        <Input
                          name={nome}
                          value={campos[nome] || ''}
                          maxLength={
                            nome === 'numero'
                              ? 30
                              : nome === 'cidade'
                                ? 80
                                : 200
                          }
                          onChange={(e) => mudar(nome, e.target.value)}
                        />
                      </Field>
                    ))}
                    <Field label="UF">
                      <SeletorUf
                        nome="uf"
                        valor={campos.uf || ''}
                        mudar={mudar}
                      />
                    </Field>
                  </div>
                  {consultandoCep && <output>Consultando CEP…</output>}
                  {erroCep && (
                    <p role="alert">
                      {erroCep} O endereço pode ser preenchido manualmente.
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardContent className="space-y-4">
                  <h3 className="text-lg font-semibold">Contato e pedido</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Telefone">
                      <Input
                        name="telefone"
                        type="tel"
                        inputMode="tel"
                        placeholder="(00) 00000-0000"
                        maxLength={15}
                        value={campos.telefone || ''}
                        onChange={(e) =>
                          mudar('telefone', mascaraTelefone(e.target.value))
                        }
                      />
                    </Field>
                    <Field label="E-mail">
                      <Input
                        name="email"
                        type="email"
                        maxLength={200}
                        value={campos.email || ''}
                        onChange={(e) => mudar('email', e.target.value)}
                      />
                    </Field>
                    <Field label="Cidade de atendimento (opcional)">
                      <Input
                        name="atendimento_cidade"
                        maxLength={80}
                        value={campos.atendimento_cidade || ''}
                        onChange={(e) =>
                          mudar('atendimento_cidade', e.target.value)
                        }
                      />
                    </Field>
                    <Field label="UF de atendimento (opcional)">
                      <SeletorUf
                        nome="atendimento_uf"
                        valor={campos.atendimento_uf || ''}
                        mudar={mudar}
                      />
                    </Field>
                    <fieldset>
                      <legend className="mb-1.5 text-sm font-medium">
                        Urgência
                      </legend>
                      <div className="flex gap-2">
                        {[
                          ['normal', 'Normal'],
                          ['urgente', 'Urgente'],
                        ].map(([valor, rotulo]) => (
                          <Button
                            key={valor}
                            type="button"
                            variant={
                              campos.urgencia === valor ? 'default' : 'outline'
                            }
                            aria-pressed={campos.urgencia === valor}
                            onClick={() => mudar('urgencia', valor)}
                          >
                            {rotulo}
                          </Button>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset className="space-y-2">
                      <legend className="mb-2 text-sm font-medium">
                        Categorias
                      </legend>
                      {categorias.map((c) => (
                        <label key={c.id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selecionadas.includes(c.id)}
                            onChange={(e) =>
                              setSelecionadas((atual) =>
                                e.target.checked
                                  ? [...atual, c.id]
                                  : atual.filter((id) => id !== c.id),
                              )
                            }
                          />
                          {c.nome}
                        </label>
                      ))}
                      {categoriasProntas && !categorias.length && (
                        <p>Nenhuma categoria ativa.</p>
                      )}
                      {categoriasIniciais.some((c) => !c.ativo) && (
                        <p className="text-sm text-muted-foreground">
                          Categorias inativas serão removidas no reenvio;
                          selecione as categorias atuais.
                        </p>
                      )}
                    </fieldset>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
          {erroCategorias && (
            <div role="alert">
              {erroCategorias}
              <Button
                type="button"
                variant="outline"
                onClick={() => setTentativa((v) => v + 1)}
              >
                Recarregar categorias
              </Button>
            </div>
          )}
          {erro && <p role="alert">{erro}</p>}
          {existente && (
            <p>
              Solicitação em aberto:{' '}
              <a
                className="text-link underline"
                href={`?aba=chamados&solicitacao=${encodeURIComponent(existente.id)}`}
                onClick={(e) => {
                  e.preventDefault();
                  onOpen(existente.id);
                }}
              >
                {existente.codigo} — {rotuloSituacao(existente.status)}
              </a>
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
            {pronto && (
              <Button
                type="submit"
                disabled={busy || consultandoCep || !categoriasProntas}
              >
                {busy
                  ? 'Enviando…'
                  : value
                    ? 'Corrigir e reenviar'
                    : 'Enviar solicitação'}
              </Button>
            )}
          </div>
        </fieldset>
      </form>
    </div>
  );
}
