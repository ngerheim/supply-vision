"""
Consulta sob demanda: itens de OS de uma placa, para a calculadora de
Reembolso do Portal.

O Portal mantém este script aberto em modo --servidor: a sessão com o Qlik
fica aberta entre as consultas, então só a primeira paga a abertura do app.
Cada pedido chega numa linha JSON pela entrada padrão e cada resposta sai
numa linha da saída:
    {"id": 1, "placa": "ABC1D23"}      → RESULTADO_JSON={"id": 1, "placa": ..., "linhas": [...]}
    {"id": 2, "aquecer": true}         → RESULTADO_JSON={"id": 2, "pronto": true}
Erro de um pedido vira {"id": ..., "erro": "..."} e o processo continua.
Lê o mesmo objeto do Qlik que o alerta usa (QLIK_APP_ID/QLIK_OBJ_ID) e
seleciona só a placa, sem filtro de data. Não toma o lock do pipeline: só
lê o Qlik e não grava nada.

À mão (uma consulta, para medir o tempo):
    python processo/consultar_os_placa.py ABC1D23
"""
import json
import queue
import re
import sys
import threading
import time
from datetime import date, timedelta

import qlik
import sv_paths

COLUNA_PLACA = "Placa"
# Chamada leve ao Qlik quando parado, para a sessão não ser encerrada.
PING_S = 60
# coluna do objeto do Qlik → campo devolvido ao Portal
OBRIGATORIAS = ("Data Abertura", "Placa", "Codigo OS", "Descrição", "KM OS")
OPCIONAIS = {
    "OS Quantidade": "qtd",
    "Valor Unitario": "valorUnit",
    "Valor Total": "total",
    "Valor Reembolso": "reembolso",
    "Fornecedor": "fornecedor",
    "Grupo Despesa": "grupo",
    "Modelo": "modelo",
    "Cliente": "cliente",
}
NUMERICAS = {"OS Quantidade", "Valor Unitario", "Valor Total", "Valor Reembolso"}
VAZIOS = {"", "-", "—", "nan", "None"}


def _texto(valor, limite=200):
    texto = "" if valor is None else str(valor).strip()
    return None if texto in VAZIOS else texto[:limite]


def _data(valor):
    texto = _texto(valor) or ""
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", texto)
    if m:
        texto = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    elif re.fullmatch(r"\d{5}", texto):  # serial do Qlik/Excel
        texto = (date(1899, 12, 30) + timedelta(days=int(texto))).isoformat()
    try:
        return date.fromisoformat(texto[:10]).isoformat()
    except ValueError:
        return None


def _inteiro(valor):
    """KM e código de OS chegam como texto; aceita separador de milhar."""
    texto = _texto(valor) or ""
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", texto):
        texto = texto.replace(".", "")
    texto = texto.split(",")[0]
    return int(texto) if texto.isdigit() else None


def _numero(valor):
    return float(valor) if isinstance(valor, (int, float)) and valor == valor else None


def placa_valida(valor):
    placa = re.sub(r"[^A-Z0-9]", "", str(valor or "").upper())
    if not 5 <= len(placa) <= 10:
        raise ValueError("Placa inválida.")
    return placa


def preparar(headers, rows, placa):
    """Linhas do Qlik → itens da placa. Devolve (linhas, descartadas).

    Fica fora a linha de outra placa, sem produto ou sem data. Não junta
    linhas iguais: duas linhas idênticas podem ser dois itens da OS.
    """
    faltam = [c for c in OBRIGATORIAS if c not in headers]
    if faltam:
        raise qlik.QlikErro(f"Colunas ausentes no objeto do Qlik: {', '.join(faltam)}.")
    indice = {c: headers.index(c) for c in (*OBRIGATORIAS, *OPCIONAIS) if c in headers}
    linhas, fora = [], 0
    for row in rows:
        def valor(coluna):
            i = indice.get(coluna)
            return row[i] if i is not None and i < len(row) else None
        data = _data(valor("Data Abertura"))
        produto = _texto(valor("Descrição"))
        if not data or not produto or re.sub(r"[^A-Z0-9]", "", str(valor("Placa") or "").upper()) != placa:
            fora += 1
            continue
        os_ = _inteiro(valor("Codigo OS"))
        km = _inteiro(valor("KM OS"))
        linha = {"data": data, "os": str(os_) if os_ is not None else _texto(valor("Codigo OS"), 30),
                 "produto": produto, "km": km if km and km > 0 else None}
        for coluna, campo in OPCIONAIS.items():
            linha[campo] = _numero(valor(coluna)) if coluna in NUMERICAS else _texto(valor(coluna))
        linhas.append(linha)
    return linhas, fora


