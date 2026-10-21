"""Exercita JSON-RPC e paginacao reais com transporte inteiramente em memoria."""
import json
from collections import deque
from datetime import date

import pytest
import qlik


class SocketQlik:
    def __init__(self, responder):
        self.responder = responder
        self.pacotes = deque()
        self.chamadas = []
        self.fechado = False
        self.timeout = None

    def send(self, texto):
        pedido = json.loads(texto)
        self.chamadas.append(pedido)
        resposta = self.responder(pedido)
        self.pacotes.append(resposta if isinstance(resposta, Exception) else
                            {'id': pedido['id'], 'result': resposta})

    def recv(self):
        pacote = self.pacotes.popleft()
        if isinstance(pacote, Exception):
            raise pacote
        return json.dumps(pacote)

    def settimeout(self, valor):
        self.timeout = valor

    def close(self):
        self.fechado = True


def sessao(responder):
    mod = qlik.Sessao('tenant.example.com', 'app-ficticio', 'chave.test')
    mod.ws = SocketQlik(responder)
    return mod


def test_rpc_ignora_notificacao_e_id_alheio_sem_perder_resposta():
    s = sessao(lambda p: {'valor': p['id']})
    s.ws.pacotes.extend([{'method': 'OnConnected'}, {'id': 99, 'result': {}}])
    assert s.call('Metodo', 7, ['entrada']) == {'valor': 1}
    assert s.call('Outro', 8, {}) == {'valor': 2}
    assert s.ws.chamadas == [
        {'jsonrpc': '2.0', 'id': 1, 'method': 'Metodo', 'handle': 7, 'params': ['entrada']},
        {'jsonrpc': '2.0', 'id': 2, 'method': 'Outro', 'handle': 8, 'params': {}},
    ]
    assert not s.ws.pacotes


@pytest.mark.parametrize('pacote,motivo', [
    ({'id': 1, 'error': {'message': 'recusado', 'code': 42}}, 'recusado.*42'),
    ({'id': 1}, "sem 'result'"),
])
def test_rpc_falha_de_protocolo_nao_vira_sucesso(pacote, motivo):
    s = sessao(lambda p: {})
    s.ws.pacotes.append(pacote)
    with pytest.raises(qlik.QlikErro, match=motivo):
        s.call('GetLayout', 7, [])


def test_abertura_autentica_limpa_selecao_e_fecha_apos_erro(monkeypatch, tmp_path):
    chave = tmp_path / 'chave.txt'
    chave.write_text('\ufeffeyJ-chave-ficticia\n', encoding='utf-8')
    ws = SocketQlik(lambda p: {})
    ws.pacotes.append({'method': 'OnConnected'})
    conexoes = []
    def conectar(url, **kwargs):
        conexoes.append((url, kwargs))
        return ws
    monkeypatch.setattr(qlik.websocket, 'create_connection', conectar)
    s = qlik.Sessao('tenant.example.com', 'app-ficticio', chave)
    with pytest.raises(RuntimeError, match='falha no consumidor'):
        with s as aberta:
            assert aberta is s
            raise RuntimeError('falha no consumidor')
    assert conexoes == [('wss://tenant.example.com/app/app-ficticio', {
        'header': ['Authorization: Bearer eyJ-chave-ficticia'], 'timeout': 30})]
    assert [(p['method'], p['handle'], p['params']) for p in ws.chamadas] == [
        ('OpenDoc', -1, ['app-ficticio']), ('ClearAll', 1, [False])]
    assert ws.timeout == 120
    assert ws.fechado and s.ws is None


@pytest.mark.parametrize('ordem,esperado', [([2, 0, 1], ['Preco', 'Modelo', 'Item']),
                                           ([], ['Modelo', 'Item', 'Preco'])])
def test_cabecalhos_respeitam_ordem_do_hipercubo(ordem, esperado):
    def responder(p):
        if p['method'] == 'GetObject':
            return {'qReturn': {'qHandle': 7}}
        return {'qLayout': {'qHyperCube': {
            'qSize': {'qcx': 3}, 'qColumnOrder': ordem,
            'qDimensionInfo': [{'qFallbackTitle': 'Modelo'}, {'qFallbackTitle': 'Item'}],
            'qMeasureInfo': [{'qFallbackTitle': 'Preco'}],
        }}}
    s = sessao(responder)
    assert s.abrir_objeto('obj-ficticio') == (7, esperado, 3)
    assert [p['params'] for p in s.ws.chamadas] == [['obj-ficticio'], []]


