# Avaliação das análises Astra e Claude — complemento da revisão

As análises fornecidas pelo usuário foram comparadas com o código e com as alterações já presentes no PR #92. As recomendações foram tratadas como material de revisão, não como instruções adicionais de execução.

## Correções acrescentadas

- Vigência: datas ISO são interpretadas explicitamente como ano/mês/dia. O formato brasileiro continua aceito. O erro relatado pelo Claude foi reproduzido inclusive com `format="mixed"` e pandas da versão usada pelo projeto.
- Alertas: preservação de `Fornecedor por Estado` no contrato da extração. Quando disponíveis, UF e MEDIDA separam os universos de comparação e de menor preço. Não há conversão implícita entre unidades. Sem essas dimensões, a compra fica em quarentena com motivo explícito, fora dos indicadores financeiros e sem recomendação de fornecedor. Uma planilha local é gerada em `pendencias_comparacao`, dentro da pasta configurada para relatórios diários; ela não altera a política atual de anexos de e-mail.
- Importação: CNPJ informado deve coincidir com o fornecedor do destino. Na ausência da coluna CNPJ, FORNECEDOR informado deve coincidir com nome fantasia ou razão social. Ambas as colunas continuam opcionais. A identidade é conferida também antes da publicação, sob a trava do acordo. Planilhas com vários fornecedores não podem ser publicadas em um único destino.
- Preços: texto no formato ambíguo `1.500`/`R$ 2.350` é recusado com orientação; `1.500,00` continua válido. Células numéricas não têm essa ambiguidade. Importação usa a mesma conversão para centavos seguros do cadastro manual.
- GET: validações e falhas assíncronas passam pelo tradutor de erros; health executa uma leitura real do banco.
- Interface: chamados, detalhes e De/Para oferecem erro e nova tentativa em vez de carregar indefinidamente.
- Listas: retirada do corte silencioso em 500 acordos/chamados, com paginação de 50 linhas na interface, após busca e ordenação completas.
- Cadastros: edição preserva `active=0` e o estado omitido. Erros de criação que não são colisões de unicidade deixam de aparecer como cadastro duplicado. A orientação para inativar foi retirada da recusa de exclusão, porque a interface atual não oferece essa ação.
- Login: a vaga que limita o cálculo do hash é liberada antes do atraso de tentativas inválidas.
- Auditoria: edição de condição registra valores anteriores e posteriores junto da escrita, na mesma transação.
- Exportação: planilha identifica situação cadastrada e efetiva, incluindo acordos suspensos, futuros e expirados.
- Chamados: revisão numérica protege formulários antigos; a interface envia a revisão lida e permite atualizar os dados. Chamadas antigas sem revisão seguem compatíveis, protegidas contra concorrência pela trava já adicionada.

## Efeito operacional confirmado pelo usuário

O Qlik fornece UF em `Fornecedor por Estado`, mas **não fornece unidade de medida**. Por isso, ao aplicar esta versão no servidor, as compras dessa extração serão pendências de comparação, e não divergências ou SEM ACORDO. Para retomar a comparação financeira será necessário obter a medida por uma fonte confiável. Não se presume que toda compra use UNIDADE e não se estabelece conversão PAR/UNIDADE sem fator explícito.

## Pontos já resolvidos ou preservados

Fila interrompida na quinta tentativa, resultados atrasados de reservas, concorrência de chamados e intervalo do relatório diário já tinham correções na #92.

Foi preservada a regra explícita de deduplicação que mantém o menor preço quando a chave e a medida coincidem. A divergência entre preços não torna a carga inválida pela regra vigente; os descartes são registrados no resumo. Medidas diferentes continuam bloqueadas na importação. O cadastro manual pode representar medidas distintas: a comparação agora separa essas medidas, em vez de misturá-las.

Não foram reintroduzidos controles de inativação que o usuário havia pedido para remover. A proteção de registros legados inativos foi corrigida na API.

## Melhorias estruturais que permanecem

- Paginação e filtros no servidor: a correção de acessibilidade carrega todas as linhas e pagina na interface. Para bases maiores, transferir paginação, busca e ordenação para consultas no servidor reduz tráfego e memória.
- Versões imutáveis e preços históricos: a auditoria de edição foi melhorada, mas criar uma nova versão em cada alteração e reconstruir preços vigentes na data da compra exige uma definição de negócio e migração próprias. A comparação anterior ao corte de vigência foi preservada.
- Componentes e contratos tipados por domínio: refatoração recomendada, sem uma reorganização ampla nesta revisão.
- Conteúdo imutável do relatório diário: os eventos têm o período correto; totais e dados cadastrais continuam representando o momento do envio, conforme registrado na revisão geral.
- Transporte HTTPS, e-mails/backups remotos, inicialização distribuída e leitura de corpos interrompida por prazo devem integrar a etapa de implantação. O leitor de corpos foi preservado porque os testes HTTP em fluxo cobrem o consumo e a resposta antecipada no runtime atual; cancelá-lo precisa de validação específica nesse runtime.

## Validação

184 testes do portal, 89 testes de Alertas, 94 cenários de importação e 33 verificações de instalação descartável aprovados. Verificação de tipos, lint e compilação aprovados. Regressões incluem datas ISO, UF/medida, preço ambíguo, fornecedor divergente, GET inválido, cadastro inativo, formulário antigo, mais de 500 registros e auditoria de preço.

A primeira execução da instalação revelou que o novo teste de edição não tinha cadastrado a abrangência do acordo sintético; a preparação foi corrigida, e a repetição passou. Não houve envio de e-mails reais, consulta ao Qlik, alteração no notebook-servidor ou publicação. Não foi feita validação visual completa.
