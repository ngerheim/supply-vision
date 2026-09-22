# Socorro

Abra `Supply Vision.bat`. Use **Validar configuração** e **Abrir registros**.
**Não apague logs nem bancos durante o diagnóstico.**

## O Portal não responde na LAN

1. Veja na central se está online ou reiniciando.
2. Confirme se abre em `http://localhost:3000` no próprio notebook.
3. Consulte `privado/operacao/portal-erro.log` e `supervisor.log`.
4. Se funciona localmente, o problema é IP ou firewall da LAN.
5. Se reinicia continuamente, ative o modo manutenção, pare a operação e
   preserve os logs.

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
4. Valide configuração, chave Qlik, planilha de acordos e conectividade.
5. Use `alertas\executar.bat paralelo` para testar sem enviar e-mails.

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
`git clone`, restaurar a semente a partir do backup — que chega por e-mail e
está replicado na rede — e `INSTALAR.bat`. Veja [INSTALAR.md](INSTALAR.md).

Vale ensaiar isso **uma vez**, com calma, antes de precisar.

## Voltar atrás depois de uma atualização

O `atualizar-servidor.ps1` reverte sozinho quando uma etapa falha. Para
desfazer manualmente uma versão que passou nos testes mas se comportou mal:

```powershell
git log --oneline -5
git reset --hard <commit anterior>
cd portal; npm run build; cd ..
INICIAR.bat
```

O banco não é afetado: ele vive em `privado/`, que o Git ignora.

## Reconciliação depois de um incidente

Se as duas instalações chegaram a operar no mesmo período, preserve sem
sobrescrever: banco do Portal, relatórios e recortes gerados, previews de
e-mail e os logs. Compare os chamados criados ou alterados no intervalo antes
de escolher qual banco volta a ser oficial. **Não substitua um banco por outro
apenas pela data do arquivo.**

Nunca mantenha duas instalações enviando e-mails ou processando Alertas ao
mesmo tempo.

Ao final, registre horário, sintoma, ação tomada e arquivos preservados.
