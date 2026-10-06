# Operar

Um supervisor residente acompanha todos os módulos enquanto o notebook estiver
ligado e o usuário operacional conectado. Não há tarefa agendada do Windows.

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

## Relatórios no Portal

Entre como **Administrador** e abra **Relatórios**. O grupo Consulta reúne Buscar
e Manutenção (Power BI); Suprimentos acrescenta Chamados, Acordos, Fornecedores,
Importações, Cadastros e De/Para. Administrador vê todos os grupos.

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

**Falhas ou reinício do serviço não provocam reenvio automático.** Confira os
registros e a entrega antes de fazer uma nova solicitação, sobretudo se o SMTP
já pode ter aceitado o e-mail. Pedidos na fila antes de reiniciar o serviço
(inclusive os vindos de backup) ficam em **Revisão necessária**. Use **Usar estes
parâmetros** para conferir e fazer uma nova solicitação; nenhum backup é alterado. Só há download de arquivos da própria execução;
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

## Agenda

Os horários ficam em `privado/comum/operacao.env`; o modelo é
`compartilhado/operacao.env.example`.

`ALERTAS_HORARIOS` é o padrão. Qualquer dia pode ter agenda própria com uma
chave de sufixo (`SEG`…`DOM`), que tem prioridade. **Valor vazio significa que
o dia não executa.**

Os Alertas executam de segunda a quinta às 08:00, 11:00, 14:00 e 17:00;
na sexta, às 08:00, 11:00 e 14:00. Quando não há dados, nenhuma linha
comparável ou nenhuma divergência de preço, o pipeline conclui normalmente
sem enviar e-mail.

Se o notebook estiver desligado num horário, ao voltar o supervisor executa
**somente o slot mais recente** que ficou pendente — não dispara cópias
atrasadas. Falhas são retentadas após dez minutos, e locks internos impedem
pipelines concorrentes.

> `LIMPEZA_HORARIO` precisa cair dentro da janela em que a máquina fica ligada.
> Fora dela, a limpeza só roda tarde, ao subir, competindo com os Alertas.

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
é informado. O Portal fica fora do ar durante a atualização e as validações;
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

Além da cópia atual, fica um **histórico de 7 dias**: a última cópia de cada
dia, em `privado/portal/backups/historico/portal-AAAA-MM-DD.sqlite` e na mesma
subpasta da pasta de rede. Os dias além da janela são apagados sozinhos. É o
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
- **O relatório é publicado na web.** Quem tiver o link o vê sem passar pelo
  login do Portal. O Portal só evita espalhar o link: ele não fica mais no
  JavaScript da página e só é entregue depois do login. Se ele vazar, exclua o
  código de inserção no Power BI e gere outro; o antigo para de funcionar.
- **Se o relatório for republicado**, o endereço e o identificador da página
  mudam. Os dois ficam em `privado\portal\configuracao\portal.env`, nas chaves
  `PBI_RELATORIO_URL` (o link de *Publicar na web*) e `PBI_PAGINA`. Quando o
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
