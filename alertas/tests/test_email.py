import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def carregar_email(monkeypatch, tmp_path):
    dest = tmp_path / "destinatarios.txt"
    dest.write_text("[PARA]\nteste@example.com\n", encoding="utf-8")
    fake = types.ModuleType("sv_paths")
    fake.OPERACAO = tmp_path / "alertas"
    fake.SMTP_SERVIDOR = "smtp.example.com"; fake.SMTP_PORTA = 587
    fake.SMTP_USUARIO = "teste@example.com"; fake.REMETENTE = "teste@example.com"
    fake.SMTP_SENHA = "segredo-teste"; fake.NOME_REMETENTE = "Portal Suprimentos"; fake.DESTINATARIOS = dest; fake.RELATORIOS_DIARIOS = tmp_path / "relatorios"
    monkeypatch.setitem(sys.modules, "sv_paths", fake)
    monkeypatch.delitem(sys.modules, "estado_entrega", raising=False)
    spec = importlib.util.spec_from_file_location("email_test", ROOT / "processo" / "enviar_email.py")
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


def resumo(**mudancas):
    r = {"total_bruto": 1, "total_elegivel": 0, "total_quarentena": 1,
         "contagens": {"CONFORME": 0, "ACIMA DO ACORDO": 0, "ABAIXO DO ACORDO": 0,
                       "SEM ACORDO": 0, "ACORDO AMBÍGUO": 1,
                       "ACORDO SEM PREÇO VÁLIDO": 0},
         "percentuais_elegiveis": {"CONFORME": 0, "ACIMA DO ACORDO": 0,
                                    "ABAIXO DO ACORDO": 0, "SEM ACORDO": 0},
         "percentual_quarentena_bruto": 100.0, "alerta_sem_acordo": False,
         "limite_alerta_sem_acordo": 75.0, "comparavel": False}
    r.update(mudancas)
    return "RESUMO_JSON=" + json.dumps(r, ensure_ascii=False)


