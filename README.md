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

Use `supv iniciar`, `supv parar`, `supv atualizar`, `supv config validar` e
`supv backup testar` para controlar e conferir a operação. Acesse o Portal pelo endereço da instalação.
Administradores executam os relatórios e recortes históricos na aba **Relatórios**,
com acompanhamento e download. Recortes não enviam e-mail e seus arquivos
expiram após 24 horas. Veja [o guia de operação](docs/OPERAR.md).

## Os três verbos

| Quero | Comando | Onde |
|---|---|---|
| Instalar pela primeira vez | `INSTALAR.bat` | [docs/INSTALAR.md](docs/INSTALAR.md) |
| Receber uma melhoria | `supv atualizar` | [docs/OPERAR.md](docs/OPERAR.md) |
| Resolver um problema | `supv config validar` | [docs/SOCORRO.md](docs/SOCORRO.md) |

## Regra de dados

Todo dado real vive em `privado/`, que o Git ignora. Por isso `git pull` e
`git reset --hard` não alteram o banco.

`node_modules` e `.venv` são reconstruídos pelo `INSTALAR.bat` e não devem ser
copiados entre máquinas.

## Desenvolvimento

As correções são feitas nesta raiz, commitadas e publicadas. O computador
servidor apenas recebe versões por `supv atualizar`; ele nunca deve
ter alteração local.

A versão em uso é o commit: `supv status` mostra o hash e a data.

## Operacao via LAN e futura hospedagem completa

O portal continua funcionando no notebook-servidor, via LAN. A estrutura
opcional de homologacao prepara uma futura hospedagem completa em
Cloudflare Workers + D1, incluindo login, criacao e edicao de acordos e
persistencia dos dados. O GitHub guarda o codigo e prepara o pacote;
nao hospeda a aplicacao. Nao ha adaptacao para GitHub Pages.

O workflow manual ainda nao publica o portal. E-mails, backups e demais
etapas de migracao precisam ser concluidos antes de substituir a operacao
local. Veja [docs/HOSPEDAGEM.md](docs/HOSPEDAGEM.md).

Para levar a instalação do notebook para o servidor, siga o
[assistente de migração, com ensaio e troca definitiva](docs/MIGRAR.md).
