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

Toda a operação passa pela central: abra **`Supply Vision.bat`**.

Ela mostra se está no ar, atualiza o sistema, abre o Portal e os registros,
valida a configuração e testa o backup. `INICIAR.bat`, `PARAR.bat` e os
scripts existem para suporte, mas a rotina normal é pela central.

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
