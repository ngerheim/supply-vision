# Migrar do notebook para o servidor

Use o assistente somente quando decidir fazer a migração. A instalação atual
continua funcionando como antes até você escolher uma opção de migração.
Peça ajuda à TI quando uma etapa mostrar erro; não apague arquivos para tentar
resolver. O assistente reutiliza a instalação, a semente e a tarefa já existentes.

## Antes de começar: pedir à TI

- Windows 11 Pro 22621 ou mais recente, acesso RDP e conta de administrador.
- Internet e winget disponíveis para instalar Git, Node.js LTS e Python 3.12
  para todos os usuários. Reserve pelo menos 10 GB no disco.
- Nome fictício `portal.empresa.local` apontando para o servidor; Portal em
  `http://portal.empresa.local:3000`.
- Exemplo de backup em `\\servidor-arquivos\pasta\backups`.
  A TI deve conceder escrita à conta do computador
  `DOMINIO\SERVIDOR$`, tanto no compartilhamento quanto no NTFS.
  O assistente testa SYSTEM primeiro; em produção, a conta da tarefa pode ser uma conta de domínio administradora local.
- A conta da tarefa tem privilégios de administradora local. Restrinja quem
  pode editar a instalação; veja [INSTALAR.md](INSTALAR.md).

## Primeiro: fazer um ensaio

1. No notebook, abra a central como administrador. Clique **Preparar migração**.
2. Escolha **Sim — Semente para ensaio**. Escolha uma pasta no pen drive.
   A operação para para copiar o banco de maneira consistente e depois inicia
   novamente. O notebook continua sendo a produção.
3. Leve a pasta inteira ao servidor: o zip, `MIGRAR.bat` e `migrar.ps1`.
   A semente contém banco e credenciais. Proteja o pen drive e não mande os
   arquivos por e-mail, chat aberto ou repositório.
4. No servidor, abra `MIGRAR.bat` e aceite a elevação. O assistente mostra dez
   etapas. Instala os programas ausentes e usa `C:\Projetos\supply-vision`.
