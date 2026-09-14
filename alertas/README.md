# Alertas

Motor do Supply Vision que extrai dados, aplica parâmetros privados, compara
compras com referências comerciais e produz relatórios diários ou históricos.

## Estrutura

- `processo/`: extração, validação, comparação, relatórios e e-mail;
- `panorama/`: recortes históricos, sem envio de e-mail;
- `parametros/`: carregador e modelos fictícios dos arquivos privados;
- `config/`: modelos de configuração;
- `tests/`: testes automatizados.

Dados, credenciais, parâmetros reais e relatórios ficam em
`../privado/alertas/` e nunca entram no Git.

## Operação

A instalação e as execuções automáticas pertencem ao supervisor do produto.
Para uma execução manual sem e-mail, use `executar.bat paralelo`. Para gerar
um recorte, use `executar.bat recorte <início> <fim>`.

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
