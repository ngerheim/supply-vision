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

## Salvaguarda e compatibilidade do acesso local

`PORTAL_BANCO_LOCAL=sqlite|d1` é lido de `portal.env` pelo launcher; ausente
ou vazio significa `sqlite`. Valor inválido impede a partida. Para trocar,
pare a operação, edite o arquivo e inicie novamente: não há rebuild ou conversão.
No modo `d1`, o launcher não cria servidor SQL e limpa porta/token do adaptador;
as consultas voltam a `env.DB`, mantendo o proxy HTTP corrigido.

O Portal continua no processo workerd, iniciado pelo Wrangler (Node). Em
`sqlite`, `lib/database.ts` seleciona `lib/sqlite-local.ts`: SQL parametrizado,
valores e lotes chegam por HTTP autenticado a uma porta efêmera de loopback.
O servidor `scripts/sqlite-local.mjs`, no mesmo processo Node do launcher
`iniciar-portal.mjs`/`runtime-local.mjs`, executa `node:sqlite.DatabaseSync`.
Não é um módulo SQLite carregado dentro do workerd. Somente a criação de uma
base inexistente passa pelo D1, para preservar sua identidade original; o
binding permanece declarado e pode manter uma conexão após essa inicialização.
As consultas do Portal em uma base existente não passam por ele em `sqlite`.

Não existe um único processo abrindo o arquivo: consumidores de emails e
relatórios e expurgo continuam usando conexões Node independentes. O backup
abre a origem somente para leitura e gera uma cópia consistente por `VACUUM INTO`;
a restauração exige operação parada. A homologação consulta HTTP e seu diagnóstico
de entregas abre o banco somente para leitura. Arquivo SQLite e caminho
`estado/state/v3/d1/miniflare-D1DatabaseObject/<identidade>.sqlite` não mudam.

O executor serializa suas consultas síncronas; a coordenação com os outros
processos cabe aos locks do SQLite. WAL permite leitores durante escrita, mas
apenas um escritor efetivo por vez. Executor, consumidores e expurgo usam
`busy_timeout=5000`; backup não passa a herdar esse timeout. Transações de
escrita dos lotes, reservas das filas e expurgo usam `BEGIN IMMEDIATE`.
As travas de negócio permanecem atômicas pela chave primária, dono e validade
na tabela `travas`, com revisões preservadas. Dois processos podem tentar
escrever ao mesmo tempo: o segundo aguarda ou recebe SQLITE_BUSY se o prazo
esgotar; não há promessa de espera ilimitada. A restauração prepara journal
DELETE e agora o executor nativo restabelece WAL na abertura, como o D1 fazia.

`teste-modos-banco-local.mjs` inicia o launcher real com base descartável,
troca apenas `portal.env` em seis partidas e verifica identidade, formato,
integridade, sessão preservada, reaplicação da migração 7 e seus dois índices
em ambos os modos, backup com Portal aberto, expurgo, restauração CLI e
retorno a WAL. Executa também o teste original de exclusões concorrentes em
cada modo, sem novas tentativas. `teste-importacao-stress.mjs` usa o mesmo
runtime, selecionável com `PORTAL_TESTE_BANCO_LOCAL`: 111 verificações passaram
em sqlite e 111 em d1, incluindo rollback, travas e preservação no reinício.

### Medição comparável (D1 anterior → SQLite nativo)

Linux, Node 22.23.3, build idêntico e mesmo arquivo com 505 chamados,
501 acordos e 501 condições sintéticas; mesmo proxy público nos dois modos.
Por rota/modo: 10 aquecimentos e 100 respostas completas sequenciais, sem
outro teste pesado em paralelo. As duas rotas autenticadas usam sessão real.
Não são tempos do servidor Windows de produção nem uma garantia de ganho.

| Rota | Mediana D1 / SQLite (ms) | p95 D1 / SQLite (ms) |
| --- | --- | --- |
| `/api/health` | 9,56 / 9,13 | 13,96 / 13,44 |
| `/api/search/options` | 15,93 / 16,32 | 27,51 / 22,61 |
| `/api/tickets?pageSize=50` | 14,01 / 14,61 | 19,03 / 19,99 |

Neste ensaio os tempos ficaram próximos: health melhorou ligeiramente,
mas as medianas de opções e listagem subiram. A finalidade da troca é retirar
o caminho de bookmarks local, sem prometer menor latência em todas as rotas.

Reproduzir, após build, com a porta 3000 livre:

