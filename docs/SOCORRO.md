# Socorro

Abra `Supply Vision.bat` e use **Validar configuração**. Consulte os arquivos em
`privado/operacao/`; os registros de pedidos manuais também aparecem em **Portal → Relatórios**.
**Não apague logs nem bancos durante o diagnóstico.**

## O Portal não responde na LAN

1. Veja na central se está online ou reiniciando.
2. Confirme se abre em `http://localhost:3000` no próprio notebook.
3. Consulte `privado/operacao/portal-erro.log` e `supervisor.log`.
4. Se funciona localmente, o problema é IP ou firewall da LAN.
5. Se reinicia continuamente, ative o modo manutenção, pare a operação e
   preserve os logs.

O supervisor avisa após duas falhas seguidas de saúde de um Portal que já
respondeu. Reinicia após oito falhas consecutivas, respeitando três minutos
desde a partida e desde o último reinício. Não espere recuperação imediata;
consulte o log para saber se houve reinício ou se a falha continua.

## Login informa "Muitos acessos simultâneos" (429)

Aguarde alguns segundos e tente uma vez, evitando cliques repetidos ou várias
abas entrando com o mesmo e-mail. Há limite por e-mail e por instância do
Portal; essa resposta não significa bloqueio da conta por senha incorreta.
Se persistir, consulte os logs do Portal e confira a quantidade de acessos
simultâneos antes de reiniciar a operação. Não altere senhas para liberar a fila.

## O supervisor caiu

Procure `ERRO FATAL` no `supervisor.log` — ele registra a mensagem e a pilha
antes de encerrar. Se o log termina em `Encerrando a operacao.` **sem** essa
linha, foi parada limpa. Se termina sem nenhuma das duas, a máquina foi
desligada ou reiniciada.

Confira também se `status.json` está velho: ele guarda o último ciclo, e um
valor antigo significa supervisor morto, não operação saudável.

## Os Alertas não rodaram

1. Confira `estado.json` e `supervisor.log`.
2. Veja o último `pipeline_*.log` em `privado/alertas/logs`.
3. Confirme se o dia tem agenda configurada.
4. Valide configuração, chave Qlik, acesso dos Alertas ao Portal e conectividade.
5. Na pasta `alertas/`, use `.venv\Scripts\python.exe processo\pipeline.py --sem-envio` para gerar uma prévia diária sem enviar e-mail durante o suporte.

## Os Alertas têm menos linhas comparadas que a extração

