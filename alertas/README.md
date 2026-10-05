# Alertas

Motor do Supply Vision que extrai dados, aplica parâmetros privados, compara
compras com referências comerciais e produz relatórios diários ou históricos.

## Estrutura

- `processo/`: extração, validação, comparação, relatórios e e-mail;
- `panorama/`: recortes históricos, com envio opcional para um único destinatário;
- `parametros/`: carregador e modelos fictícios dos arquivos privados;
- `config/`: modelos de configuração;
- `tests/`: testes automatizados.

Dados, credenciais, parâmetros reais e relatórios ficam em
`../privado/alertas/` e nunca entram no Git.

## Operação

A instalação e as execuções automáticas pertencem ao supervisor do produto.
Administradores usam **Portal → Relatórios** para executar o relatório diário,
gerar sem envio, executar com diagnóstico, pedir recortes e simular/realizar limpeza.
O recorte do portal exige o e-mail destinatário; a lista diária e seu Cco não são usados.

Como alternativa de suporte, `executar.bat paralelo` gera sem envio e
`executar.bat recorte <início> <fim>` gera sem e-mail. O envio histórico por linha
de comando aceita `python panorama/executar.py --inicio DD/MM/AAAA --fim DD/MM/AAAA --destinatario pessoa@empresa.com`.

Relatórios diários, recortes e limpeza usam o mesmo lock de arquivos. A limpeza
**apaga**, após 24 horas, planilhas/CSV com timestamp no nome; logs duram cinco
dias. `python processo/limpeza.py --dry-run` permite conferir antes.

Configuração, operação e recuperação estão em [`../docs`](../docs). Os
arquivos `.exemplo` documentam apenas formatos, com valores abstratos.

## Desenvolvimento

```text
pip install -r config/requirements-dev.txt
python -m pytest tests
```

O código recusa configurações ausentes, parâmetros vazios ou incoerentes,
períodos inválidos e execuções concorrentes. Consulte a [`LICENSE`](../LICENSE)
antes de reutilizar o projeto.
