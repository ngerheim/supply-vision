"""
Roda o recorte completo: extrai do Qlik e gera os relatórios.

O período vem dos argumentos --inicio e --fim; sem eles, do recorte.py ao
lado. É o que o executar.bat chama. Nenhuma etapa envia e-mail.
"""
import pathlib
import sys
import time

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
    gerar_relatorios.gerar()
    print(f'\nTempo total: {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
