# Instalar em outra máquina

O código vem do Git e o instalador baixa as dependências no destino. Somente a
semente privada precisa ser transferida entre as máquinas.

Não copie a pasta inteira por USB: binários compilados podem não casar com a
outra máquina, e a cópia vem sem vínculo com o repositório, o que obriga a
usar pen drive em toda atualização futura.

## Primeira instalação

**Na máquina de origem:**

```powershell
.\scripts\preparar-semente.ps1 -Destino D:\
```

Pare a operacao na central antes de executar. Gera
`supply-vision-semente-<data>.zip` com um snapshot consistente do banco,
configuracao, parametros e estado persistente de slots e entregas. O script
recusa um supervisor ainda ativo; nao usa um backup antigo no lugar do banco.
Na migracao, mantenha a origem parada ate concluir a ativacao do destino,
para que as duas maquinas nao executem os mesmos slots.

> A semente contém credenciais SMTP, token do Qlik e o banco com preços e
> usuários. Prefira pen drive a e-mail, e apague depois de usar.

**No notebook novo:**

```powershell
git clone <repositorio> C:\Projetos\supply-vision
cd C:\Projetos\supply-vision
.\scripts\restaurar-semente.ps1 -Zip D:\supply-vision-semente-<data>.zip
```

A restauração confere o SHA-256 e a estrutura do banco antes de substituir
configuracoes, recusa se já houver banco no destino e lista os valores que
mudam de máquina. Sementes antigas sem estado persistente exigem conferir
slots e entregas antes de iniciar. Ajuste-os antes de continuar:

| Onde | Chave | Por quê |
|---|---|---|
| `privado\portal\configuracao\portal.env` | `PORTAL_URL` | é o IP desta máquina |
| `privado\portal\configuracao\portal.env` | `BACKUP_NETWORK_DIR` | acesso à rede |
| `privado\comum\operacao.env` | `LIMPEZA_HORARIO` | tem que cair na janela em que a máquina fica ligada |

Os alertas acessam o Portal por loopback quando `PORTAL_URL` usa HTTP, na mesma
porta, para não transmitir o token interno pela rede. `PORTAL_URL` continua
sendo o endereço dos links nos e-mails. Se o Portal estiver em outro servidor,
configure `PORTAL_INTERNAL_URL` com HTTPS e sem redirecionamentos. Isso não
habilita HTTPS para os navegadores; essa proteção depende da infraestrutura.

Depois:

```
INSTALAR.bat
```

Ele instala Node e Python pelo `winget` se faltarem, cria o `.venv`, roda
`npm.cmd ci`, gera o build, executa as suítes e prepara a inicialização
automática. Reexecutar é seguro: não apaga banco, credenciais, parâmetros nem
relatórios.

Para conferir requisitos sem alterar nada: `INSTALAR.bat -SomenteVerificar`.

## Escolher como iniciar no Windows

No notebook atual, nada muda: o instalador sem parâmetro continua criando o
atalho que inicia ao entrar no Windows. Uma tarefa sem login já instalada é
preservada ao reexecutar o instalador sem parâmetro.

Na central, pare a operação e escolha uma das três opções:

- **Desligado:** sem início automático; Iniciar operação continua disponível.
- **Ao entrar no Windows (atual):** usa a pasta Inicializar do usuário.
- **Ao ligar o computador, sem login:** cria a tarefa **Supply Vision**, como
  **NT AUTHORITY\SYSTEM**, com atraso de um minuto após ligar o computador.

Mudar o modo exige **Executar como administrador**. A central oferece reabrir
com elevação; nela, escolha o modo novamente. As opções são exclusivas: a tarefa
remove o atalho do usuário que a configurou, e escolher login remove a tarefa.
Se houve instalação por outros usuários, confira que eles não tenham atalhos
antigos na própria pasta Inicializar.

Para o instalador (PowerShell elevado), use:

```powershell
.\scripts\instalar.ps1 -ModoInicializacao computador
```

Os valores também podem ser `login` e `desligado`. Para trocar somente o modo,
sem reinstalar as dependências:

```powershell
.\scripts\configurar-inicializacao.ps1 -Modo computador
```

Opcionalmente acrescente `-ContaPersonalizada` para a conta definida pelo
administrador. A senha é pedida por **Get-Credential**, passada ao Agendador do
Windows e nunca gravada pelo Supply Vision em arquivo ou log. A TI deve liberar
para essa conta o direito de executar tarefas em lote e o acesso à rede.

No modo sem login, instale Node **22.13 ou superior**, com npm, para a máquina,
e mantenha Python **3.12 ou superior** e o venv em `alertas\.venv`. Prefira uma
pasta local como `C:\SupplyVision`, fora de Desktop e pastas de perfil. A tarefa
usa caminhos absolutos para PowerShell, Node, npm e Python do venv; seus caches
ficam em `privado\operacao\cache`, sem depender do PATH do usuário. A ativação
prepara permissões para SYSTEM, Administradores e o grupo local fixo
**Supply Vision Operadores**. O instalador inclui os administradores e a conta
da tarefa no grupo, preservando membros e permissões anteriores.

