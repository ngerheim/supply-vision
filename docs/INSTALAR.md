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

Gera `supply-vision-semente-<data>.zip`. Se a operação estiver no ar, ele usa
o backup mais recente em vez do banco vivo, e avisa se o backup estiver velho.

> A semente contém credenciais SMTP, token do Qlik e o banco com preços e
> usuários. Prefira pen drive a e-mail, e apague depois de usar.

**No notebook novo:**

```powershell
git clone <repositorio> C:\Projetos\supply-vision
cd C:\Projetos\supply-vision
.\scripts\restaurar-semente.ps1 -Zip D:\supply-vision-semente-<data>.zip
```

A restauração confere o SHA-256 do banco, recusa se já houver banco no destino
e lista os valores que mudam de máquina. Ajuste-os antes de continuar:

| Onde | Chave | Por quê |
|---|---|---|
| `privado\portal\configuracao\portal.env` | `PORTAL_URL` | é o IP desta máquina |
| `privado\portal\configuracao\portal.env` | `BACKUP_NETWORK_DIR` | acesso à rede |
| `privado\alertas\config\cfg_ambiente.txt` | `ACORDO_PATH` | acesso à rede |
| `privado\comum\operacao.env` | `LIMPEZA_HORARIO` | tem que cair na janela em que a máquina fica ligada |

Depois:

```
INSTALAR.bat
```

Ele instala Node e Python pelo `winget` se faltarem, cria o `.venv`, roda
`npm ci`, gera o build, executa as suítes e prepara a inicialização
automática. Reexecutar é seguro: não apaga banco, credenciais, parâmetros nem
relatórios.

Para conferir requisitos sem alterar nada: `INSTALAR.bat -SomenteVerificar`.

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
  o backup em rede e a planilha de acordos falham depois de reiniciar.
- **Windows Update** com horário ativo cobrindo o expediente.
- **Antivírus** com exclusão da pasta do projeto: SQLite e Node fazem muita
  escrita pequena.
- **Login automático**, se a operação precisar subir sem alguém sentar na
  máquina. É a única desta lista com contrapartida de segurança.

## Teste que fecha a instalação

Reinicie a máquina e confirme que o Portal sobe sozinho, sem clique e sem
janela de console sobrando. Só depois considere a instalação concluída.