Confira as contagens de quarentena no log e os arquivos de pendências gerados.
Quantidade inválida ou não positiva, preço/data inválidos, acordo ambíguo e
dimensão pendente excluem linhas da comparação, sem classificá-las como
divergência de preço. O e-mail só destaca pendências acima de 50% das linhas
brutas; sua ausência não comprova que todas as linhas foram comparadas.
Veja [Quarentena dos Alertas](OPERAR.md#quarentena-dos-alertas).

## Os e-mails pararam

1. Verifique o estado **E-mails** na central.
2. Consulte `privado/operacao/emails-erro.log` e
   `privado/portal/logs/portal-email.log`.
3. Valide o SMTP sem imprimir a senha.
4. Não reenvie manualmente antes de conferir a fila, para não duplicar.

## O backup não chegou

1. Consulte `supervisor.log` e o horário em `estado.json`.
2. Use **Testar backup** na central.
3. Confira o acesso ao `BACKUP_NETWORK_DIR` — credencial de rede que não
   sobrevive a reinício é causa comum.
4. Se o backup estiver inválido, **não sobrescreva o banco atual**.

## Espaço em disco baixo

A central mostra o espaço livre e o supervisor registra alerta abaixo de
`ESPACO_MINIMO_GB`. A limpeza diária já apaga o que passou da retenção. Para
lixo estrutural, rode `scripts\faxina.ps1` (com a operação parada, para que ele
também recolha o rastreamento do wrangler).

## Alertas param com "HTTP Error 401" ao carregar os acordos

O `PORTAL_API_TOKEN` é entregue ao Portal em tempo de execução, a partir do
mesmo `portal.env` que os Alertas leem — então os dois lados enxergam o mesmo
valor e trocar a credencial não exige mais recompilar.

Resta uma forma de eles discordarem: **chave repetida no `portal.env`**, com
duas linhas `PORTAL_API_TOKEN` de valores diferentes. A **Validar configuração**
da central recusa isso, e o build também.

```powershell
$arq = (Resolve-Path '.\privado\portal\configuracao\portal.env').Path
@(Get-Content $arq | Where-Object { $_ -match '^\s*PORTAL_API_TOKEN\s*=' })
```

Deve aparecer uma linha só. Se aparecerem duas, apague a sobrando e reinicie a
operação — não é preciso recompilar.

Se a linha é única e o 401 persiste, o Portal em execução subiu por um caminho
que não entrega a credencial. Pare e inicie a operação pela central: quem
repassa é o `portal/scripts/iniciar-portal.mjs`, usado pelo `start:lan`.

## Recuperar a instalação do zero

Se o notebook morrer, o caminho é o mesmo da primeira instalação:
`git clone`, restaurar uma **semente completa** e executar `INSTALAR.bat`.
O backup automatico do Portal contem somente SQLite: nao substitui a semente,
que inclui configuracao, parametros e estado persistente dos envios e slots.

Prepare a semente com a operacao parada (`scripts/preparar-semente.ps1`) e
mantenha uma copia protegida fora do computador. Ela contem credenciais e dados
empresariais; nao publique nem envie por canal aberto. Atualize-a quando mudar
configuracao ou parametros. Para recuperar um banco mais recente, restaure-o
pelo procedimento de backup, com a operacao parada, antes de voltar a operar;
as filas restauradas exigem conferencia manual. Confira tambem os slots e
entregas posteriores a data da semente, pois seu estado pode estar defasado.
Veja [INSTALAR.md](INSTALAR.md).

Vale ensaiar isso **uma vez**, com calma, antes de precisar.

## Voltar atrás depois de uma atualização

O `atualizar-servidor.ps1` reverte sozinho quando uma etapa falha. Para
desfazer manualmente uma versão que passou nos testes mas se comportou mal:

```powershell
git log --oneline -5
git reset --hard <commit anterior>
cd portal; npm.cmd run build; cd ..
INICIAR.bat
```

O `git reset` não mexe no banco (ele vive em `privado/`, que o Git ignora),
mas isso não quer dizer que o banco esteja como antes: se a versão nova chegou
a rodar, ela pode ter migrado ou gravado dados que a versão anterior não
entende. Nesse caso, com a operação parada, restaure também o banco
(`cd portal; node scripts/restaurar-backup.mjs`), escolhendo a cópia de antes
da atualização (`--data AAAA-MM-DD` do dia anterior, se o backup de hoje já
foi refeito pela versão nova).

O `atualizar-servidor.ps1` faz isso sozinho quando reverte uma falha ocorrida
depois de religar a versão nova: guarda `privado/portal/backups/pre-atualizacao.sqlite`
antes da troca e o restaura junto com o código. Se essa restauração falhar,
ele avisa em vermelho e deixa a operação parada — não religue antes de
restaurar o banco.

## Reconciliação depois de um incidente

Se as duas instalações chegaram a operar no mesmo período, preserve sem
sobrescrever: banco do Portal, relatórios e recortes gerados, previews de
e-mail e os logs. Compare os chamados criados ou alterados no intervalo antes
de escolher qual banco volta a ser oficial. **Não substitua um banco por outro
apenas pela data do arquivo.**

Nunca mantenha duas instalações enviando e-mails ou processando Alertas ao
mesmo tempo.

Ao final, registre horário, sintoma, ação tomada e arquivos preservados.

## Relatórios indisponíveis no Portal

1. Confira se a operação foi iniciada na central e se o serviço aparece disponível na aba.
2. Consulte `privado/operacao/relatorios-erro.log` e `relatorios-saida.log`.
3. Confira Python em `alertas/.venv/Scripts/python.exe`, `PORTAL_API_TOKEN` e se a porta interna está livre (padrão 3001).
4. Se a tarefa falhou por execução concorrente, aguarde a rotina automática terminar.
5. Depois de reinício ou falha SMTP, confira a entrega antes de pedir novamente; não há reenvio automático.
6. Recortes são exclusivamente para download. Após 24 horas, a aba indica **Arquivo expirado**; gere outro recorte se precisar do arquivo. O serviço exclui arquivos vencidos em verificações de até um minuto quando a operação está ativa.

## Estado da agenda interrompido

O supervisor grava `privado/operacao/estado.json` por substituição atômica e
mantém `estado.json.anterior`. Se o JSON estiver inválido, bloqueia a partida:
não apague o arquivo para "resolver", pois isso pode repetir alertas.
Com a operação parada, compare a cópia anterior com os logs de envio e os slots
concluídos. Reconstitua e valide o JSON antes de reiniciar; a cópia anterior pode
não conter a última entrega e não deve ser restaurada automaticamente.

## Antivirus bloqueou arquivos ou aparece write EOF

No Bitdefender, peça à TI a exclusão da pasta completa da instalação no
**antimalware em tempo real** e no **controle avançado de ameaças**. Restrinja a
escrita nessa pasta: a exclusão reduz a proteção do antivírus. O Supply Vision
não muda essas configurações.

`Permission denied`, `unable to unlink` e arquivos `D` no `git status` podem
indicar arquivos bloqueados ou apagados. Confira a quarentena e os eventos do
antivírus. Se um arquivo ficar travado, **reinicie a máquina** depois de ajustar
a exclusão; tentar novamente sem reiniciar pode continuar falhando. Preserve
`privado/` e solicite ajuda à TI para recuperar arquivos do código aprovado.

Se o Wrangler mostrar apenas `write EOF`, confira o Microsoft Visual C++
Redistributable 2015+ x64 e execute novamente o instalador: ele testa o workerd e
explica se o motor não consegue iniciar. Reinicie após instalar o runtime se
necessário. No PowerShell use `npm.cmd`, pois `npm.ps1` pode ser bloqueado pela
política padrão. Para parar a operação, use a central, não o Agendador.

## A conta da tarefa não consegue entrar

A central e a homologação mostram erros de usuário/senha, senha expirada ou falta
do direito de executar tarefas em lote. Abra PowerShell como administrador e rode:

```powershell
.\scripts\configurar-inicializacao.ps1 -Modo computador -ContaPersonalizada
```

Informe novamente a conta e a senha. Nunca grave a senha em arquivos. Se faltar
permissão de logon em lote, peça à TI a liberação nas políticas locais e do domínio.

Para receber uma verificação diária independente do supervisor, configure
`ADMIN_ALERTA_EMAIL` e execute, como administrador,
`.\scripts\configurar-vigilancia.ps1`. A tarefa opcional **Supply Vision Vigilancia**
roda às 09:00 como SYSTEM, sem senha; verifica a tarefa principal e o health local.
Não altera a conta da operação. Usa o SMTP comum, respeita o modo ensaio e o
limite persistente de um aviso por tipo a cada 60 minutos. Para desligar:
`.\scripts\configurar-vigilancia.ps1 -Desligar`. Sem essa escolha nada muda.

Quando a parada para atualização excede o prazo, a versão ainda não foi trocada:
a tarefa é reabilitada e a retomada solicitada se a operação estava ativa.
A central só considera a parada concluída quando o supervisor e as portas estão livres.
