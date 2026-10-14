# G0b: concorrência no SQLite e transporte local

Investigação em 14/10/2026, branch da PR #147. Todos os ensaios usam bases
descartáveis e dados fictícios. Não houve acesso ao banco da produção.

## Causas reproduzidas

O Portal nao chama `withSession`, `getBookmark` nem seleciona uma replica.
Antes da correcao, `rawDb()` retornava diretamente `env.DB`, tanto antes quanto
depois da Etapa D. As sessoes de login em `users/sessions` sao outra coisa.
O binding direto tambem cria internamente `D1DatabaseSessionAlwaysPrimary`.
O Miniflare chama `storage.getCurrentBookmark()` em toda consulta, inclusive
SELECT, independentemente de o Portal solicitar uma sessao. Portanto, trocar
`withSession` por binding direto nao resolve: esse ja era o caminho usado.

Uma reserva de escrita externa no SQLite reproduz o erro exato: o bookmark
produz `SQLITE_BUSY`, convertido em `D1_ERROR: Failed to get session commit token: internal error`. Essa reproducao identifica o caminho tecnico e um
gatilho possivel; nao demonstra o gatilho dos episodios naturais da producao.

O usuario informou ausencia de rotinas nos logs em uma janela de tres minutos,
exclusao da instalacao no antivirus e falhas desde 09/10, antes da Etapa D.
Esses dados impedem atribuir as ocorrencias de producao a uma atualizacao de
dependencias ou a uma rotina registrada. Ha heartbeats periodicos no codigo
dos consumidores, mesmo sem usuarios e sem linha de rotina no supervisor.log;
mas nao foi demonstrado que eles coincidiram com as falhas. O gatilho natural
intermitente do workerd permanece sem reproducao neste ambiente Linux.

Os quatro erros de producao passam pelo mesmo caminho de commit token. Isso
e compativel com HTTP 500 rapido do health e das opcoes, mas nao prova que
todos os nove HTTP 500 tenham essa causa. A correcao remove a obtencao de
bookmarks das consultas locais, abrangendo tambem um defeito intermitente
interno dessa funcionalidade, sem repetir leituras ou escritas.

Os dois jobs de `ddf9939` falharam por conexão encerrada: o primeiro na linha 206
(GET de chamados), o segundo na linha 143 (GET de exportação de auditoria).
A mensagem final “Exclusões ... False” engloba o script inteiro. Nos dois logs,
as verificações da trava anteriores à queda passaram e o servidor atendeu o
teste seguinte. A pausa de trabalho síncrono do cliente antes dos GETs foi de
aproximadamente 6–9 segundos.

Com Node 22.23.3, uma pausa síncrona de 6 segundos antes do GET reproduz a
reutilização de socket ocioso encerrado pelo workerd. No Linux aparece também
como `UND_ERR_SOCKET: other side closed`; no Windows apareceu como ECONNRESET.
O health permanece 200, o processo não reinicia e não há erro D1 nesses ensaios.
Com Node 24.19.0, três rodadas com a mesma pausa passaram. Portanto, os dois
sintomas têm mecanismos distintos, embora ocorram no mesmo runtime local.

## Dependências e frequência

A Etapa D mudou wrangler 4.147.0 para 4.149.0, Miniflare
5.20261001.0-alpha para 5.20261006.1-alpha, workerd 1.20261001.1 para
1.20261006.1 e vinext 1.0.1 para 1.1.0. A implementação nova obtém o bookmark
dentro de uma transação assíncrona; a antiga o obtinha depois de uma transação
síncrona. O lock externo também falha na versão antiga: 100/100 leituras, com
“Failed to parse body as JSON ... internal error” em `getCurrentBookmark`.
O timeout de SQLite não pode ser configurado pelo D1: `PRAGMA busy_timeout`
é recusado com SQLITE_AUTH. Reverter dependências não elimina a origem.

| Ensaio no Linux | Antes | Depois |
| --- | --- | --- |
| Script completo, sem pausa artificial, dependências atuais | 0/30 falhas | 0/30 falhas |
| Script completo, Node 22.23.3, cliente ocupado 6 s antes do GET | 30/30 conexões encerradas | 0/30 falhas |
| SELECTs com escritor SQLite externo reservado: 30 rodadas de 20 leituras | 600/600 erros de commit token | 0/600 falhas |
| 1.200 operações D1 simultâneas, sem escritor externo | 0 falhas; 0 violações de PRIMARY KEY | — |

