# Operação do Supply Vision

Este documento concentra configuração e manutenção operacional. A visão do
problema e das decisões técnicas está no [`README`](../README.md).

## Dependências externas

- Python 3.11 ou superior;
- Qlik Cloud, acessado pela Engine API;
- `ACORDOS.xlsx`, aba `ACORDO`;
- servidor SMTP para o envio diário;
- Agendador de Tarefas do Windows para a automação local.

O recorte histórico usa Qlik e a planilha de acordos, mas não depende de SMTP
nem do Agendador.

## Instalação

```text
pip install -r config/requirements.txt
```

O arquivo instala `websocket-client`, `pandas`, `numpy`, `openpyxl` e
`xlsxwriter`.

Para desenvolvimento e testes:

```text
pip install -r config/requirements-dev.txt
python -m pytest -q
```

## Configuração

Copie os modelos em `config/` e preencha os arquivos locais:

| Copiar de | Para | Conteúdo |
|---|---|---|
| `cfg_ambiente.exemplo.txt` | `cfg_ambiente.txt` | tenant Qlik, SMTP, caminho dos acordos e nome da tarefa agendada |
| `cfg_qlik.exemplo.txt` | `cfg_qlik.txt` | API Key do Qlik Cloud |
| `cfg_smtp.exemplo.txt` | `cfg_smtp.txt` | senha SMTP do remetente |
| `destinatarios.exemplo.txt` | `destinatarios.txt` | destinatários dos relatórios |
| `ambiente.exemplo.bat` | `ambiente.bat` | caminho do executável Python |

Os arquivos preenchidos ficam fora do Git.

## Parâmetros

Copie também os modelos de universo:

| Copiar de | Para |
|---|---|
| `parametros/filtros/excluir_grupos_despesa.exemplo.txt` | `parametros/filtros/excluir_grupos_despesa.txt` |
| `parametros/filtros/excluir_modelos.exemplo.txt` | `parametros/filtros/excluir_modelos.txt` |
| `parametros/filtros/excluir_fornecedores.exemplo.txt` | `parametros/filtros/excluir_fornecedores.txt` |
| `parametros/filtros/excluir_descricoes.exemplo.txt` | `parametros/filtros/excluir_descricoes.txt` |
| `parametros/de_para/itens.exemplo.csv` | `parametros/de_para/itens.csv` |
| `parametros/de_para/modelos.exemplo.csv` | `parametros/de_para/modelos.csv` |

As versões `.exemplo` contêm dados fictícios. Os parâmetros reais representam
decisões comerciais e não são versionados.

## Execução manual

```text
executar.bat              menu interativo
executar.bat relatorio    dispara a tarefa configurada
executar.bat limpeza      arquiva logs e relatórios antigos
executar.bat debug        executa o pipeline diário no console
executar.bat recorte      solicita o período histórico
executar.bat recorte 01/07/2026 31/07/2026
```

As datas do recorte são validadas antes da consulta ao Qlik. O sistema rejeita
formato inválido, período invertido e datas futuras.

## Agendamento

As tarefas do Windows chamam diretamente scripts em `processo/`. Ao renomear
ou mover `pipeline.py`, `limpeza.py` ou `verificar_saude.py`, atualize os
caminhos no Agendador.

A tarefa principal executa `pipeline.py`. Tarefas posteriores podem chamar
`verificar_saude.py HHMM` para conferir se o log contém a conclusão esperada.
`limpeza.py` arquiva artefatos antigos.

O verificador aceita tanto logs legados `pipeline_AAAAMMDD_HHMM.log` quanto
logs com `run_id`, `pipeline_AAAAMMDD_HHMMSS_<sufixo>.log`.

O pipeline mantém lock exclusivo durante toda a execução. Uma segunda
execução encerra sem processar ou sobrescrever artefatos. Logs e relatórios
usam um `run_id` no formato `AAAAMMDD_HHMMSS_<sufixo>`; a limpeza reconhece
esse formato e o formato legado. Cada subprocesso tem limite configurável por
`PIPELINE_TIMEOUT_S`, com padrão de 1800 segundos.

## Limites do monitoramento

O verificador roda no mesmo host e usa o mesmo SMTP do pipeline. Ele só
consegue enviar alerta quando máquina, sessão, Agendador, rede e SMTP continuam
disponíveis. Portanto, não cobre indisponibilidade do próprio ambiente.

O limiar de itens sem cobertura usa o percentual sobre linhas elegíveis e
gera alerta no log, no resumo estruturado e no corpo do e-mail.

## Relatórios e denominadores

- `com_acordo`: linhas com referência válida;
- `sem_acordo`: somente ausência de cobertura;
- `pendencias`: acordos ambíguos ou sem preço válido;
- `qualidade_acordos`: CSV para correção da base de referência.

`total elegível = total bruto - quarentena`. Conformidade, desvios e ausência
de cobertura usam o total elegível. A quarentena usa o total bruto.

## Renovação da API Key

`verificar_saude.py` verifica a data configurada em `CHAVE_QLIK_EXPIRA` quando
consegue executar. Para renovar a chave:

1. gere uma API Key no tenant do Qlik Cloud;
2. substitua o conteúdo de `config/cfg_qlik.txt`;
3. atualize `CHAVE_QLIK_EXPIRA`.

O lembrete de vencimento está sujeito aos mesmos limites do monitoramento
local descritos acima.
