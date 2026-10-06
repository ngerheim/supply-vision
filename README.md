# Supply Vision

Produto unificado para acordos comerciais, acompanhamento de compras e alertas
operacionais. Opera inicialmente em um computador dedicado na LAN e poderá ser
migrado para um servidor dedicado.

## Módulos

| Pasta | O que é |
|---|---|
| `portal/` | Portal Suprimentos: acordos, fornecedores, chamados e usuários |
| `alertas/` | Motor que extrai do Qlik, compara compras contra acordos e envia os alertas |
| `scripts/` | Supervisor e ferramentas de operação |
| `compartilhado/` | Modelos de configuração usados pelo instalador |
| `privado/` | Dados reais, credenciais e banco. **Nunca entra no Git** |
| `docs/` | Instalação, operação e socorro |

## O dia a dia

Abra **`Supply Vision.bat`** para iniciar, parar e atualizar a operação, validar
configuração e conferir backups. Acesse o Portal pelo endereço da instalação.
Administradores executam os relatórios e recortes históricos na aba **Relatórios**,
com acompanhamento e download. Recortes não enviam e-mail e seus arquivos
expiram após 24 horas. Veja [o guia de operação](docs/OPERAR.md).

## Os três verbos

| Quero | Comando | Onde |
|---|---|---|
| Instalar pela primeira vez | `INSTALAR.bat` | [docs/INSTALAR.md](docs/INSTALAR.md) |
| Receber uma melhoria | `Supply Vision.bat` → Atualizar sistema | [docs/OPERAR.md](docs/OPERAR.md) |
| Resolver um problema | `Supply Vision.bat` → Validar | [docs/SOCORRO.md](docs/SOCORRO.md) |

## Regra de dados

Todo dado real vive em `privado/`, que o Git ignora. Por isso `git pull` e
`git reset --hard` não alteram o banco.

`node_modules` e `.venv` são reconstruídos pelo `INSTALAR.bat` e não devem ser
copiados entre máquinas.

## Desenvolvimento

As correções são feitas nesta raiz, commitadas e publicadas. O computador
servidor apenas recebe versões pelo `atualizar-servidor.ps1`; ele nunca deve
ter alteração local.

A versão em uso é o commit: a central mostra o hash e a data.

## Operacao via LAN e futura hospedagem completa

O portal continua funcionando no notebook-servidor, via LAN. A estrutura
opcional de homologacao prepara uma futura hospedagem completa em
Cloudflare Workers + D1, incluindo login, criacao e edicao de acordos e
persistencia dos dados. O GitHub guarda o codigo e prepara o pacote;
nao hospeda a aplicacao. Nao ha adaptacao para GitHub Pages.

O workflow manual ainda nao publica o portal. E-mails, backups e demais
etapas de migracao precisam ser concluidos antes de substituir a operacao
local. Veja [docs/HOSPEDAGEM.md](docs/HOSPEDAGEM.md).