O ensaio sem pausa na versão anterior à Etapa D passou 30/30. Nela, três
rodadas com cliente ocupado também falharam 3/3. O defeito de transporte não
foi introduzido exclusivamente pela atualização. Não houve ambiente Windows
para medir sua frequência natural; os números com pausa são reprodução
controlada da condição observada, não uma estimativa da incidência em produção.

## Correção

O runtime local mantém o workerd para executar o Portal, mas encaminha SQL a
um executor Node em loopback autenticado por token efêmero. O arquivo SQLite,
seu identificador, esquema e caminho persistido permanecem os mesmos. Somente
a criação inicial do arquivo vazio usa D1; em uma base existente, o Portal
não solicita bookmarks ao workerd. O D1 remoto continua usando seu binding.

Em vez de tentar desativar uma API implicita que o Miniflare sempre invoca,
o executor local usa SQLite nativo, `busy_timeout=5000`, consultas parametrizadas e
transações. Escritas do Portal são executadas serialmente no processo; lotes
de escrita adquirem `BEGIN IMMEDIATE` e confirmam ou revertem juntos. Leitores
usam o snapshot WAL sem precisar escrever um bookmark. Os consumidores Node
continuam usando o mesmo banco e as reservas nativas de SQLite.
Não há repetição de operações SQL nem de requisições HTTP em caso de falha.

O proxy local fecha cada conexão após entregar a resposta completa e usa uma
conexão nova com o backend. Isso elimina o reuso do socket expirado, incluindo
clientes Node 22 ocupados no SQLite. Produção e instalação descartável usam o
mesmo `runtime-local.mjs`. A opção de assinatura do IP do login é preservada.
O token SQL não aparece na linha de comando nem fica no bundle; portas internas
ouvem somente em 127.0.0.1.

Os testes de exclusão foram reforçados: oito exclusões simultâneas sob uma
reserva externa devem devolver 409 e preservar o dono; após liberar a reserva,
quatro pedidos simultâneos permitem somente uma exclusão e uma auditoria.
Nenhuma verificação foi removida ou enfraquecida.

## Health e prazo de cinco segundos

`HttpClient.Timeout` solicita cancelamento via timer/agendamento do .NET;
`GetAwaiter().GetResult()` sozinho aguardava a conclusão desse cancelamento.
Sob atraso do ThreadPool ou desagendamento do processo, o tempo de parede pode
exceder o prazo configurado. Isso é compatível com os 72.685 ms sob sobrecarga
às 03:31, mas não prova o agendamento daquele episódio sem um trace do Windows.

A consulta agora também limita a espera com `Task.Wait(prazoMs)` e cancela a
requisição pendente ao vencer o prazo. O teste inclui uma tarefa que nunca
conclui e cujo cancelamento não chega: o supervisor retorna timeout sem
aguardar essa tarefa. Suspensão/desagendamento do próprio processo pelo Windows
continua podendo aumentar o tempo registrado; a medição real não é truncada.

## Reproduzir e validar

Após `npm ci` e `npm run build` em `portal`, usando Node 22:

```sh
node scripts/medir-exclusao-concorrente.mjs --execucoes 30 --saida work/normal
node scripts/medir-exclusao-concorrente.mjs --execucoes 30 --bloqueio-ms 6000 --saida work/ocupado
node scripts/medir-exclusao-concorrente.mjs --execucoes 1 --completo --saida work/integracao
```

`--direto` permite comparar com o workerd sem o runtime local. Cada execução
cria uma base nova; não repete pedidos falhos. A pausa opcional pertence somente
ao ensaio diagnóstico. `--completo` inclui health/opções durante reserva de
escritor externo, falhas de banco com rollback, perfis/relatórios e HTTP em fluxo.
Tambem foram executadas 600 chamadas ao health em 30 ondas com ociosidade,
sem escrita externa durante esse trecho, contra o binding D1 direto e contra
o executor local. A ausencia de erro nesse ensaio curto nao estima a
incidencia de aproximadamente 15 falhas/dia informada da producao.

Os logs e o resumo JSON ficam no diretório solicitado, com dados descartáveis.

Validação local adicional: build, lint, typecheck, suite do Portal e testes
PowerShell de health, atualização segura e central responsiva. WinForms real e
Windows PowerShell 5.1 não foram exercitados neste ambiente Linux. Não aguardar CI.
