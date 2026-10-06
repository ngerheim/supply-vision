# Alertas

Motor do Supply Vision que extrai dados, aplica parâmetros privados, compara
compras com referências comerciais e produz relatórios diários ou históricos.

## Estrutura

- `processo/`: extração, validação, comparação, relatórios e e-mail;
- `panorama/`: recortes históricos para download, sem envio de e-mail;
- `parametros/`: carregador e modelos fictícios dos arquivos privados;
- `config/`: modelos de configuração;
- `tests/`: testes automatizados.

Dados, credenciais, parâmetros reais e relatórios ficam em
`../privado/alertas/` e nunca entram no Git.

## Operação

A instalação e as execuções automáticas pertencem ao supervisor do produto.
Administradores usam **Portal → Relatórios** para executar o relatório diário
e pedir recortes para download. O recorte nunca envia e-mail, inclusive para
pedidos antigos com destinatário salvo. Seus arquivos expiram após 24 horas
da geração e são excluídos automaticamente pelo serviço do Portal.

O antigo menu batch foi removido. Para suporte, a partir de `alertas/`,
use `.venv\Scripts\python.exe processo\pipeline.py --sem-envio` para gerar uma
prévia diária, ou `.venv\Scripts\python.exe panorama\executar.py --inicio DD/MM/AAAA --fim DD/MM/AAAA`
para gerar um recorte sem e-mail.

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
