# Estrutura da pasta `privado/`

Esta pasta é só referência. **Você não precisa criá-la à mão:** o
`INSTALAR.bat` monta a estrutura inteira e copia os modelos para o lugar
certo. Ela existe aqui para que quem lê o repositório entenda o que o
`privado/` guarda, já que ele nunca entra no Git.

## O que vive onde

```
privado/
├── comum/                        smtp.env, operacao.env
├── operacao/                     supervisor.pid.json, status.json, logs
├── portal/
│   ├── backups/                  portal-atual.sqlite e cópias datadas
│   ├── banco/estado/             estado do Miniflare (D1, KV, R2, cache)
│   ├── configuracao/             portal.env
│   └── logs/                     portal-erro.log, portal-email.log
└── alertas/
    ├── config/                   cfg_ambiente.txt, cfg_qlik.txt,
    │                             destinatarios.txt, ambiente.bat
    ├── dados/                    extrações baixadas do Qlik
    ├── logs/                     pipeline_*.log
    ├── parametros/
    │   ├── de_para/              itens.csv, modelos.csv
    │   └── filtros/              excluir_*.txt
    └── relatorios/
        ├── diarios/              com_acordo, qualidade_acordos,
        │                         previews-email
        └── historicos/           relatórios de períodos fechados
```

## De onde vem cada arquivo

O instalador copia os modelos versionados e renomeia tirando o `.exemplo`:

| Modelo no repositório | Vira |
|---|---|
| `compartilhado/smtp.env.example` | `privado/comum/smtp.env` |
| `compartilhado/operacao.env.example` | `privado/comum/operacao.env` |
| `portal/portal.env.example` | `privado/portal/configuracao/portal.env` |
| `alertas/config/cfg_ambiente.exemplo.txt` | `privado/alertas/config/cfg_ambiente.txt` |
| `alertas/config/cfg_qlik.exemplo.txt` | `privado/alertas/config/cfg_qlik.txt` |
| `alertas/config/destinatarios.exemplo.txt` | `privado/alertas/config/destinatarios.txt` |
| `alertas/parametros/de_para/*.exemplo.csv` | `privado/alertas/parametros/de_para/*.csv` |
| `alertas/parametros/filtros/*.exemplo.txt` | `privado/alertas/parametros/filtros/*.txt` |

Todos nascem com valores fictícios. Preencher com os valores reais é o passo
seguinte, descrito em [docs/INSTALAR.md](../docs/INSTALAR.md).

## Por que nada disso entra no Git

O `privado/` guarda credenciais SMTP, o token do Qlik, o banco com preços e
usuários, e os relatórios com dados reais de compras. O `.gitignore` da raiz
bloqueia a pasta, e reforça com as extensões `*.xlsx`, `*.sqlite`, `*.db` e
`*.env` como segunda linha de defesa.

> **Atenção:** esta pasta de exemplo *não* é ignorada pelo Git — a regra
> `/privado/` casa apenas com o nome exato. Nunca coloque dado real aqui.
