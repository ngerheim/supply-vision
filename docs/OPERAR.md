# Operar

Um supervisor residente acompanha todos os módulos enquanto o notebook estiver
ligado e o usuário operacional conectado. Não há tarefa agendada do Windows.

Supervisionados: Portal na LAN, fila de e-mails, pipeline dos Alertas, backup
do banco e limpeza diária.

## Central

`Supply Vision.bat` mostra o estado e oferece iniciar, parar, atualizar o
sistema, abrir o Portal e os registros, validar a configuração, testar o
backup, ligar a inicialização automática e o modo manutenção. Ela exibe o
commit em uso e o espaço livre em disco.

O **modo manutenção** mantém Portal e e-mails no ar, mas pausa novos Alertas,
backups e limpezas. Rotinas já iniciadas terminam. Use durante diagnóstico,
atualização e execução paralela.

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

## Backup

Cada horário grava uma versão atual do banco em três vias: local em
`privado/portal/backups/`, no compartilhamento de `BACKUP_NETWORK_DIR` com
conferência SHA-256, e como anexo de e-mail. A troca é atômica. Não há
histórico rotativo, por decisão operacional — o que significa que uma
corrupção lógica se propaga para a cópia seguinte.

## Limpeza

Retenção por idade, com base no timestamp **no nome** do arquivo:

- planilhas e CSV: 24 horas
- logs `.log`: 5 dias

Os arquivos são apagados, não movidos. Arquivo sem timestamp reconhecível no
nome nunca é tocado. Varre `logs/`, `relatorios/diarios/` e
`relatorios/historicos/`, recursivamente.

Para o lixo estrutural (caches, temporários do wrangler), use
`scripts\faxina.ps1` — com `-Executar` para aplicar, e com a operação parada.

## Execução paralela

`alertas\executar.bat` → **Execução paralela (sem enviar e-mail)**. Os
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
