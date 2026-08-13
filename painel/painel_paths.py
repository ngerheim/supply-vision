"""
Caminhos, configuração e contrato de colunas do Painel — snapshot completo
para o Power BI.

Mesma convenção de panorama/svp_paths.py: tudo deriva de RAIZ, então mover o
projeto não exige editar nada aqui.

Fase 1 (ver docs/desenho_painel_sv.md): sem CHAVE_REGISTRO, sem merge entre
execuções, sem rotação de N backups, disparo manual. Evolui quando a
necessidade aparecer, não antes.
"""
from pathlib import Path

PAINEL = Path(__file__).resolve().parent   # supply-vision/painel
RAIZ   = PAINEL.parent                     # supply-vision

# Motor de negócio, compartilhado com o pipeline diário e o panorama. Não
# duplica lógica: importa carregar_base, carregar_acordo, processar e
# STATUS_QUARENTENA direto de processo/rodar.py.
SUPPLY_VISION_SRC = RAIZ / "processo"

CHAVE_QLIK_PATH = RAIZ / "config" / "cfg_qlik.txt"

CANDIDATO_DIR    = PAINEL / "candidato"
CONSOLIDADO_DIR  = PAINEL / "consolidado"
ARQUIVADOS_DIR   = PAINEL / "arquivados"
LOGS_DIR         = PAINEL / "logs"

CONSOLIDADO_PATH = CONSOLIDADO_DIR / "supply_vision_painel.parquet"
BACKUP_PATH      = ARQUIVADOS_DIR / "supply_vision_painel_anterior.parquet"
LOCK_PATH        = PAINEL / ".lock"

# Base intermediária da extração, no mesmo espírito de dados/base.xlsx
# (diário) e dados/base_periodo.xlsx (panorama). Arquivo próprio: usar o do
# panorama faria uma execução do painel sobrescrever o recorte que o
# gerar_relatorios.py ainda vai ler, e vice-versa.
BASE_PAINEL_PATH = RAIZ / "dados" / "base_painel.xlsx"

# Início do recorte do painel. Os dados no Qlik começam em 2021, e a análise
# do negócio começa em 01/2025 — não é indiferente esticar para trás:
# selecionar_datas() envia um valor por dia corrido ao Qlik, então cada ano
# extra são ~365 valores inúteis na seleção.
INICIO_HISTORICO = "01/01/2025"

# Queda de linhas entre execuções acima deste percentual gera aviso no log.
# Não bloqueia: a decisão foi "o painel espelha o Qlik" (seção 9 do desenho).
LIMIAR_QUEDA_PCT = 10

# ── Contrato de colunas do snapshot ──────────────────────────────────
# Vive aqui, não no gerador: o validador precisa da lista sem arrastar
# rodar.py (e a conexão com o Qlik) só para conferir um cabeçalho.
#
# São as 21 colunas de saída de rodar.processar(). "Grupo Despesa" e
# "Peca Acordo", que ele também devolve, ficam fora — já não entram no
# relatório do pipeline diário (SEMPRE_OCULTAR em rodar.py).
COLUNAS_PAINEL = [
    "Data", "OS", "Criador", "Cidade", "Fornecedor", "Modelo", "Item",
    "Motivo Sem Acordo", "Qtd", "Preco OS", "Preco Acordo", "Preco Total OS",
    "Preco Total Acordo", "Diferenca Unit.", "Diferenca Total",
    "Tinha acordo?", "Menor Preco Acordo", "Fornecedor do Acordo",
    "Dif. p/ Menor Acordo", "Status", "CNPJ",
]

# Colunas acrescentadas pelo painel, além das de rodar.processar().
COLUNAS_META = ["Grupo Modelo", "Grupo Item", "STATUS_ACORDO", "DATA_EXECUCAO", "RUN_ID"]

# ── Agrupamento de modelos ───────────────────────────────────────────
# A nomenclatura do Qlik detalha versão, motor e carroceria, então o mesmo
# veículo aparece em várias linhas do ranking: "Hilux 2.8 Cd Dsl Power Pack
# 4x4", "Hilux Cd Sr At 4x4", "Hilux Cs Dsl 4x4"... Medido em 12/08/2026: 30
# modelos que são 11 veículos. Agrupar pela primeira palavra resolve — Hilux
# junta 6 variações e passa a responder por 54% do gasto.
#
# Três casos não são nome de modelo, e a primeira palavra sozinha viraria
# marca ("Kia") ou tipo de implemento ("Prancha"). Ficam explícitos aqui.
# Juntos são 15 linhas de 103 mil, mas explicitar custa pouco e evita um
# rótulo errado no painel.
GRUPO_MODELO_EXCECOES = {
    "Kia":      "Kia Bongo",
    "Mercedes": "Mercedes Atego",
    "Prancha":  "Prancha Plataforma",
}


# ── Agrupamento de itens ─────────────────────────────────────────────
# A descricao do Qlik tem varias grafias para a mesma peca: "ARTICULACAO
# AXIAL", "ARTICULAÇÃO", "ARTICULAÇÃO LD", "ARTICULAÇÃO LE" sao uma coisa so.
# O de-para parametros/de_para/itens.csv ja resolve isso -- e a mesma tabela
# que o rodar.py usa para cruzar com o ACORDOS.xlsx. Reaproveitar em vez de
# recriar: uma segunda copia da regra divergiria na primeira manutencao.
#
# Medido em 13/08/2026: 595 descricoes viram 430 grupos. "MAO DE OBRA REVISAO"
# consolida 25 grafias e R$ 601 mil.
def grupo_item(descricao, sinonimos, normalizar):
    """Descricao canonica do item, pelo de-para do projeto.

    sinonimos e normalizar entram como argumento em vez de import no topo
    para este modulo continuar sem dependencia de parametros/ -- ele e lido
    tambem por quem so quer os caminhos.
    """
    d = normalizar(descricao)
    return sinonimos.get(d) or d


def grupo_modelo(modelo):
    """Primeira palavra do modelo, com as exceções acima aplicadas."""
    if not modelo:
        return ""
    primeira = str(modelo).split()[0]
    return GRUPO_MODELO_EXCECOES.get(primeira, primeira)

# STATUS_ACORDO responde "a compra caiu dentro ou fora do acordo?" e deriva de
# Status — a mesma divisão que rodar.py usa para separar com_acordo.xlsx de
# sem_acordo.xlsx. NÃO deriva de "Tinha acordo?": essa coluna é a de
# oportunidade, e responde outra pergunta ("existia acordo para este item com
# QUALQUER fornecedor?", ignorando o fornecedor usado). Derivar dela marcaria
# 15.696 compras feitas fora do acordo como COM_ACORDO — medido na primeira
# execução real, 12/08/2026.
#
# As duas leituras seguem disponíveis no painel: STATUS_ACORDO diz se caiu
# fora, e "Tinha acordo?" separa, dentro do que caiu fora, o que era evitável
# (havia acordo e não foi usado) do que não tinha alternativa.
STATUS_ACORDO_DENTRO = "COM_ACORDO"
STATUS_ACORDO_FORA   = "SEM_ACORDO"

# Status válidos no painel: os de dentro do acordo (rodar.STATUS_COM_ACORDO)
# mais "SEM ACORDO". Os de quarentena são excluídos antes de chegar aqui.
STATUS_FORA = "SEM ACORDO"

for _dir in (CANDIDATO_DIR, CONSOLIDADO_DIR, ARQUIVADOS_DIR, LOGS_DIR):
    _dir.mkdir(parents=True, exist_ok=True)