5. Escolha **ensaio**. Nas perguntas, confira os valores sugeridos. Enter mantém
   o valor entre colchetes. Informe o endereço e a pasta UNC acima; confira o
   horário da limpeza. Nunca use unidade mapeada, como `Z:\`.
6. Se o teste de rede falhar, peça à TI as permissões acima. Pode escolher
   continuar digitando `SIM`. No ensaio nenhum e-mail nem backup de rede sai.
7. O assistente instala, abre a porta 3000 para a rede local, inicia a tarefa e
   aguarda até três minutos. Leia o relatório na Área de Trabalho. ✅ significa
   que a conferência passou; ❌ pede investigação em [SOCORRO.md](SOCORRO.md).
   Ausência de backups/entregas num ensaio novo pode aparecer como ❌.
8. Reinicie o servidor **sem fazer login**. De outro computador, confira o Portal.
   O teste real de reinício é indispensável, mesmo que o relatório tenha passado.

Se parar no meio, abra o mesmo `MIGRAR.bat`, selecione a mesma semente e a mesma
pasta. O progresso fica ao lado da instalação (`supply-vision.migracao.json`),
e as etapas concluídas são puladas. Nada é apagado. Se o clone iniciado pelo assistente ficar parcial, ele é movido para uma pasta
`clone-incompleto` ao lado da instalação; somente a etapa incompleta é repetida.
Pastas desconhecidas ou com dados privados são recusadas: preserve-as e peça
ajuda à TI para escolher outro destino.
Os registros ficam em `privado/operacao/migracao.log` assim que a semente é
restaurada, incluindo a lista das etapas anteriores concluídas. Não edite o
arquivo de progresso. Uma execução já concluída não refaz a homologação; para
um relatório novo execute `scripts/homologar.ps1`.

## Troca definitiva

1. No servidor de ensaio, abra o assistente e escolha explicitamente
   **Descartar instalação de ensaio** (digite `DESCARTAR`). Alternativamente:
   `powershell -ExecutionPolicy Bypass -File scripts\migrar.ps1 -DescartarEnsaio`.
   A tarefa para e é removida; `privado/` é movida para
   `privado.ensaio-<data>-<identificador>`. **Nada é apagado**. A pasta tem dados e
   credenciais: mantenha-a protegida. Essa opção recusa instalações sem
   `MODO_ENSAIO=1`. A fila pendente do ensaio nunca deve virar produção.
2. No notebook, clique **Preparar migração**, escolha **Não — Migração definitiva**
   e confirme a pasta do pen drive. A operação para, prepara a semente e remove
   a inicialização automática desta instalação (tarefa e atalho do usuário).
   O marcador `privado/operacao/migrada.sinal` bloqueia novas inicializações.
3. Leve os três arquivos novos ao servidor. Execute novamente `MIGRAR.bat` e
   escolha **definitiva**. O assistente restaura a nova semente e grava
   `MODO_ENSAIO=0`. Confira as mesmas perguntas, o relatório e o teste de reinício.
4. Somente o servidor deve operar em produção. Não remova o marcador do notebook
   enquanto o servidor estiver em produção.

Para voltar atrás: primeiro pare a operação do servidor e desligue sua
inicialização automática. No notebook, remova **apenas**
`privado/operacao/migrada.sinal`, escolha o modo de inicialização na central
como administrador e inicie. Isso recupera os dados da origem no instante da
semente; alterações feitas no servidor depois da troca exigem avaliação antes
por alguém responsável pelo banco. Confira também atalhos de outros usuários.

## Pasta de instalação diferente

Abra PowerShell como administrador, na pasta dos arquivos levados ao servidor:

```powershell
.\migrar.ps1 -Destino 'D:\Projetos\supply-vision'
```

O relatório é somente leitura da operação: não envia e-mails, não altera banco,
status, configurações ou backups. Grava apenas o próprio arquivo do relatório,
mas a disponibilidade da pasta de rede é conferida com a conta da sessão RDP;
o teste de escrita como SYSTEM é a etapa separada do assistente. Ele mascara
segredos e e-mails, omite dados das entregas e mostra só as últimas dez linhas
dos logs operacionais. A presença de um backup não comprova sua integridade;
use a opção **Testar backup** da central para isso.

## Antivirus antes do ensaio

Se houver Bitdefender, peça à TI exclusão da pasta da instalação no antimalware
em tempo real e no controle avançado de ameaças. A etapa 1 mostra um lembrete;
não altera o antivírus. Proteja a escrita nessa pasta, pois a exclusão reduz sua
proteção. `Permission denied`, `unable to unlink` ou arquivos `D` no `git status`
são sinais de possível bloqueio/quarentena. Arquivo travado exige **reiniciar a
máquina** depois de ajustar a exclusão. Consulte SOCORRO antes de retomar.

## Conta de dominio para a tarefa

O assistente tenta gravar um arquivo de teste como SYSTEM na pasta de backup e
o remove. Se falhar, você pode escolher **CONTA** e informar uma conta de domínio
na janela de credenciais. Outra tarefa temporária testa essa conta antes da
configuração definitiva. A senha não vai para arquivos, logs nem checkpoint.
Ao retomar, pode ser necessário informá-la novamente.

**Se a senha da conta mudar, reconfigure a tarefa.** Pela central, pare a operação
e aguarde encerrar. Em PowerShell como administrador, na pasta da instalação:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\configurar-inicializacao.ps1 -Modo computador -ContaPersonalizada
```

Informe a senha nova, aguarde o ajuste das permissões e a mensagem de sucesso.
Inicie pela central e confira o Portal e o backup. Para voltar a SYSTEM depois
que a TI liberar a conta de computador no compartilhamento e no NTFS, repita o
comando **sem `-ContaPersonalizada`**. Consulte OPERAR.
