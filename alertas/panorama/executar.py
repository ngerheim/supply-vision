"""
Roda o recorte completo: extrai do Qlik e gera os relatórios.

O período vem dos argumentos --inicio e --fim passados pelo executar.bat.
O envio é opcional, para o único destinatário informado por --destinatario.
"""
import pathlib
import sys
import time
import re

sys.dont_write_bytecode = True

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import baixar_periodo
import gerar_relatorios


def main():
    destinatario = None
    if '--destinatario' in sys.argv:
        indice = sys.argv.index('--destinatario')
        destinatario = sys.argv[indice + 1].strip() if indice + 1 < len(sys.argv) else ''
        if len(destinatario) > 254 or not re.fullmatch(r'[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+', destinatario):
            print('ERRO: informe um único destinatário válido.')
            sys.exit(1)
    # Mesmo lock do relatório diário: ambos usam arquivos intermediários comuns.
    import pipeline
    try:
        pipeline.adquirir_lock()
    except RuntimeError as erro:
        print(f'ERRO: {erro}.')
        sys.exit(2)
    t0 = time.time()
    print('═' * 60)
    print('PANORAMA — análise por recorte temporal')
    print(f'Recorte: {baixar_periodo.DATA_INICIO} a {baixar_periodo.DATA_FIM}'
          f'  (origem: {baixar_periodo.ORIGEM_PERIODO})')
    print('═' * 60)

    n = baixar_periodo.baixar()
    if n == 0:
        print('\nEncerrado sem relatórios (nenhum dado no período).')
        return

    print()
    caminho = gerar_relatorios.gerar()
    if caminho and destinatario:
        from enviar_email import enviar_email
        inicio, fim = baixar_periodo.DATA_INICIO, baixar_periodo.DATA_FIM
        enviar_email(
            f'Supply Vision — recorte histórico {inicio} a {fim}',
            f'Relatório do período {inicio} a {fim} (datas inclusivas).\n\nO arquivo anexo compara as compras históricas com os acordos disponíveis no Portal no momento da execução.',
            [caminho], [destinatario], copia_oculta=[],
        )
    print(f'\nTempo total: {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