class Consultor:
    """Sessão do Qlik aberta sob demanda e reaproveitada entre consultas.

    Falha numa consulta fecha a sessão e tenta mais uma vez com uma nova:
    o Qlik encerra sessões ociosas e a próxima consulta não pode herdar isso.
    """

    def __init__(self, fabrica=None):
        self.fabrica = fabrica or (lambda: qlik.Sessao(sv_paths.QLIK_TENANT, sv_paths.QLIK_APP_ID, str(sv_paths.CFG_QLIK)))
        self.sessao = None
        self.objeto = None

    def abrir(self):
        if self.sessao is None:
            s = self.fabrica()
            s.__enter__()
            try:
                h, headers, qcx = s.abrir_objeto(sv_paths.QLIK_OBJ_ID)
                self.objeto = (h, headers, qcx, s.campo_da_coluna(h, COLUNA_PLACA))
            except Exception:
                s.__exit__(None, None, None)
                raise
            self.sessao = s
        return self.sessao

    def fechar(self):
        if self.sessao is not None:
            try:
                self.sessao.__exit__(None, None, None)
            except Exception:  # noqa: BLE001 - fechar nunca derruba a próxima tentativa
                pass
        self.sessao = self.objeto = None

    def _uma_vez(self, placa):
        s = self.abrir()
        h, headers, qcx, campo = self.objeto
        # Zero casadas deixaria o campo sem seleção, isto é, a base inteira.
        if not s.selecionar_textos(campo, [placa]):
            return [], 0
        return preparar(headers, s.ler(h, headers, qcx, NUMERICAS), placa)

    def consultar(self, placa):
        # Qualquer falha (inclusive "socket is already closed", que não é
        # OSError) descarta a sessão: sem isso, uma sessão derrubada pelo Qlik
        # fazia todas as consultas seguintes falharem até o processo fechar.
        try:
            return self._uma_vez(placa)
        except Exception:  # noqa: BLE001 - a segunda tentativa decide
            self.fechar()
            return self._uma_vez(placa)

    def manter_viva(self):
        """Pergunta algo leve ao Qlik para a sessão parada não cair."""
        if self.sessao is None:
            return
        try:
            self.sessao.call("EngineVersion", -1, {})
        except Exception:  # noqa: BLE001 - sessão ruim é só descartada
            self.fechar()


def consultar(placa):
    c = Consultor()
    try:
        return c.consultar(placa)
    finally:
        c.fechar()


def _linhas_em_fila(entrada):
    """Lê a entrada numa thread: o laço principal pode esperar com prazo."""
    fila = queue.Queue()

    def ler():
        for linha in entrada:
            fila.put(linha)
        fila.put(None)
    threading.Thread(target=ler, daemon=True).start()
    return fila


def servir(entrada, saida, consultor=None, intervalo_ping=PING_S):
    """Atende pedidos, um por linha, até a entrada fechar.

    Sem pedido por `intervalo_ping` segundos, mantém a sessão viva com uma
    chamada leve ao Qlik, para a próxima placa não pagar a reconexão.
    """
    consultor = consultor or Consultor()
    fila = _linhas_em_fila(entrada)
    try:
        while True:
            try:
                bruto = fila.get(timeout=intervalo_ping)
            except queue.Empty:
                consultor.manter_viva()
                continue
            if bruto is None:
                break
            if not bruto.strip():
                continue
            pedido_id = None
            try:
                pedido = json.loads(bruto)
                pedido_id = pedido.get("id")
                if pedido.get("aquecer"):
                    consultor.abrir()
                    resposta = {"id": pedido_id, "pronto": True}
                else:
                    placa = placa_valida(pedido.get("placa"))
                    inicio = time.monotonic()
                    linhas, fora = consultor.consultar(placa)
                    print(f"Placa {placa}: {len(linhas):,} itens em {time.monotonic() - inicio:.1f} s ({fora:,} descartados).", file=sys.stderr)
                    resposta = {"id": pedido_id, "placa": placa, "linhas": linhas}
            except Exception as erro:  # noqa: BLE001 - um pedido ruim não derruba o servidor
                resposta = {"id": pedido_id, "erro": str(erro)[:300]}
            saida.write("RESULTADO_JSON=" + json.dumps(resposta, ensure_ascii=False) + "\n")
            saida.flush()
    finally:
        consultor.fechar()


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["--servidor"]:
        servir(sys.stdin, sys.stdout)
        return 0
    placa = placa_valida(argv[0] if argv else "")
    inicio = time.monotonic()
    linhas, fora = consultar(placa)
    print(f"Placa {placa}: {len(linhas):,} itens de OS em {time.monotonic() - inicio:.1f} s ({fora:,} descartados).", file=sys.stderr)
    print("RESULTADO_JSON=" + json.dumps({"placa": placa, "linhas": linhas}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    for _s in (sys.stdin, sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    try:
        sys.exit(main())
    except (qlik.QlikErro, OSError, ValueError) as erro:
        print(f"ERRO: {erro}", file=sys.stderr)
        sys.exit(1)
