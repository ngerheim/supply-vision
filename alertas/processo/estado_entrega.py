"""Registro duravel por slot: entrega incerta exige revisao, nunca reenvio cego."""
import json
import os
import re
import secrets
from datetime import datetime
from pathlib import Path
import sv_paths

_MANUAL_ID = 'manual_' + secrets.token_hex(12)


class EntregaEmRevisao(RuntimeError):
    pass


def caminho_entrega():
    slot = os.environ.get('SV_ALERTA_SLOT', '')
    if re.fullmatch(r'\d{2}:\d{2}', slot):
        chave = f'{datetime.now():%Y-%m-%d}_{slot.replace(":", "")}'
    else:
        chave = re.sub(r'[^0-9A-Za-z_-]', '_', os.environ.get('SUPPLY_VISION_RUN_ID', _MANUAL_ID))
    return Path(sv_paths.OPERACAO) / 'estado-envios' / f'{chave}.json'


def consultar_entrega():
    arquivo = caminho_entrega()
    if not arquivo.exists():
        return None
    try:
        registro = json.loads(arquivo.read_text(encoding='utf-8'))
        if registro.get('estado') not in ('incerto', 'parcial', 'enviado'):
            raise ValueError('estado desconhecido')
        return registro
    except (ValueError, OSError, AttributeError) as exc:
        raise EntregaEmRevisao(f'Registro de entrega invalido: {arquivo}. Confira antes de reenviar.') from exc


def registrar_entrega(estado, destinatarios, recusados=None, exclusivo=False):
    arquivo = caminho_entrega()
    arquivo.parent.mkdir(parents=True, exist_ok=True)
    registro = {'estado': estado, 'atualizado': datetime.now().isoformat(),
                'run_id': os.environ.get('SUPPLY_VISION_RUN_ID', ''),
                'destinatarios': list(destinatarios), 'recusados': recusados or {}}
    temporario = arquivo.with_suffix('.' + secrets.token_hex(8) + '.tmp')
    alvo = arquivo if exclusivo else temporario
    try:
        with alvo.open('x', encoding='utf-8') as saida:
            json.dump(registro, saida, ensure_ascii=False)
            saida.flush()
            os.fsync(saida.fileno())
        if not exclusivo:
            os.replace(temporario, arquivo)
    except FileExistsError as exc:
        raise EntregaEmRevisao('Ja existe registro de entrega. Confira antes de reenviar.') from exc
    finally:
        temporario.unlink(missing_ok=True)


def cancelar_reserva_sem_entrega():
    # Somente rejeicao SMTP explicita anterior a qualquer aceitação de DATA.
    caminho_entrega().unlink()
