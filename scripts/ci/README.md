# Atualizacao real (H2)

O job `Atualizacao real` roda em PRs, Windows e PowerShell 5.1. Para reproduzir
num Windows descartavel com Node e Python instalados:

```powershell
$env:SV_TESTES_INTEGRACAO_WINDOWS = '1'
./scripts/testar-atualizacao-real.ps1 -BaseRef origin/main -DestinoRef HEAD
```

O harness calcula `git merge-base origin/main HEAD`, monta uma instalacao `main`
nesse commit e instala/builda suas dependencias. O remoto e outro clone local
do checkout da PR; `origin/main` nele oferece o destino esperado pelo atualizador.
O script da base executa `atualizar-servidor.ps1` sem parametros internos, incluindo
a reexecucao pelo codigo novo. Nao ha mocks nem bypass de build/suites.

Toda configuracao e dado pertence a uma pasta `sv-h2-*` nova em TEMP. Ensaio,
SMTP em loopback, avisos desligados, backup de rede vazio e agenda ja concluida
impedem envios e consultas Qlik. Supervisor, Portal e consumidores sao reais;
runner elevado usa a definicao SYSTEM do servidor. Sem elevacao usa modo login.
A tarefa preexistente nunca e substituida.

O monitor independente registra health, PID/estado do supervisor e heartbeats dos
consumidores a cada 500 ms (cada pedido HTTP tem prazo de 2 s). Exige as fases na
ordem, operacao no ar em PREPARAR/CONCLUIR e parada observada somente em TROCAR.
Depois confere login/sessao reais, dados ficticios, integridade/chaves estrangeiras,
migracoes do codigo de destino e limpeza do preparo. Antes do sucesso, a fixture
remove o marcador/indices da migracao 7 para comprovar sua execucao na nova partida.
A parada observada e o resumo do atualizador aparecem no log, sem corte por tempo.

O negativo vem primeiro: um commit apenas no remoto descartavel reprova a criacao
da configuracao de teste no PREPARAR, antes de copiar dependencias ou compilar.
Exige health/consumidores continuos, mesmo PID, HEAD e checkout intactos, hashes
iguais de artefatos/configuracao e dados preservados. Logs, sessoes e heartbeats
sao estado dinamico esperado e ficam fora da comparacao de arquivos estaveis.

Estimativa inicial com caches npm/pip: 5–8 minutos, a confirmar no runner.
O pai limita o cenario completo a 20 minutos e informa a ultima fase se travar;
cada atualizador tem limite de 15 minutos. O job tem limite de 25 minutos,
incluindo setup/diagnosticos. Timeout encerra a arvore de teste e limpa a tarefa
SYSTEM separada. Logs/amostras ficam em artifact por 7 dias; bancos e snapshots
nao sao publicados.

## Isolamento das suites do PREPARAR

O preparador reserva portas locais pelo SO e grava `PORTAL_PORTA` e
`RELATORIOS_PORTA` na configuracao ficticia. Partida, build, health, parada e
restauracao usam essa configuracao. `PORTAL_URL` continua sendo a URL publica;
um proxy HTTPS nao muda a porta local padrao 3000.

`isolamento-preparo.mjs`, carregado pelo comando de testes e herdado pelos filhos,
reprova arquivos/SQLite fora do worktree (inclusive links) e conexoes que nao
pertencam a fixtures com portas reservadas naquele preparo. PID/trava e caches
ficam na mesma raiz descartavel. Nenhuma barreira de restauracao/parada e ignorada;
a ponte SQLite tambem participa da trava de restauracao enquanto mantem o banco
aberto. Fora do PREPARAR, o preload nao muda o processo.

A guarda publica do Git exige que a pasta informada seja a raiz exata do
repositorio: um TEMP sem `.git` dentro do worktree nao pode herdar o Git ancestral
e parecer aprovado. Fixtures com worktree/detached HEAD verificam que arquivos e
commits proibidos continuam sendo detectados.
