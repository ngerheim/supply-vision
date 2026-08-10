"""
Acesso ao Qlik Cloud: websocket, JSON-RPC do Engine API, seleção de período e
paginação do hipercubo.

Compartilhado pelo pipeline diário e pelo recorte histórico, para que uma
correção de protocolo valha para os dois.

Não conhece acordos, filtros nem relatórios; o formato dos dados é definido
em contrato_base.py.
"""
import json
import pathlib
import time
from datetime import date

import websocket

# --- Conexão ---
TENTATIVAS_CONEXAO = 3
INTERVALO_RETRY_S  = 45
TIMEOUT_CONEXAO_S  = 30    # handshake
TIMEOUT_LEITURA_S  = 120   # cada recv; recorte grande devolve resposta maior

# --- Paginação ---
# Numa extração de 200 mil linhas são ~500 chamadas. Sem retry, uma única
# falha transitória custava a extração inteira.
TENTATIVAS_PAGINA    = 3
PAUSA_RETRY_PAGINA_S = 3
CELULAS_POR_PAGINA   = 10000


class QlikErro(RuntimeError):
    """Falha de protocolo, de sessão ou de integridade da extração."""


def serial(d):
    """Data para o serial numérico do Qlik (base 30/12/1899)."""
    return (d - date(1899, 12, 30)).days