def test_anexo_informado_e_ausente_aborta(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    with pytest.raises(mod.RelatorioAusente):
        mod.anexo_da_execucao(tmp_path / "ausente.xlsx", "com_acordo")


def test_corpo_conta_apenas_registros_fora_do_acordo(monkeypatch, tmp_path):
    """O corpo diz quantos registros estao fora do acordo — acima + abaixo."""
    mod = carregar_email(monkeypatch, tmp_path)
    dados = resumo(contagens={"CONFORME": 10, "ACIMA DO ACORDO": 3,
                              "ABAIXO DO ACORDO": 2, "SEM ACORDO": 5,
                              "ACORDO AMBÍGUO": 0, "ACORDO SEM PREÇO VÁLIDO": 0})
    corpo = mod.montar_corpo("parcial", ["01/08/2026"], dados)
    assert "5 registros fora do acordo" in corpo


def test_corpo_no_singular_quando_ha_um_registro(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    dados = resumo(contagens={"CONFORME": 0, "ACIMA DO ACORDO": 1,
                              "ABAIXO DO ACORDO": 0, "SEM ACORDO": 0,
                              "ACORDO AMBÍGUO": 0, "ACORDO SEM PREÇO VÁLIDO": 0})
    corpo = mod.montar_corpo("parcial", ["01/08/2026"], dados)
    assert "1 registro fora do acordo" in corpo
    assert "1 registros" not in corpo


def test_corpo_sem_divergencia_nao_menciona_anexo(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    corpo = mod.montar_corpo("parcial", ["01/08/2026"], resumo())
    assert "Nenhum registro fora do acordo" in corpo
    assert "anexo" not in corpo.lower()


def test_corpo_nao_traz_mais_a_analise(monkeypatch, tmp_path):
    """Regressao: a analise migrou para o recorte historico. O corpo nao pode
    voltar a carregar tabela, percentuais, filtros ou alerta de cobertura."""
    mod = carregar_email(monkeypatch, tmp_path)
    dados = resumo(total_bruto=22, total_elegivel=22, comparavel=True,
                   alerta_sem_acordo=True,
                   contagens={"CONFORME": 0, "ACIMA DO ACORDO": 0,
                              "ABAIXO DO ACORDO": 0, "SEM ACORDO": 22,
                              "ACORDO AMBÍGUO": 0, "ACORDO SEM PREÇO VÁLIDO": 0})
    corpo = mod.montar_corpo("parcial", ["14/09/2026"], dados)
    for proibido in ["RESUMO", "FILTROS APLICADOS", "ALERTA", "Total bruto",
                     "elegíveis", "Pendências", "Olá"]:
        assert proibido not in corpo, f"corpo voltou a conter '{proibido}'"
    assert len(corpo.strip().splitlines()) == 1


def test_modo_sem_envio_salva_preview_sem_abrir_smtp(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    monkeypatch.setenv("SUPPLY_VISION_SEM_ENVIO", "1")
    monkeypatch.setenv("SUPPLY_VISION_RUN_ID", "teste-paralelo")
    monkeypatch.setattr(mod.smtplib, "SMTP", lambda *a, **k: (_ for _ in ()).throw(AssertionError("SMTP nao deveria abrir")))
    destino = mod.enviar_email("Teste", "Corpo", [], ["teste@example.com"])
    assert destino.is_file()
    assert b"Subject: Teste" in destino.read_bytes()

def test_import_nao_le_destinatarios(monkeypatch, tmp_path):
    """Importar o modulo nao pode depender de destinatarios.txt existir.

    A lista era carregada no nivel do modulo: um `import` abria o arquivo e,
    faltando ele, encerrava o processo.
    """
    fake = types.ModuleType("sv_paths")
    fake.OPERACAO = tmp_path / "alertas"
    fake.SMTP_SERVIDOR = "smtp.example.com"; fake.SMTP_PORTA = 587
    fake.SMTP_USUARIO = "teste@example.com"; fake.REMETENTE = "teste@example.com"
    fake.SMTP_SENHA = "segredo-teste"; fake.NOME_REMETENTE = "Portal Suprimentos"
    fake.DESTINATARIOS = tmp_path / "nao-existe.txt"
    fake.RELATORIOS_DIARIOS = tmp_path / "relatorios"
    monkeypatch.setitem(sys.modules, "sv_paths", fake)
    monkeypatch.delitem(sys.modules, "estado_entrega", raising=False)
    spec = importlib.util.spec_from_file_location("email_sem_lista", ROOT / "processo" / "enviar_email.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # nao pode levantar SystemExit
    assert callable(mod.montar_assunto)

    # A falta so aparece quando a lista e realmente necessaria.
    with pytest.raises(SystemExit):
        mod.obter_destinatarios()


def test_copia_oculta_entra_na_entrega(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    dest = tmp_path / "com-cco.txt"
    dest.write_text("[PARA]\npara@example.com\n[CCO]\noculto@example.com\n", encoding="utf-8")
    mod._destinatarios = None
    para, cco = mod.obter_destinatarios(str(dest))
    assert para == ["para@example.com"]
    assert cco == ["oculto@example.com"]


def test_corpo_avisa_pendencias_sem_sugerir_periodo_limpo(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    corpo = mod.montar_corpo("parcial", ["01/08/2026"], resumo(alerta_pendencias=True))
    assert "100.0% das compras ficaram em pendência" in corpo
    assert "Não foi possível comparar" in corpo
    assert "Nenhum registro fora" not in corpo


def test_corpo_preserva_resumo_antigo_sem_alerta(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    for alteracoes in ({}, {"alerta_pendencias": False}):
        corpo = mod.montar_corpo("parcial", ["01/08/2026"], resumo(**alteracoes))
        assert "Nenhum registro" in corpo
        assert "ATENÇÃO" not in corpo


def test_assunto_e_corpo_de_segunda_incluem_domingo(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    datas = ["02/10/2026", "03/10/2026", "04/10/2026"]
    assunto = mod.montar_assunto("segunda_manha", datas)
    assert "02/10/2026, 03/10/2026 e 04/10/2026" in assunto
    corpo = mod.montar_corpo("segunda_manha", datas, resumo())
    assert "domingo (04/10/2026)" in corpo


def test_destinatario_recusado_e_falha(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    monkeypatch.delenv("SUPPLY_VISION_SEM_ENVIO", raising=False)

    envios = []
    class SMTP:
        def __init__(self, *args, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def ehlo(self): pass
        def starttls(self, *, context): pass
        def login(self, *args): pass
        def send_message(self, *args, **kwargs):
            envios.append(kwargs['to_addrs'])
            return {"ruim@example.com": (550, b"mailbox unavailable")}

    monkeypatch.setattr(mod.smtplib, "SMTP", SMTP)
    with pytest.raises(mod.DestinatariosRecusados, match="ruim@example.com"):
        mod.enviar_email("a", "b", [], ["teste@example.com", "ruim@example.com"], copia_oculta=[])
    with pytest.raises(mod.estado_entrega.EntregaEmRevisao):
        mod.enviar_email("a", "b", [], ["teste@example.com", "ruim@example.com"], copia_oculta=[])
    registro = mod.estado_entrega.consultar_entrega()
    assert registro['destinatarios'] == ['teste@example.com']
    assert 'ruim@example.com' in registro['recusados']
    assert len(envios) == 1


def test_resultado_incerto_bloqueia_retentativa_e_confirmado_nao_reenvia(monkeypatch, tmp_path):
    mod = carregar_email(monkeypatch, tmp_path)
    monkeypatch.delenv('SUPPLY_VISION_SEM_ENVIO', raising=False)
    mod.estado_entrega.registrar_entrega('incerto', ['teste@example.com'], exclusivo=True)
    monkeypatch.setattr(mod.smtplib, 'SMTP', lambda *a, **k: (_ for _ in ()).throw(AssertionError('Nao deveria abrir SMTP')))
    with pytest.raises(mod.estado_entrega.EntregaEmRevisao):
        mod.enviar_email('a', 'b', [], ['teste@example.com'], copia_oculta=[])
    mod.estado_entrega.registrar_entrega('enviado', ['teste@example.com'])
    mod.enviar_email('a', 'b', [], ['teste@example.com'], copia_oculta=[])
