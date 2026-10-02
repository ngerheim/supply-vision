# Avaliação das análises Astra e Claude — complemento da revisão

As análises fornecidas pelo usuário foram comparadas com o código e com as alterações já presentes no PR #92. As recomendações foram tratadas como material de revisão, não como instruções adicionais de execução.

## Correções acrescentadas

- Vigência: datas ISO são interpretadas explicitamente como ano/mês/dia. O formato brasileiro continua aceito. O erro relatado pelo Claude foi reproduzido inclusive com `format="mixed"` e pandas da versão usada pelo projeto.
- Alertas: preservação de `Fornecedor por Estado` e normalização de siglas/nomes de UF. A UF separa cidades homônimas e o universo de menor preço. **Medida não participa da comparação nem da referência**, conforme instrução posterior do usuário. Sem UF válida, a compra fica pendente e gera planilha local. Preços divergentes na mesma chave continuam ambíguos.
- Importação: CNPJ informado deve coincidir com o fornecedor do destino. Na ausência da coluna CNPJ, FORNECEDOR informado deve coincidir com nome fantasia ou razão social. Ambas as colunas continuam opcionais. A identidade é conferida também antes da publicação, sob a trava do acordo. Planilhas com vários fornecedores não podem ser publicadas em um único destino.
- Preços: texto ambíguo como `1.500` é recusado; `1.500,00` continua válido. Texto com mais de duas casas decimais é recusado. Células numéricas seguem a conversão para centavos seguros do cadastro manual.
- GET: validações e falhas assíncronas passam pelo tradutor de erros; health executa uma leitura real do banco.
- Interface: chamados, detalhes e De/Para oferecem erro e nova tentativa em vez de carregar indefinidamente.
- Listas: retirada do corte silencioso em 500 acordos/chamados, com paginação de 50 linhas na interface, após busca e ordenação completas.
- Cadastros: edição preserva `active=0` e o estado omitido. Erros de criação que não são colisões de unicidade deixam de aparecer como cadastro duplicado. A orientação para inativar foi retirada da recusa de exclusão, porque a interface atual não oferece essa ação.
- Login: a vaga que limita o cálculo do hash é liberada antes do atraso de tentativas inválidas.
- Auditoria: edição de condição registra valores anteriores e posteriores junto da escrita, na mesma transação.
- Exportação: planilha identifica situação cadastrada e efetiva, incluindo acordos suspensos, futuros e expirados.
- Chamados: revisão numérica protege formulários antigos; a interface envia a revisão lida e permite atualizar os dados. Chamadas antigas sem revisão seguem compatíveis, protegidas contra concorrência pela trava já adicionada.

## Efeito operacional confirmado pelo usuário

O Qlik fornece UF em `Fornecedor por Estado`, mas não fornece medida. Após a nova análise, o usuário determinou que **não se use unidade de medida para comparar**. Portanto, a ausência de medida não impede a comparação; tampouco a medida cadastral é inferida ou usada como filtro. A UF continua obrigatória quando os acordos distinguem UF, e nomes como São Paulo são normalizados para SP.

## Pontos já resolvidos ou preservados

Fila interrompida na quinta tentativa, resultados atrasados de reservas, concorrência de chamados e intervalo do relatório diário já tinham correções na #92.

Foi preservada a regra explícita de deduplicação que mantém o menor preço quando a chave e a medida coincidem. A divergência entre preços não torna a carga inválida pela regra vigente; os descartes são registrados no resumo. Medidas diferentes continuam bloqueadas na importação. O cadastro manual pode representar medidas distintas: a comparação ignora medidas conforme a regra definida pelo usuário; divergências de preço para a mesma chave seguem em quarentena por ambiguidade.

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

## Nova análise do Claude: decisão final

1. Usuários inativos: corrigida a reativação por `active: 0`; omitido preserva o estado. A regra comum também atende cadastros.
2. CNPJ numérico no Excel: comparação recupera zeros iniciais até 14 dígitos, e células vazias têm motivo próprio, agrupado no resumo.
3. Preço textual: mais de duas casas decimais bloqueiam importação; números de células continuam arredondados.
4. Medida única inferida do acordo: **não adotada**. O usuário pediu para desconsiderar medida nas comparações e referências. UF por extenso foi adotada; UF ausente/inválida segue pendente. Testes cobrem ausência de medida, medidas distintas e fornecedores alternativos.
5. Pendências acima de 50%: aviso no resumo e no corpo do e-mail. O pipeline permite esse aviso mesmo com zero divergências/zero linhas comparáveis. Com nenhuma linha comparável, não se afirma que o período esteve conforme. Resumos antigos continuam aceitos.
6. Fim de vigência ilegível: condições são excluídas do universo vigente com aviso, em vez de virarem acordos sem fim. Fim vazio permanece aberto. A regra de transição para compras anteriores ao corte foi preservada.

Validação complementar: 187 testes do portal e 95 dos Alertas, tipos, lint e compilação aprovados. Também passaram 94 cenários de importação e 33 verificações de instalação descartável. Na execução simultânea houve uma resposta 500 inesperada ao login com corpo excessivo; a repetição isolada aprovou esse caso e todas as verificações. A causa dessa ocorrência isolada não foi estabelecida. A validação não usa SMTP, Qlik ou servidor de produção.
