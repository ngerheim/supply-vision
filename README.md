# Supply Vision

Pipeline de dados para equipes de compras e manutenção de frota. O sistema
compara ordens de serviço extraídas do Qlik Cloud com acordos comerciais e
mostra três grupos de resultado: compras com referência válida, compras sem
cobertura encontrada e pendências que impedem uma comparação confiável.

O projeto substitui um cruzamento recorrente em Excel. Python foi adotado para
automatizar a extração, aplicar as mesmas regras em todas as execuções e tornar
falhas de dados explícitas antes da geração dos relatórios.

## Entradas e saídas

Entradas principais:

- ordens de serviço do Qlik Cloud;
- `ACORDOS.xlsx`, com fornecedores, cidades, modelos, itens e preços de
  referência;
- filtros e mapeamentos de nomes equivalentes (de-para) em `parametros/`.

As saídas atendem a finalidades diferentes:

| Resultado | Uso |
|---|---|
| Com referência válida | compara preço comprado e preço do acordo; classifica como `CONFORME`, `ACIMA DO ACORDO` ou `ABAIXO DO ACORDO` |
| Sem cobertura encontrada | informa em qual dimensão a combinação deixou de encontrar correspondência e orienta revisão comercial ou cadastral |
| Pendência de referência | separa acordos ambíguos ou sem preço válido; essas linhas ficam fora dos indicadores de conformidade |

São gerados até três arquivos por execução: `com_acordo`, `sem_acordo` e
`pendencias`. Também é produzido um CSV operacional `qualidade_acordos` com
todas as pendências encontradas na base de referência, mesmo quando não houve
compra correspondente no período.

As pendências não são tratadas como compras sem acordo. Sem uma referência
confiável, o pipeline não calcula diferença de preço nem atribui
não-conformidade.

## Fluxo técnico

```text
Qlik Cloud -> extração paginada -> validação da base -> normalização
           -> filtros -> cruzamento com acordos -> relatórios
                                                -> e-mail no fluxo diário
```

1. `processo/qlik.py` seleciona o período no Qlik e pagina o resultado.
2. `processo/contrato_base.py` valida as colunas exigidas e prepara a base.
3. `parametros/` carrega filtros e de-para, normaliza chaves e rejeita colisões
   com destinos diferentes.
4. `processo/rodar.py` cruza CNPJ, cidade, modelo e item, classifica o resultado
   e gera as planilhas.
5. `processo/pipeline.py` orquestra a execução diária; `panorama/` reutiliza o
   mesmo motor para períodos históricos.

## Regras de classificação

Quando não existe correspondência exata, o motivo segue uma ordem hierárquica:

| Motivo | Interpretação |
|---|---|
| Fornecedor sem acordo | o fornecedor não aparece na base de acordos |
| Cidade sem acordo | o fornecedor aparece, mas não na cidade analisada |
| Modelo sem acordo | fornecedor e cidade aparecem, mas não para o modelo |
| Possível item a mapear | o item não aparece em nenhum acordo; é candidato à revisão do de-para, não prova de erro cadastral |
| Item sem acordo | o item existe em outros acordos, mas não na combinação analisada |
| Item não comparável | a curadoria registrou que não há equivalente aplicável |

Duas situações são isoladas como pendências de referência:

| Estado | Critério |
|---|---|
| `ACORDO AMBÍGUO` | a chave possui mais de um preço válido e o pipeline não dispõe de uma dimensão que determine qual deve ser usado |
| `ACORDO SEM PREÇO VÁLIDO` | a chave existe, mas todos os preços são nulos, zero ou negativos |

Esses estados indicam que a comparação é inconclusiva. A correção pode exigir
ajuste cadastral, revisão da chave de negócio ou investigação da base de
acordos.

## Salvaguardas implementadas

O código interrompe a execução quando encontra, entre outros casos:

- coluna obrigatória ausente ou página incompleta na extração;
- configuração ou arquivo de parâmetros ausente;
- queda anormal na quantidade de parâmetros carregados;
- colisão de chaves normalizadas com destinos diferentes;
- período inválido, invertido ou futuro;
- relatório esperado pelo pipeline, mas ausente no momento do envio;
- segunda execução concorrente, por lock exclusivo do sistema operacional;
- subprocesso que excede `PIPELINE_TIMEOUT_S` (padrão: 1800 segundos).

As mensagens e códigos de saída permitem diagnosticar essas falhas no log. O
verificador local checa se cada execução agendada registrou conclusão, mas não
é um monitor externo: depende do mesmo host, rede e SMTP do pipeline.

## Estrutura

```text
processo/          extração, regras de negócio, relatórios e execução diária
panorama/          execução histórica sobre o mesmo motor
parametros/        filtros e de-para; arquivos reais ficam fora do Git
config/            modelos de configuração e credenciais
tests/             suíte de regressão (pytest)
docs/              guia de operação
dados/             bases extraídas
reports/           resultados diários
reports_periodo/   resultados históricos
executar.bat       entrada para execução manual
```

## Testes

A suíte cobre a normalização de texto, a validação de período, as regras de
classificação, a quarentena de referências e o comportamento do e-mail e do
verificador.

```text
pip install -r config/requirements-dev.txt
python -m pytest
```

Roda também em CI a cada push, em `.github/workflows/tests.yml`.

## Execução

Requisitos: Python 3.11+, acesso ao Qlik Cloud e uma planilha de acordos no
formato esperado.

```text
pip install -r config/requirements.txt
executar.bat debug
executar.bat recorte 01/07/2026 31/07/2026
```

Os arquivos `.exemplo` mostram a configuração e o formato dos parâmetros sem
versionar registros transacionais, credenciais ou parâmetros comerciais
detalhados. O guia completo de configuração, agendamento e monitoramento está
em [`docs/operacao.md`](docs/operacao.md).

## Indicadores

`total bruto` inclui todas as linhas após os filtros. Linhas com acordo
ambíguo ou sem preço válido formam a `quarentena`. O `total elegível` é o total
bruto menos a quarentena; conformidade e ausência de cobertura usam somente
esse denominador. A quarentena é apresentada sobre o total bruto.

Cada execução recebe um `run_id` com segundos e sufixo aleatório, usado nos
logs e relatórios. O alerta de ausência de cobertura acima do limiar aparece
no log, no resumo estruturado e no corpo do e-mail.

## Limitações atuais

- O verificador não cobre queda do próprio host, da rede ou do SMTP.
- Uma execução completa depende do Qlik Cloud e da planilha de acordos externa.

## Licença

Este repositório é publicado como portfólio profissional. Leitura, estudo e
citação com atribuição são permitidas; uso, cópia e obra derivada exigem
autorização prévia. Consulte [`LICENSE`](LICENSE).
