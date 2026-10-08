# Operar

Um supervisor residente acompanha todos os módulos. No modo atual, ele depende
do usuário conectado. O modo opcional sem login usa uma tarefa agendada do
Windows e continua funcionando depois de sair da sessão RDP.

Supervisionados: Portal na LAN, fila de e-mails, serviço de relatórios manuais,
pipeline dos Alertas, backup do banco e limpeza diária.

## Central

`Supply Vision.bat` mostra o estado e oferece iniciar, parar, atualizar o
sistema, validar a configuração, testar/restaurar backup, ligar a inicialização
automática e o modo manutenção. Portal é acessado pelo endereço da instalação;
registros ficam em `privado/operacao/`. Ela exibe o
commit em uso e o espaço livre em disco.

O **modo manutenção** mantém Portal e e-mails no ar, mas pausa novos Alertas,
backups e limpezas. Rotinas já iniciadas terminam. Use durante
diagnóstico e execução manual. Pedidos manuais do Portal continuam disponíveis;
a pausa não encerra rotinas em andamento e não substitui Parar operação para restaurar o banco.

## Início automático e operação por RDP

A central oferece **Desligado**, **Ao entrar no Windows (atual)** e
**Ao ligar o computador, sem login**. O notebook mantém o modo atual até alguém
escolher outro. Pare a operação antes de mudar; a central pede elevação e
reabre como administrador quando necessário. Escolha o modo novamente na
janela elevada. Ativar a tarefa remove o atalho de login do usuário que a
configurou; ativar login remove a tarefa. A instalação por outros usuários
pode ter deixado atalhos na pasta Inicializar deles: confira esses atalhos.

No modo **Ao entrar no Windows**, ao encerrar o acesso remoto use
**Desconectar**, nunca **Sair**: Sair encerra a operação. A central mostra esse
aviso quando está aberta por RDP nesse modo.

No modo **sem login**, a tarefa **Supply Vision** inicia um minuto após ligar,
sem limite de duração. Se falhar, tenta novamente a cada minuto, até três
vezes. Ela roda como **NT AUTHORITY\SYSTEM** por padrão; não precisa de senha.
A tarefa impede instâncias simultâneas, e a trava de arquivo do supervisor
protege também contra uma tentativa de início pela sessão do usuário.

**Iniciar operação** dispara a tarefa. **Parar operação** grava o sinal e
aguarda o supervisor encerrar de verdade. O status é lido dos arquivos da
operação, inclusive quando o processo está fora da sessão RDP. O usuário que
ativou a tarefa pode iniciá-la e acessar os arquivos; para outros
administradores, abra a central elevada se houver erro de permissão. Se um
processo SYSTEM travar e precisar ser encerrado à força, será necessária
elevação. Não apague a trava nem tente abrir um segundo supervisor.

**Atualizar sistema** no modo sem login exige a central elevada. O atualizador
desabilita a tarefa durante a parada e a atualização, espera o encerramento e
volta a habilitar e iniciar a mesma tarefa ao retomar. As notificações na tela
continuam no modo atual. Sem sessão interativa, a indisponibilidade é registrada
no log e a operação segue; os avisos ao administrador por e-mail continuam
funcionando conforme a configuração e respeitando o modo ensaio.