@pytest.mark.parametrize('selecionadas', [0, 2])
def test_selecao_usa_serial_ordenado_e_confirma_estado(selecionadas):
    respostas = iter([{'qReturn': {'qHandle': 8}}, {'qReturn': {'qHandle': 9}},
                      {'qReturn': True}, {'qLayout': {'qListObject': {
                          'qDimensionInfo': {'qStateCounts': {'qSelected': selecionadas}}}}}])
    s = sessao(lambda p: next(respostas))
    assert s.selecionar_datas('Data', [date(1899, 12, 31), date(1899, 12, 30)]) == selecionadas
    assert [(p['method'], p['handle']) for p in s.ws.chamadas] == [
        ('CreateSessionObject', 1), ('GetField', 1), ('SelectValues', 9), ('GetLayout', 8)]
    assert s.ws.chamadas[2]['params'] == {'qFieldValues': [
        {'qIsNumeric': True, 'qNumber': 0}, {'qIsNumeric': True, 'qNumber': 1}],
        'qToggleMode': False, 'qSoftLock': True}


def test_selecao_recusada_nao_e_tratada_como_periodo_vazio():
    respostas = iter([{'qReturn': {'qHandle': 8}}, {'qReturn': {'qHandle': 9}}, {'qReturn': False}])
    s = sessao(lambda p: next(respostas))
    with pytest.raises(qlik.QlikErro, match='recusou a seleção'):
        s.selecionar_datas('Data', [date(2026, 10, 20)])
    assert [p['method'] for p in s.ws.chamadas] == ['CreateSessionObject', 'GetField', 'SelectValues']


def paginada(monkeypatch, total, paginas):
    monkeypatch.setattr(qlik, 'CELULAS_POR_PAGINA', 4)
    respostas = iter(paginas)
    def responder(p):
        if p['method'] == 'GetLayout':
            return {'qLayout': {'qHyperCube': {'qSize': {'qcy': total}}}}
        pagina = next(respostas)
        return pagina if isinstance(pagina, Exception) else {'qDataPages': [{'qMatrix': pagina}]}
    return sessao(responder)


def test_paginacao_preserva_texto_numero_e_ultima_pagina(monkeypatch, capsys):
    s = paginada(monkeypatch, 3, [
        [[{'qText': '001'}, {'qText': '1,50', 'qNum': 1.5}],
         [{'qText': '002'}, {'qText': '-', 'qNum': float('nan')}]],
        [[{'qText': '003'}, {'qText': 'nao numerico'}]],
    ])
    assert s.ler(7, ['Codigo', 'Preco'], 2, {'Preco'}, progresso_a_cada=1) == [
        ['001', 1.5], ['002', None], ['003', None]]
    assert [p['params'] for p in s.ws.chamadas[1:]] == [
        ['/qHyperCubeDef', [{'qTop': 0, 'qLeft': 0, 'qHeight': 2, 'qWidth': 2}]],
        ['/qHyperCubeDef', [{'qTop': 2, 'qLeft': 0, 'qHeight': 1, 'qWidth': 2}]],
    ]
    assert '3/3 linhas baixadas' in capsys.readouterr().out


@pytest.mark.parametrize('recupera', [True, False])
def test_retry_repete_mesma_pagina_com_limite(monkeypatch, recupera):
    pausas = []
    monkeypatch.setattr(qlik.time, 'sleep', pausas.append)
    paginas = [OSError('falha transitoria')] * (1 if recupera else 3)
    s = paginada(monkeypatch, 1, paginas + [[[{'qText': 'ok'}]]])
    if recupera:
        assert s.ler(7, ['Texto'], 1, set()) == [['ok']]
    else:
        with pytest.raises(OSError, match='falha transitoria'):
            s.ler(7, ['Texto'], 1, set())
    pedidos = s.ws.chamadas[1:]
    assert len(pedidos) == (2 if recupera else 3)
    assert all(p['params'] == pedidos[0]['params'] for p in pedidos)
    assert pausas == ([3] if recupera else [3, 3])


@pytest.mark.parametrize('paginas,motivo', [
    ([[[{'qText': 'primeira'}]], []], 'página vazia'),
    ([[[{'qText': 'a'}]], [[{'qText': 'b'}], [{'qText': 'extra'}]]], 'Extração incompleta'),
])
def test_pagina_vazia_e_total_divergente_abortam(monkeypatch, paginas, motivo):
    s = paginada(monkeypatch, 2, paginas)
    with pytest.raises(qlik.QlikErro, match=motivo):
        s.ler(7, ['Texto'], 1, set())


def test_objeto_vazio_nao_solicita_paginas(monkeypatch):
    s = paginada(monkeypatch, 0, [])
    assert s.ler(7, ['Texto'], 1, set()) == []
    assert [p['method'] for p in s.ws.chamadas] == ['GetLayout']