**Backup em rede com a conta da tarefa:** use `BACKUP_NETWORK_DIR=\\servidor\pasta`, nunca
uma unidade mapeada como `Z:\`. Em produção com conta de domínio, a TI deve
liberar aquela conta no compartilhamento e no NTFS. Se escolher SYSTEM,
libere a conta do computador **DOMINIO\NOMEDAMAQUINA$**.
Por exemplo, **DOMINIO\SERVIDOR$**. Credenciais `cmdkey` do usuário RDP
não se aplicam à SYSTEM.

**Contrapartida de segurança:** a conta da tarefa tem privilégios de
administradora local.
Quem puder alterar scripts ou código executado pela tarefa poderá executar
código com esses privilégios. Restrinja a escrita na instalação a pessoas de
confiança; não conceda acesso geral. Em produção com conta de domínio, ela também precisa ser administradora local
para gerenciar os processos da instalação. A configuração valida essa condição.

**Teste final no servidor:** reinicie sem fazer login, aguarde o minuto de
atraso e a inicialização, e confirme de outra máquina que
**http://portal.empresa.local:3000** está no ar. Só depois abra RDP para conferir
central, logs e backup. No ensaio, mantenha `MODO_ENSAIO=1`: e-mails e cópia em
rede continuam bloqueados. Consulte OPERAR para descartar os dados do ensaio
antes da instalação definitiva.

## Configuração do notebook servidor

Em ordem de importância:

- **IP fixo ou reserva por MAC no DHCP.** O `PORTAL_URL` aponta para ele; se
  mudar, todos perdem o acesso e os links das notificações quebram.
- **Firewall da LAN na porta 3000.** O instalador não abre. Use
  `portal\scripts\abrir-firewall-lan.ps1`.
- **Energia**: nunca suspender ligado na tomada, tampa fechada sem ação, e no
  BIOS religar após queda de energia. A bateria do notebook funciona como
  nobreak.
- **Credencial persistente** para o compartilhamento de rede (`cmdkey`), senão
  o backup em rede falha depois de reiniciar.
- **Windows Update** com horário ativo cobrindo o expediente.
- **Antivírus**: combine as exclusões com a TI. Para o Bitdefender no servidor,
  siga a seção "Antivirus e motor do Portal" abaixo: a exclusão deve cobrir a
  pasta da instalação nas duas proteções indicadas. Restrinja a escrita nessa
  pasta, pois os `.bat` e `.ps1` são executados automaticamente.
- **Login automático**, se a operação precisar subir sem alguém sentar na
  máquina. Junto com a exclusão do antivírus, são os itens desta lista com
  contrapartida de segurança.

O serviço manual de relatórios usa uma porta interna adicional (padrão 3001),
restrita a localhost. Não exige abertura no firewall da LAN. Após iniciar,
confira **Portal → Relatórios → Pronto para executar** com um administrador.

## Teste que fecha a instalação

Reinicie a máquina e confirme que o Portal sobe sozinho, sem clique e sem
janela de console sobrando. Só depois considere a instalação concluída.

## Versões mínimas e ambientes antigos

O Portal exige **Node.js 22.13.0 ou superior**, com npm. Sem `winget`, instale
Node.js e Python manualmente antes de executar o instalador, e abra um novo
terminal para atualizar o PATH. Confira `node --version`, `npm.cmd --version` e
`python --version`. Uma versão já instalada abaixo do mínimo é recusada;
o instalador não a atualiza automaticamente.

Os Alertas exigem **Python 3.12 ou superior**, inclusive em `alertas/.venv`.
Python 3.11 não instala as dependências atuais. O instalador recusa esse ambiente
antes de preparar arquivos privados, e o atualizador confere o venv antes de parar.

Para uma instalação antiga: instale Python 3.12+, pare a operação, renomeie
`alertas/.venv` para uma cópia de segurança e execute `INSTALAR.bat` usando o novo
Python no PATH. Confira a validação e os testes antes de retomar. Não mova ou
apague `privado/`: banco, configurações e histórico ficam nessa pasta.

Para levar a instalação do notebook para o servidor, siga o
[assistente de migração, com ensaio e troca definitiva](MIGRAR.md).

## Antivirus e motor do Portal

Antes de instalar, peça à TI uma exclusão da pasta completa da instalação no
Bitdefender: **antimalware em tempo real** e **controle avançado de ameaças**.
A exclusão reduz a proteção nessa pasta; restrinja quem pode escrever nela e
use somente a versão aprovada. O instalador não altera o antivírus.

`Permission denied`, `unable to unlink` e arquivos com `D` no `git status`
podem indicar bloqueio ou exclusão pelo antivírus. Confira a quarentena com a
TI antes de repetir a instalação. Se um arquivo continuar travado, **reinicie
a máquina**, mesmo depois de criar a exclusão. Preserve os dados privados.

O Portal também precisa do Microsoft Visual C++ Redistributable 2015+ **x64**.
O assistente e o instalador verificam e instalam com winget; o instalador testa
`workerd --version`. A falha desse motor pode aparecer como `write EOF` no
Wrangler. Confira Visual C++, antivírus e a necessidade de reiniciar antes de
pedir nova instalação. No PowerShell, use `npm.cmd` nos comandos npm.