Para backup em rede, configure um caminho **UNC**, como `\\servidor\pasta`.
Unidades mapeadas (`Z:\`, por exemplo) são reprovadas somente no modo sem login.
A TI deve liberar **DOMINIO\NOMEDAMAQUINA$** (neste servidor,
**LOCFROTAS\PROGRAMASUP$**) no compartilhamento **e** no NTFS. Com conta
personalizada, a permissão deve ser dada àquela conta.

SYSTEM tem acesso amplo à máquina. Proteja a escrita nos scripts e no código:
quem os altera pode executar código como SYSTEM. Veja INSTALAR para a opção
com conta própria e para os parâmetros do instalador.

O teste que confirma este modo é reiniciar o servidor **sem fazer login** e,
de outra máquina, abrir **http://sup.locfrotas.local:3000** após o atraso e a
inicialização. Depois confira os registros pela central em RDP.

## Modo ensaio no servidor novo

O modo ensaio permite testar o sistema no servidor novo enquanto o notebook
continua em produção. Ele vem **desligado**: se `MODO_ENSAIO` estiver ausente
ou valer `0`, a operação continua como antes.

Para ligar, antes de iniciar a operação no servidor novo, abra
`privado/comum/operacao.env` e acrescente uma linha:

```ini
MODO_ENSAIO=1
```

Pare e inicie a operação pela central para aplicar a mudança. Confira o aviso
**MODO ENSAIO — nenhum e-mail ou backup em rede** e, no
`privado/operacao/supervisor.log`, a mensagem **Modo ensaio ATIVO**.
O supervisor passa esse modo aos programas que inicia; eles não precisam
abrir o arquivo de configuração operacional.

Durante o ensaio, os Alertas geram os relatórios sem enviar e-mail, inclusive
nos horários automáticos e nos pedidos do Portal. As notificações de chamados
e os relatórios diários por e-mail ficam pendentes, sem tentativas de envio.
Os avisos de saúde e de expiração da chave também não enviam e-mail. O backup
local é gerado e conferido, mas nenhuma cópia vai para `BACKUP_NETWORK_DIR` e
nenhum comprovante vai por e-mail. Isso evita sobrescrever o backup do notebook
que continua em produção. Os logs registram **ensaio: envio suprimido**.
O Portal, as consultas ao Qlik, os relatórios e as rotinas locais continuam
funcionando. Use uma instalação e uma pasta privada próprias para o ensaio.

Para desligar, use `MODO_ENSAIO=0` (ou remova a linha), depois pare e inicie a
operação. **Ao encerrar o ensaio para instalar em definitivo, pare a operação
e descarte toda a pasta `privado/` usada no ensaio antes da instalação
definitiva.** A fila de e-mails pendentes do ensaio não pode ir para a
produção: desligar o modo com essa fila presente permitiria enviar mensagens
de teste. Preserve apenas o que precisar do diagnóstico fora dessa pasta;
não reaproveite o banco, as filas ou a configuração do ensaio na instalação
definitiva. Não apague a pasta privada do notebook em produção.

Comandos avulsos, iniciados fora do supervisor, precisam receber o modo no
próprio PowerShell antes de executar qualquer rotina:

```powershell
$env:MODO_ENSAIO = '1'
```

Para sair desse modo em um terminal de testes, use `$env:MODO_ENSAIO = '0'`.
Isso não altera uma operação já iniciada: para ela vale parar e iniciar pela
central, com o arquivo configurado.

## Avisos por e-mail para o administrador

Os avisos na tela continuam existindo. Para receber também por e-mail, abra
`privado/comum/operacao.env` e acrescente, com seus endereços:

```ini
ADMIN_ALERTA_EMAIL=administrador@example.com,outro@example.com
```

Use vírgula para separar mais de um endereço. Pare e inicie a operação pela
central após alterar. A chave ausente ou vazia mantém o recurso desligado,
sem tentativa de envio. Para desligar, remova a linha ou deixe
`ADMIN_ALERTA_EMAIL=` e reinicie a operação.

Os avisos usam o SMTP já configurado em `privado/comum/smtp.env` e cobrem:

- Portal deixou de responder, após as mesmas duas falhas do aviso na tela;
- início da recuperação automática do Portal;
- falha de backup;
- falha dos Alertas ou entrega que exige revisão;
- espaço em disco abaixo de `ESPACO_MINIMO_GB`;
- partida do supervisor, no máximo uma tentativa por inicialização.

Cada tipo de evento permite no máximo uma tentativa de e-mail a cada
60 minutos. O controle fica em `privado/operacao/avisos-admin.sqlite` e
sobrevive a reinícios. Falhas e resultados incertos também consomem essa
janela, para evitar mensagens repetidas. Não apague o controle para forçar
reenvio. Os avisos acompanham os pontos já existentes do supervisor: por
exemplo, o alerta de disco continua sendo registrado uma vez por dia.

O envio acontece separado da operação, com prazo máximo de 60 segundos.
Se falhar ou exceder esse prazo, o supervisor registra no `supervisor.log`
e continua funcionando. Confira esse log se os avisos não chegarem.
O e-mail informa a máquina, data/hora de São Paulo, o ocorrido e a seção
correspondente de `docs/SOCORRO.md`, sem anexar dados, logs ou credenciais.

Com `MODO_ENSAIO=1`, nenhum desses e-mails sai e o log registra
**ensaio: aviso ao administrador suprimido — <evento>**. A supressão não
consome a janela de envio. Esses avisos dependem de o supervisor, a máquina
e o SMTP estarem funcionando; não avisam sobre uma máquina já desligada.

## Perfis e acesso

O grupo Consulta reúne Buscar e Manutenção (Power BI); Suprimentos acrescenta
Chamados, Acordos, Fornecedores, Importações, Cadastros e De/Para.
Administrador vê todos os grupos.

## Relatórios no Portal

Entre como **Administrador** e abra **Relatórios**.

| Operação | Resultado |
|---|---|
| Gerar e enviar relatório | Pipeline diário, com os destinatários configurados; só envia quando há divergências ou pendências |
| Recorte histórico | Datas inclusivas em DD/MM/AAAA; arquivo para download por 24 horas, sem e-mail |

A fila aceita até cinco pedidos aguardando, além de uma execução ativa. Fechar
o navegador não cancela a tarefa. A atualização automática consulta a cada cinco
segundos após a resposta anterior e pausa com a aba do navegador em segundo plano.
Erros temporários desaparecem quando a próxima consulta funciona;
pedidos ainda na fila ou aguardando revisão podem ser cancelados. Repetir a mesma solicitação após
falha de comunicação não cria outro trabalho. Uma rotina automática concorrente
pode ocupar o lock: nesse caso o pedido falha antes de executar; tente depois.

**Execuções interrompidas não provocam reenvio automático.** Confira os
registros e a entrega antes de fazer uma nova solicitação, sobretudo se o SMTP
já pode ter aceitado o e-mail. Pedidos que ainda não iniciaram continuam na fila
após reinício normal. Na restauração de backup ou semente, os pedidos pendentes
ficam em **Revisão necessária**, pois podem ter sido executados depois da cópia.
Use **Usar estes parâmetros** para conferir e fazer uma nova solicitação;
nenhum backup é alterado. Só há download de arquivos da própria execução;
a limpeza pode torná-los indisponíveis após a retenção.

O recorte nunca envia e-mail. Sem dados elegíveis,
nenhum arquivo/e-mail é produzido. A comparação usa os acordos disponíveis no
Portal na execução e a regra de vigência configurada; não reconstrói uma tabela
antiga de preços. Períodos longos podem levar vários minutos.

Itens e modelos extraídos do Qlik são padronizados conforme o De/Para dos
Alertas para reduzir ruídos. Os campos do recorte sempre exibem DD/MM/AAAA,
independentemente do idioma do navegador.

Cada histórico fica disponível por **24 horas a partir da gravação do arquivo**.
A aba mostra a data e hora de expiração (Brasília) junto ao download. Após o
prazo, mostra **Arquivo expirado** e bloqueia o download, inclusive por link direto.
O serviço verifica arquivos vencidos a cada minuto e os exclui, mantendo o
registro da execução. Essa retenção continua no modo manutenção; se a operação
estiver parada, a exclusão retoma quando o serviço for iniciado. Pedidos antigos
sem validade por arquivo usam a conclusão da execução como referência.

O supervisor inicia `portal/scripts/processar-relatorios.mjs`. Ele acessa o
SQLite local e executa o Python instalado em `alertas/.venv`. A ponte de arquivos
escuta **somente 127.0.0.1:3001**, protegida por `PORTAL_API_TOKEN`; o navegador
acessa tudo pela API autenticada do Portal. **Não abra essa porta na LAN.**
Se necessário, `RELATORIOS_PORTA` em `privado/portal/configuracao/portal.env`
altera a porta interna (1024–65535); reinicie a operação depois de mudar.
O serviço é local e não acompanha automaticamente uma futura migração para nuvem.

A limpeza não move para archive: planilhas, CSV e prévias são apagados após 24
horas, logs após cinco dias. Históricos usam a data de gravação; os demais arquivos
usam o timestamp no nome. Arquivos sem timestamp
reconhecido permanecem intocados. Os registros da aba guardam até 64 mil caracteres
por tarefa, e a lista apresenta as últimas 100 execuções.

**Pronto para executar** informa que o serviço executor registrou atividade nos
últimos 30 segundos. Não garante autenticação ou disponibilidade do Qlik/SMTP.
Se ele ficar indisponível, novas solicitações e downloads ficam desabilitados.
O portal funciona por HTTP na LAN; os identificadores dos pedidos usam
`crypto.getRandomValues`, disponível nesse contexto. Uma sessão expirada pede novo
login; a expiração por inatividade é de duas horas, com duração máxima de 12 horas.

As listas tabulares usam a mesma altura (60% da janela, com mínimo de 16 rem),
rolagem interna e cabeçalho fixo. Filtros e paginação continuam fora da área rolável.

O Histórico e sua exportação Excel exibem campos alterados com nomes e valores
legíveis, por exemplo **Preço: R$ 2.028,00 → R$ 2.000,00**. Os registros JSON
originais continuam preservados no banco e no backup. Para registros antigos,
os nomes vêm dos cadastros disponíveis hoje; cadastros excluídos são indicados
como **Cadastro não disponível**, sem mostrar identificadores internos.

**Validar configuração** confere arquivos/chaves obrigatórios, parâmetros da
agenda, programas, build e escrita nas pastas privadas. Não testa autenticação
Qlik/SMTP nem garante acesso à rede. A central apresenta falha se o verificador
retornar erro, sem anunciar aprovação indevida.

## Reinício automático do Portal

Depois de o Portal ter respondido à verificação de saúde, duas falhas seguidas
provocam o aviso **O Portal parou de responder**. O supervisor reinicia o Portal
após oito falhas consecutivas, desde que tenham passado pelo menos três minutos
da partida e três minutos do último reinício. Uma resposta saudável zera a
contagem. A verificação ocorre nos ciclos do supervisor; esses limites não
representam um prazo exato de recuperação.

Essa recuperação reinicia o Portal, sem reiniciar automaticamente uma execução
dos Alertas ou um envio SMTP em andamento. Se a falha persistir, consulte
[SOCORRO.md](SOCORRO.md) e preserve os logs.

## Agenda

Os horários ficam em `privado/comum/operacao.env`; o modelo é
`compartilhado/operacao.env.example`.

`ALERTAS_HORARIOS` é o padrão. Qualquer dia pode ter agenda própria com uma
chave de sufixo (`SEG`…`DOM`), que tem prioridade. **Valor vazio significa que
o dia não executa.**

Os Alertas executam de segunda a quinta às 08:00, 11:00, 14:00 e 17:00;
na sexta, às 08:00, 11:00 e 14:00. Quando não há dados, nenhuma linha
comparável ou nenhuma divergência de preço, o pipeline conclui normalmente
sem enviar e-mail, exceto quando as pendências ultrapassam o limite descrito
em **Quarentena dos Alertas**.

Se o notebook estiver desligado num horário, ao voltar o supervisor executa
primeiro o slot pendente da manhã (<10h), que cobre o dia anterior ou o fim
de semana, e depois o slot mais recente do dia corrente. Slots intermediários
com a mesma cobertura são dispensados. Uma execução concluída libera a próxima
no ciclo seguinte; falhas mantêm o intervalo de dez minutos entre tentativas.
Não há recuperação automática de dias anteriores.

> `LIMPEZA_HORARIO` precisa cair dentro da janela em que a máquina fica ligada.
> Fora dela, a limpeza só roda tarde, ao subir, competindo com os Alertas.

`BACKUP_HORARIOS` define os horários de backup no mesmo arquivo, com os mesmos
sufixos por dia e a mesma regra de valor vazio. O exemplo público usa `18:00`;
para duas cópias diárias, por exemplo, configure `BACKUP_HORARIOS=12:30,17:30`.
Confira o arquivo privado: os horários da instalação podem ser diferentes.
Depois de alterar a agenda, pare e inicie a operação pela central.

## Configuração dos Alertas e do remetente

Edite somente os arquivos em `privado/`; os exemplos versionados não são a
configuração da instalação. Em `privado/alertas/config/cfg_ambiente.txt`:

| Chave | Uso |
|---|---|
| `QLIK_TENANT` | Domínio do tenant Qlik, como `tenant.example.com` |
| `QLIK_APP_ID` | Identificador da aplicação a consultar |
| `QLIK_OBJ_ID` | Identificador do objeto usado na extração |
| `DESTINATARIO_ALERTA` | Destinatário dos avisos de saúde e de expiração da chave; os destinatários dos relatórios ficam em `destinatarios.txt`, na mesma pasta |
| `PIPELINE_TIMEOUT_S` | Limite em segundos para cada subprocesso do pipeline, não para a execução inteira; padrão de 1800 segundos |
| `CORTE_VIGENCIA_ACORDOS` | Data `AAAA-MM-DD` a partir da qual a comparação exige vigência e situação do acordo; padrão `2026-09-18` |
| `CHAVE_QLIK_EXPIRA` | Data real de expiração da chave, em `AAAA-MM-DD`, usada nos lembretes |

Ao renovar a chave, atualize tanto o segredo em `cfg_qlik.txt` quanto
`CHAVE_QLIK_EXPIRA`. A data configurada não renova nem verifica a validade real
da chave. Os lembretes são verificados na rotina das 08:00, aos 30, 15, 7, 3 e
1 dias restantes e quando a data já venceu. Sem essa rotina, não conte com o aviso.

Em `privado/comum/smtp.env`, `EMAIL_FROM_NAME` define o nome visível do
remetente; o endereço continua sendo `SMTP_USER`. Após alterar configurações,
reinicie a operação e use **Validar configuração**. Isso não comprova
conectividade ou autenticação Qlik/SMTP. Não publique esses arquivos privados.

## Quarentena dos Alertas

Linhas com quantidade ausente, inválida, zero ou negativa, preço inválido,
data inválida, acordo ambíguo ou dimensão pendente ficam fora da comparação.
Elas não são divergências de preço e não entram no total elegível usado nos
indicadores. **Sem acordo** é uma classificação distinta e permanece elegível.

O resumo no log registra as contagens de quarentena. Quando sua proporção
ultrapassa **50% das linhas brutas**, o pipeline pode enviar aviso de pendências
mesmo sem divergências de preço, e o e-mail destaca essa proporção. Abaixo desse
limite, não há garantia de aviso por e-mail. As planilhas em
`privado/alertas/relatorios/diarios/pendencias_comparacao/` permitem examinar
as linhas e os motivos; preserve-as antes da retenção de 24 horas.
Corrija a origem dos dados, o De/Para ou o cadastro do acordo conforme o motivo,
e confira uma nova execução antes de considerar a comparação completa.

## Publicar uma melhoria

Desenvolva na máquina de origem, valide, commite e publique. No servidor, abra
`Supply Vision.bat` e use **Atualizar sistema**. A central pede confirmação,
acompanha o processo sem travar a janela e informa o resultado.

Para diagnóstico, o mesmo fluxo pode ser executado pelo PowerShell:

```powershell
.\scripts\atualizar-servidor.ps1 -Simular   # mostra o que viria
.\scripts\atualizar-servidor.ps1            # aplica
```

Ele exige a branch `main` limpa e sem commits locais divergentes, e interrompe
a atualização se não conseguir consultar o repositório remoto. Faz backup antes
de trocar a versão, instala dependências só quando mudaram e roda build e testes.
Falhas nessas etapas acionam a tentativa de retorno ao código e às dependências
anteriores; se o retorno também falhar, a operação permanece parada e o erro
é informado. O Portal fica fora do ar durante a construção. Na validação final, permite
somente consulta: gravações, envios, execuções e limpeza ficam pausados até
a aprovação das verificações de saúde;
reserve uma janela de manutenção, sem assumir duração fixa.

Depois de trocar a versão, o script se relança a partir do código que acabou de
chegar. Sem isso, o PowerShell seguiria executando a versão carregada na
memória, e qualquer correção ao próprio processo de atualização só valeria na
atualização seguinte. Na sequência ele confere a configuração privada: chaves
que passaram a existir nos arquivos de exemplo e ainda faltam em `privado\` são
acrescentadas com o valor do exemplo, e as que entram vazias aparecem como
aviso no fim da etapa — é onde você descobre o que ainda precisa preencher.
Como `privado\` não é versionado, era daí que vinham as reprovações da
validação logo após uma versão passar a exigir uma chave nova.

## Backup

Cada horário grava uma versão atual do banco em `privado/portal/backups/` e,
se `BACKUP_NETWORK_DIR` estiver configurado, no compartilhamento de rede, com
conferência SHA-256. O e-mail de backup sempre sai com o comprovante; o banco
só vai anexado quando não há cópia de rede (por falta de outra cópia fora da
máquina) ou quando `BACKUP_ANEXAR_BANCO=true`. O banco contém hashes de senha
e toda a base comercial, então configurar a pasta de rede é o caminho
recomendado. A troca é atômica.

A cópia local e a réplica na rede são feitas antes de validar o SMTP.
Se a réplica for confirmada, falha no comprovante gera aviso sem invalidar o
backup; sem réplica, falha no e-mail continua sendo erro de redundância.
Além da cópia atual, fica um **histórico de 7 dias**: a última cópia de cada
dia, em `privado/portal/backups/historico/portal-AAAA-MM-DD.sqlite` e na mesma
subpasta da pasta de rede. Também são preservadas as sete cópias diárias mais
recentes, mesmo após uma pausa de mais de sete dias. Só são apagadas cópias
fora da janela que excedam esse mínimo. É o
que permite voltar a um ponto anterior a um erro que já entrou no backup do
dia (um acordo apagado por engano, por exemplo). Para restaurar, a central
oferece a cópia mais recente ou a do último dia anterior; um dia específico
sai por `node portal\scripts\restaurar-backup.mjs --data AAAA-MM-DD`, com a
operação parada.

## Limpeza

Retenção por idade, com base no timestamp **no nome** do arquivo:

- planilhas e CSV: 24 horas
- logs `.log`: 5 dias

Os arquivos são apagados, não movidos. Arquivo sem timestamp reconhecível no
nome nunca é tocado. Varre `logs/`, `relatorios/diarios/` e
`relatorios/historicos/`, recursivamente.

Exceção: em `relatorios/historicos/` a idade vem da data de modificação do
arquivo (mtime), não do nome; o arquivo expira 24 horas depois dela. Além
desta limpeza, o serviço de relatórios do portal apaga os históricos
expirados sozinho, a cada ~60 segundos enquanto está no ar.

Para o lixo estrutural (caches, temporários do wrangler), use
`scripts\faxina.ps1` — com `-Executar` para aplicar, e com a operação parada.

## Histórico de Manutenção

A aba **Manutenção** do Portal não tem carga, banco nem rotina agendada: ela
emoldura a página "Histórico de Manutenção" do relatório publicado no Power BI.
Nada é copiado para cá, e as colunas e os filtros são os do relatório de origem.

Consequências práticas:

- **A atualização não é nossa.** Os dados seguem o agendamento do relatório de
  origem, que hoje atualiza quatro vezes por dia em horários definidos fora do
  Portal. Não há o que reexecutar aqui quando alguém achar o dado velho.
- **Cada máquina precisa alcançar `app.powerbi.com`.** Se o quadro aparecer em
  branco, o problema é acesso à internet do cliente, não o Portal. O botão
  *Abrir em nova aba* confirma o diagnóstico em dois cliques.
- **O modo público foi mantido por decisão da operação.** O Portal aceita links
  de *Publicar na web*, que permitem acesso anônimo também fora do Portal.
  O login do Portal não restringe o acesso ao relatório público. O endereço
  continua somente na configuração privada, sem ser incluído no código versionado.
  Também é aceito *Inserir relatório > Site ou portal*, que exige autenticação,
  permissão e licença adequada no Power BI.
- **Se o relatório for republicado**, o endereço e o identificador da página
  mudam. Os dois ficam em `privado\portal\configuracao\portal.env`, nas chaves
  `PBI_RELATORIO_URL` (o link de *Publicar na web* ou *Site ou portal*) e `PBI_PAGINA`. Quando o
  identificador deixa de casar, a aba abre na primeira página do relatório **sem
  mensagem de erro** — é o primeiro lugar a conferir se alguém reclamar que
  abriu a tabela errada.

Para configurar ou trocar o relatório: edite as duas chaves no `portal.env` e
reinicie a operação pela central. Os valores são lidos quando o Portal sobe;
não é preciso recompilar. Se as chaves estiverem ausentes ou forem
inválidas, a aba informa que o relatório está temporariamente indisponível. O
endereço real nunca deve ser colocado em arquivo versionado.

Para descobrir o `PBI_PAGINA` de uma página: abra o relatório publicado, entre na
página desejada e leia o `pageName` da requisição que o navegador faz — ou peça a
quem mantém o relatório. Ele não é o nome visível da página; é um código como
`09a18dbe4d61132751d1`.

## Execução paralela

Para suporte, a partir de `alertas/`, use `.venv\Scripts\python.exe processo\pipeline.py --sem-envio`. Os
relatórios saem normalmente, a mensagem fica em
`privado/alertas/relatorios/diarios/previews-email` e nenhuma conexão SMTP é
aberta. Útil para conferir o conteúdo antes de um envio real.

## Registros

Ficam em `privado/operacao`, fora do Git: `supervisor.pid.json` identifica a
instância ativa, `estado.json` registra os slots concluídos, `status.json` o
estado do último ciclo e os `.log` apoiam o diagnóstico.

Antes de registrar a instância, o supervisor valida horários, arquivos
privados, SMTP, Qlik, build, ambiente Python e permissões de escrita. Falha
impede a partida e entra no log sem revelar valores sensíveis.

## Alertas com entrega parcial ou incerta

Antes de transmitir ao SMTP, o alerta registra a intenção de envio em
`privado/alertas/estado-envios`. Depois preserva os destinatários aceitos e os
recusados. Se houver recusa parcial, interrupção ou registro inválido, o slot
fica `revisao-entrega` no estado da agenda e não é reenviado automaticamente.
Os outros horários continuam disponíveis; consulte também o log do supervisor.

Confira a entrega com os destinatários e o registro antes de qualquer reenvio
manual. Em entrega parcial, reenvie somente aos recusados. Não apague registros
incertos para liberar a lista inteira: isso pode duplicar uma mensagem aceita.
Uma entrega já confirmada permite completar a agenda após reinício sem novo SMTP.

### Saude exigida apos atualizar

Além de `/api/health`, o atualizador confere identidade, HTML e arquivos CSS/JS
com o verificador de saúde completa. Depois exige estado recente do supervisor
e ciclos recentes dos consumidores de e-mail e relatórios, aguardando até um
minuto para a primeira passagem. Falha aciona a recuperação da atualização.
Esses sinais provam a partida local; não provam entrega SMTP nem acesso ao Qlik.

### Recuperar entregas de relatório diário

A tela de notificações inclui o tipo **Relatório diário**, com destinatário,
intervalo coberto, tentativas e erro. O administrador pode filtrar falhas e
solicitar reenvio após conferir com o destinatário se a mensagem já chegou.
O reenvio mantém o intervalo original; não altera a janela do próximo relatório.
O conteúdo é calculado novamente a partir do histórico e do estado atual dos chamados.
Após restauração de backup ou semente, confira também essas entregas: elas podem
ter sido marcadas como falha para impedir duplicação automática.

### Validação antes de iniciar

A validação operacional confere Python 3.12 ou superior, os quatro filtros
e os cabeçalhos e correspondências dos CSVs de parâmetros. Ela não acessa
Qlik ou SMTP e não atualiza o arquivo de contagens. Arquivos inválidos
impedem a partida, com indicação do parâmetro que precisa ser reparado.

A limpeza atua apenas sobre planilhas, CSV, previews `.eml`, logs e saídas
`saida_rodar_*.txt` com timestamp. Registros de slots agendados com entrega
confirmada ficam por 30 dias; entregas incertas/parciais e registros manuais
são preservados para conferência.


## Limites e preservacao do historico

A exportacao JSON administrativa preserva um snapshot consistente e nao inclui
versoes de acordos em preparacao. Para evitar materializar uma base crescente
sem limite, recusa mais de 10 mil registros por tabela ou mais de 8 MiB de logs
de relatorios. Nao entrega arquivo parcial. O backup SQLite completo continua
sendo o meio de recuperacao de bases maiores.

Auditoria, historico de chamados e identificadores de deduplicacao nao sao
apagados automaticamente nesta versao. Uma politica futura de arquivamento
precisa preservar rastreabilidade e impedir reenvio de entregas antigas.

O login aceita uma tentativa simultanea por e-mail e limita o processamento e
a fila por instancia. Uma resposta 429 pede nova tentativa apos alguns segundos;
nao bloqueia a conta por numero de falhas. Esses limites nao substituem controle
no proxy para ataques distribuidos ou multiplas instancias.

A instalacao LAN documentada usa HTTP: senha e sessao trafegam sem criptografia.
Restrinja o acesso a rede empresarial confiavel. Para trafegar fora dessa rede,
homologue HTTPS no proxy, cookies seguros e a origem do Portal antes de liberar
acesso. Esta correcao nao instala certificados nem altera a rede do servidor.
