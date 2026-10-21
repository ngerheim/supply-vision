"""Estados, motivos e identidade compartilhados pelas etapas da comparação."""

import re
import pandas as pd


LIMITE_ALERTA_SEM_ACORDO = 75.0
LIMITE_ALERTA_PENDENCIAS = 50.0
STATUS_AMBIGUO         = "ACORDO AMBÍGUO"
STATUS_PRECO_INVALIDO  = "ACORDO SEM PREÇO VÁLIDO"
STATUS_DATA_INVALIDA   = "DATA DE ABERTURA INVÁLIDA"
STATUS_QUANTIDADE_INVALIDA = "QUANTIDADE INVÁLIDA"
STATUS_PRECO_COMPRA_INVALIDO = "PREÇO DE COMPRA INVÁLIDO"
STATUS_DIMENSAO_PENDENTE = "UF NÃO INFORMADA"
MOTIVO_NAO_COMPARAVEL = "Sem equivalente"
MOTIVO_FORNECEDOR     = "Fornecedor"
MOTIVO_CIDADE         = "Cidade"
MOTIVO_MODELO         = "Modelo"
MOTIVO_ITEM_MAPEAR    = "Sinonimo"
MOTIVO_ITEM           = "Item"
MOTIVO_AMBIGUO         = "Acordo ambíguo — preços divergentes"
MOTIVO_PRECO_INVALIDO  = "Acordo com preço inválido"
MOTIVO_DATA_INVALIDA   = "Data de abertura inválida"
MOTIVO_PRECO_COMPRA_INVALIDO = "Preço da compra ausente, ilegível ou não finito"
MOTIVO_QUANTIDADE_INVALIDA = "Quantidade ausente, ilegível, não finita ou não positiva"
STATUS_QUARENTENA = {STATUS_AMBIGUO, STATUS_PRECO_INVALIDO, STATUS_DATA_INVALIDA, STATUS_DIMENSAO_PENDENTE, STATUS_QUANTIDADE_INVALIDA, STATUS_PRECO_COMPRA_INVALIDO}
STATUS_COM_ACORDO = {"CONFORME", "ACIMA DO ACORDO", "ABAIXO DO ACORDO"}
STATUS_DIVERGENCIA = {"ACIMA DO ACORDO", "ABAIXO DO ACORDO"}
CHAVE_ACORDO = ["_fornec_norm", "_cidade_norm", "_modelo_norm", "_peca_norm"]
ORDEM_MOTIVOS = [MOTIVO_FORNECEDOR, MOTIVO_CIDADE, MOTIVO_MODELO,
                 MOTIVO_ITEM, MOTIVO_ITEM_MAPEAR, MOTIVO_NAO_COMPARAVEL,
                 MOTIVO_AMBIGUO, MOTIVO_PRECO_INVALIDO]



def _normcnpj(t):
    if pd.isna(t): return ""
    d = re.sub(r"\D", "", str(t))
    return d.zfill(14) if d else ""