class Sessao:
    """Sessão aberta com um app do Qlik. Use como context manager."""

    def __init__(self, tenant, app_id, chave_path):
        self.tenant = tenant
        self.app_id = app_id
        self.chave_path = chave_path
        self.ws = None
        self._id = 0

    # ---------------------------------------------------------------- ciclo
    def __enter__(self):
        self.abrir()
        return self

    def __exit__(self, *_):
        self.fechar()
        return False

    def abrir(self):
        chave = pathlib.Path(self.chave_path).read_text(encoding='utf-8-sig').strip()
        if not chave.startswith('eyJ'):
            raise QlikErro(f'API Key inválida em {self.chave_path}')

        url = f'wss://{self.tenant}/app/{self.app_id}'
        ultimo = None
        for n in range(1, TENTATIVAS_CONEXAO + 1):
            try:
                print(f'Tentativa {n}/{TENTATIVAS_CONEXAO}: conectando ao Qlik...')
                self.ws = websocket.create_connection(
                    url, header=[f'Authorization: Bearer {chave}'],
                    timeout=TIMEOUT_CONEXAO_S)
                print(f'Tentativa {n}/{TENTATIVAS_CONEXAO}: conectado.')
                break
            except Exception as e:
                ultimo = e
                print(f'Tentativa {n}/{TENTATIVAS_CONEXAO}: falhou ({type(e).__name__}: {e})')
                if n < TENTATIVAS_CONEXAO:
                    print(f'  Aguardando {INTERVALO_RETRY_S}s antes da próxima tentativa...')
                    time.sleep(INTERVALO_RETRY_S)
        else:
            print(f'ERRO: conexão ao Qlik falhou após {TENTATIVAS_CONEXAO} tentativas.')
            raise ultimo

        self.ws.settimeout(TIMEOUT_LEITURA_S)
        self.ws.recv()                      # OnConnected
        self.call('OpenDoc', -1, [self.app_id])
        self.call('ClearAll', 1, [False])
        return self

    def fechar(self):
        if self.ws:
            try:
                self.ws.close()
            except Exception:
                pass
            self.ws = None

    # ------------------------------------------------------------- protocolo
    def call(self, method, handle, params):
        """Chamada JSON-RPC, casando a resposta pelo id.

        O Qlik empurra mensagens não solicitadas no mesmo socket: notificações
        de sessão, OnConnected, avisos de validade da chave. Devolver o
        primeiro pacote que chega faz o chamador receber um dicionário sem
        'result' e estourar com KeyError no meio de uma extração longa.
        """
        self._id += 1
        meu = self._id
        self.ws.send(json.dumps({'jsonrpc': '2.0', 'id': meu,
                                 'method': method, 'handle': handle,
                                 'params': params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get('id') != meu:
                continue                    # notificação assíncrona: ignora
            if 'error' in msg:
                err = msg['error']
                raise QlikErro(f"Qlik recusou {method}: {err.get('message', '?')} "
                               f"(code {err.get('code', '?')})")
            if 'result' not in msg:
                raise QlikErro(f"Qlik respondeu {method} sem 'result': {msg}")
            return msg['result']

    # ----------------------------------------------------------------- cubo
    def abrir_objeto(self, obj_id):
        """Abre o objeto e devolve (handle, cabeçalhos, nº de colunas)."""
        h = self.call('GetObject', 1, [obj_id])['qReturn']['qHandle']
        hc = self.call('GetLayout', h, [])['qLayout']['qHyperCube']
        qcx = hc['qSize']['qcx']

        natural = [d.get('qFallbackTitle') for d in hc.get('qDimensionInfo', [])] + \
                  [m.get('qFallbackTitle') for m in hc.get('qMeasureInfo', [])]
        ordem = hc.get('qColumnOrder') or list(range(len(natural)))
        headers = [natural[k] for k in ordem] if len(ordem) == len(natural) else natural
        return h, headers, qcx

    def linhas(self, h):
        """Quantas linhas o objeto expõe no estado de seleção atual."""
        return self.call('GetLayout', h, [])['qLayout']['qHyperCube']['qSize']['qcy']

    # ------------------------------------------------------------- seleção
    def selecionar_datas(self, campo, datas):
        """Seleciona as datas por valor e devolve quantas casaram.

        Zero significa "nenhum movimento no período", que não é erro: num
        feriado em dia útil, ou numa segunda após feriadão, é o resultado
        correto.

        A sonda existe porque SelectValues devolve qReturn=True mesmo quando
        nenhum dos valores existe no campo — e aí o campo fica sem seleção,
        deixando a base inteira disponível. Ler qcy do objeto não distingue os
        dois casos; qStateCounts.qSelected distingue.

        Por valor, e não por qElemNumber: número de elemento é índice interno
        do Qlik e pode mudar entre recargas da app.
        """
        lb = self.call('CreateSessionObject', 1, [{
            'qInfo': {'qType': 'lb-data'},
            'qListObjectDef': {'qDef': {'qFieldDefs': [campo]}},
        }])['qReturn']['qHandle']

        fh = self.call('GetField', 1, {'qFieldName': campo})['qReturn']['qHandle']
        valores = [{'qIsNumeric': True, 'qNumber': serial(d)} for d in sorted(datas)]
        if not self.call('SelectValues', fh, {'qFieldValues': valores,
                                              'qToggleMode': False,
                                              'qSoftLock': True})['qReturn']:
            raise QlikErro('Qlik recusou a seleção de período')

        dim = self.call('GetLayout', lb, [])['qLayout']['qListObject']['qDimensionInfo']
        return dim['qStateCounts']['qSelected']

    # ------------------------------------------------------------- leitura
    def ler(self, h, headers, qcx, colunas_numericas, progresso_a_cada=0):
        """Lê o objeto inteiro, paginado, e devolve a lista de linhas.

        Três travas contra extração incompleta, que é o pior resultado
        possível: os números saem errados e o relatório parece normal.

        1. Retry por página. São ~500 chamadas numa extração grande, e uma
           falha transitória custaria tudo.
        2. Página vazia antes de qcy não é fim de dados, é sessão em estado
           ruim — tipicamente após um retry. Aborta em vez de truncar.
        3. No fim, exige len(rows) == qcy.
        """
        qcy = self.linhas(h)
        rows = []
        chunk = max(1, CELULAS_POR_PAGINA // qcx)
        top = pag = 0

        while top < qcy:
            alt = min(chunk, qcy - top)
            for n in range(1, TENTATIVAS_PAGINA + 1):
                try:
                    r = self.call('GetHyperCubeData', h,
                                  ['/qHyperCubeDef',
                                   [{'qTop': top, 'qLeft': 0, 'qHeight': alt, 'qWidth': qcx}]])
                    break
                except Exception as e:
                    if n == TENTATIVAS_PAGINA:
                        print(f'ERRO: página a partir da linha {top:,} falhou '
                              f'{TENTATIVAS_PAGINA}x ({type(e).__name__}: {e}).')
                        raise
                    print(f'  aviso: página a partir da linha {top:,} falhou '
                          f'({type(e).__name__}: {e}); '
                          f'tentativa {n + 1}/{TENTATIVAS_PAGINA}...')
                    time.sleep(PAUSA_RETRY_PAGINA_S)

            mat = r['qDataPages'][0]['qMatrix']
            if not mat:
                if top < qcy:
                    raise QlikErro(
                        f'Qlik devolveu página vazia na linha {top:,} de {qcy:,} — '
                        'sessão em estado inconsistente. Base NÃO foi salva.')
                break

            for mrow in mat:
                linha = []
                for j, c in enumerate(mrow):
                    titulo = headers[j] if j < len(headers) else ''
                    if titulo in colunas_numericas:
                        qn = c.get('qNum')
                        linha.append(qn if isinstance(qn, (int, float)) and qn == qn else None)
                    else:
                        linha.append(c.get('qText'))
                rows.append(linha)

            top += len(mat)
            pag += 1
            if progresso_a_cada and pag % progresso_a_cada == 0:
                print(f'  ... {min(top, qcy):,}/{qcy:,} linhas baixadas')

        if len(rows) != qcy:
            raise QlikErro(
                f'Extração incompleta: {len(rows):,} de {qcy:,} linhas '
                f'({len(rows) / qcy * 100:.1f}%). Base NÃO foi salva. '
                f'Rode de novo; se repetir, reduza o recorte e junte os pedaços.')

        return rows
