from test_regras import acordo, base


def test_quantidade_fracionaria_e_inteira_preservam_exibicao(rodar, tmp_path, abrir_planilha):
    compra = base(qtd=2, preco=100)
    compra['OS Quantidade'] = [1, 1.25]
    resultado = rodar.processar(compra, acordo([10]))
    destino = tmp_path / 'quantidades.xlsx'
    rodar.gerar_alerta_acordo(resultado, str(destino))
    ws = abrir_planilha(destino).active
    col = [c.value for c in ws[1]].index('Qtd') + 1
    assert ws.cell(2, col).value == 1
    assert ws.cell(2, col).number_format == '#,##0'
    assert ws.cell(3, col).value == 1.25
    assert ws.cell(3, col).number_format == '#,##0.##'
