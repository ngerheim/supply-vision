# Gerador do relatorio do Power BI

Estes scripts sao a **fonte** do relatorio. O que esta em
`SupplyVisionPainel.Report/definition/` e saida gerada: editar o PBIR na mao
funciona, mas a proxima geracao sobrescreve.

Por que gerar em vez de montar no Desktop: o PBIR sao 83 arquivos JSON com
GUIDs. Reposicionar sete abas na mao e uma tarde de trabalho e nenhum registro
do porque de cada numero; aqui e uma linha de codigo com o motivo no comentario.

| arquivo | gera |
|---|---|
| `modelo.py` | `model.bim` do semantic model (34 colunas, 26 medidas, query M) |
| `relatorio.py` | biblioteca: helpers de visual, filtro, cor e escrita do PBIR |
| `paginas.py` | as sete paginas — e o arquivo que se edita para mudar layout |
| `tema.py` | `LocFrotas_SupplyVision.json`, o tema da marca |
| `validar.py` | valida a arvore gerada contra os schemas oficiais da Microsoft |

## Rodar

```
python paginas.py          # escreve out/SupplyVisionPainel.Report/definition
python tema.py             # escreve LocFrotas_SupplyVision.json
python validar.py          # 0 erros e requisito para copiar para o projeto
```

`validar.py` precisa do clone de `microsoft/json-schemas` — ele resolve os
`$ref` localmente porque o resolver do jsonschema tentaria baixar cada
referencia. Ajuste a constante `BASE` no topo do arquivo para onde o clone
estiver.

## Antes de copiar para `SupplyVisionPainel.Report/`

1. **Feche o Power BI Desktop.** Ele reescreve `definition/` ao salvar e
   descarta o que foi gravado por fora.
2. Apague o `definition/` antigo em vez de sobrescrever: visuais removidos
   deixam `visual.json` orfao, e o Desktop os carrega.
3. O `compatibilityLevel` do `model.bim` nao pode regredir. Se o Desktop
   subiu a versao, o numero certo esta na mensagem de erro dele.