```sh
node --experimental-strip-types scripts/teste-modos-banco-local.mjs work/modos
PORTAL_TESTE_BANCO_LOCAL=sqlite npm run test:imports
PORTAL_TESTE_BANCO_LOCAL=d1 npm run test:imports
```

Validação adicional desta salvaguarda: 381 testes passaram, 3 foram ignorados,
nenhuma falha; lint, typecheck e build concluídos. Testes de integração acima
usaram Node 22 em Linux; não substituem homologação no Windows.


## Encerramento e regressões do CI Windows

O cenário `testar-supervisor-isolado.ps1` original substitui o launcher por
um Node fictício: não abre a ponte SQLite nem o workerd. Não foi possível
reproduzir neste executor Linux a parada de 14 minutos da primeira execução
Windows. A execução posterior consultada concluiu os dois cenários em cerca
de 43 e 41 segundos; falhou depois na verificação textual do relançamento.
Não há evidência para atribuir aquele travamento à ponte. Havia, entretanto,
`WaitForExit()` sem prazo no teste, que pode esperar EOF dos leitores de stdout
mesmo com o pai já encerrado, se um descendente herdou os pipes. A chamada agora
é limitada. Um processo externo aplica prazo de 300 segundos ao cenário inteiro,
inclusive preparação e limpeza, informa a fase a cada 30 segundos e encerra a
árvore em caso de timeout. A regressão verifica processo que nunca conclui e
pai encerrado com descendente mantendo stdout aberto. Um bloqueio provocado
no cenário completo também falhou com fase explícita dentro do prazo de 1 segundo.

Separadamente, o runtime tinha um defeito de encerramento reproduzível:
`processo.kill()` encerrava apenas Wrangler, e o fechamento do DatabaseSync
dependia do evento `close` do servidor HTTP. O ensaio anterior deixou um
descendente resistente vivo e falhou após 5 segundos. Agora a parada fecha
DatabaseSync explicitamente, destrói conexões da ponte/proxy e encerra a árvore
com prazo (taskkill /T no Windows; grupo de processos no POSIX). O launcher
observa `parar.sinal` e perda do PID pai. O supervisor dá dois segundos para
a saída voluntária antes de forçar a árvore, com taskkill limitado a três segundos.
Isso cobre o pedido normal/atualizador e o supervisor morto sem finally.
Se o Windows mata também o launcher à força, nenhum callback JS é garantido:
o sistema operacional libera seus handles; SQLite recupera WAL na próxima
abertura. A existência de -wal/-shm não significa handle preso e não justifica
apagá-los manualmente.

Os seis testes do runtime cobrem sqlite/d1, parada explícita, sinal de parada,
perda de um processo pai real, descendente resistente e POST incompleto. Após
parada verificam porta reutilizável, checkpoint WAL sem escritor ocupado,
integridade, dados preservados e arquivo renomeável. O launcher real passou
novamente as seis partidas da integração, agora encerradas por `parar.sinal`
com limite de seis segundos. O cenário Windows ganhou `-PortalReal -BancoLocal`
e passa a testar supervisor sem login, aviso falho, banco real, handles de
SQLite/WAL/SHM e porta 3000 em ambos os modos no job de instalação. Somente
fixture temporária e consumidores fictícios são usados; porta ocupada é recusada.

O relançamento estava correto: sua chamada passou para dentro de `try`, mas
o teste exigia `& powershell.exe` no início da linha. A verificação agora usa
AST e executa o bloco real de lançamento contra um script substituído no disco,
com argumentos reais, código de saída e restauração de ErrorActionPreference.
O reparo preserva `PORTAL_BANCO_LOCAL` em sqlite e d1; o filho lê a escolha do
arquivo, sem argumento novo de produção.

Os quatro warnings de medição eram esperados: um arquivo bloqueado de forma
permanente produz um aviso, e uma pasta impossível produz três (início/fim/resumo).
O teste os captura e exige exatamente essas quantidades; o log identifica as
falhas provocadas. Casos normais, stdout legado bloqueado, leitura compartilhada,
bloqueio transitório e contexto pai/filho continuam gravando o arquivo próprio.
A implementação da medição não precisou ser alterada.

Validação local: 387 testes do Portal aprovados, três ignorados; lint, typecheck,
build; reparo/reexecução, atualização segura e parada executados nas duas escolhas;
regressões de prazo e pipes herdados. PowerShell 7/Linux e Node 22 foram usados;
O cenário completo Windows com Portal real e PowerShell 5.1 foi adicionado
ao CI, sem aguardar sua execução. Stop-ScheduledTask não foi executado neste
Linux; a perda real do PID pai e a liberação dos handles foram verificadas.
