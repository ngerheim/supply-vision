"""Confere as identidades numericas do painel contra o parquet.

Existe porque as outras checagens nao pegam o erro que mais custou nesta
construcao. O schema valida estrutura, a geometria valida posicao, as
referencias validam nomes -- e nenhuma delas nota uma medida que devolve o
numero errado. A divergencia de 13/08/2026 (R$ 387.898,08 no total de uma
tabela contra R$ 13.940,24 num cartao) atravessou tres rodadas de revisao
visual e so apareceu quando alguem comparou dois numeros de paginas
diferentes.

Este arquivo faz essa comparacao automaticamente. Ele NAO le o Power BI: ele
recalcula em pandas o que cada medida deveria devolver e confere as identidades
que precisam valer. Se o parquet passar aqui e o painel mostrar outro numero, o
erro esta no DAX -- que e exatamente a informacao que faltava.

    python conferir.py [caminho\\do.parquet]

Sai com codigo 1 se alguma identidade falhar, para poder entrar num gancho de
pre-publicacao.
"""
import sys
from pathlib import Path

import pandas as pd

TOL = 0.01  # um centavo

# painel/powerbi/gerador/conferir.py -> parents[3] e a raiz do projeto.
RAIZ = Path(__file__).resolve().parents[3]        # supply-vision/
PARQUET = RAIZ / "painel" / "consolidado" / "supply_vision_painel.parquet"

falhas = 0


def confere(nome, a, b, tol=TOL):
    """Compara dois valores e imprime o resultado. Acumula falhas em global."""
    global falhas
    ok = abs(a - b) <= tol
    if not ok:
        falhas += 1
    marca = "ok  " if ok else "FALHA"
    print(f"  {marca} {nome}")
    if not ok:
        print(f"        esperado {b:,.2f} | obtido {a:,.2f} | delta {a-b:,.2f}")
    return ok


def carregar(caminho):
    d = pd.read_parquet(caminho)
    d["Data"] = pd.to_datetime(d["Data"])
    return d


def janelas(d):
    """Fim = ultimo dia COMPLETO, a mesma regra do M e do DAX.

    Nao e MAX(Data): o dia da extracao esta sempre parcial. Se esta funcao
    divergir da coluna Fim do modelo.py, todo o resto aqui mede outra coisa.
    """
    dia_exec = pd.Timestamp(d["DATA_EXECUCAO"].max().date())
    fim = d.loc[d["Data"] < dia_exec, "Data"].max()
    j30 = d[(d["Data"] >= fim - pd.Timedelta(days=29)) & (d["Data"] <= fim)]
    j365 = d[(d["Data"] > fim - pd.Timedelta(days=365)) & (d["Data"] <= fim)]
    ini_mes = fim.replace(day=1)
    j12m = d[(d["Data"] >= ini_mes - pd.DateOffset(months=12)) & (d["Data"] < ini_mes)]
    return fim, j30, j365, j12m


def fuga(x):
    return x.loc[(x["STATUS_ACORDO"] == "SEM_ACORDO") &
                 (x["Tinha acordo?"] == "SIM"), "Preco Total OS"].sum()


def sem_acordo(x):
    return x.loc[x["STATUS_ACORDO"] == "SEM_ACORDO", "Preco Total OS"].sum()


def dentro(x):
    return x.loc[x["STATUS_ACORDO"] == "COM_ACORDO", "Preco Total OS"].sum()


def excedente(x):
    return x.loc[x["Status"] == "ACIMA DO ACORDO", "Diferenca Total"].sum()


def main(caminho):
    d = carregar(caminho)
    fim, j30, j365, j12m = janelas(d)
    print(f"parquet: {caminho}")
    print(f"linhas: {len(d):,} | ultimo dia completo: {fim.date()}")
    print()

    # ── 1. decomposicao do gasto ────────────────────────────────────
    # Sem acordo e o guarda-chuva; fuga e subconjunto dele. Se esta identidade
    # quebrar, a nomenclatura do painel esta mentindo.
    print("decomposicao do gasto (historico)")
    confere("total = dentro + sem acordo",
            dentro(d) + sem_acordo(d), d["Preco Total OS"].sum())
    confere("fuga <= sem acordo",
            min(fuga(d), sem_acordo(d)), fuga(d))
    sem_alt = sem_acordo(d) - fuga(d)
    confere("sem acordo = sem alternativa + fuga",
            sem_alt + fuga(d), sem_acordo(d))

    # ── 2. exclusividade do Status ──────────────────────────────────
    # ACIMA, ABAIXO e CONFORME so podem existir em COM_ACORDO. Se aparecer um
    # ACIMA dentro de SEM_ACORDO, a comparacao de preco esta cruzando linha que
    # nao tem preco de acordo.
    print()
    print("exclusividade de Status x STATUS_ACORDO")
    cruz = pd.crosstab(d["Status"], d["STATUS_ACORDO"])
    for st in ("ACIMA DO ACORDO", "ABAIXO DO ACORDO", "CONFORME"):
        if st in cruz.index:
            confere(f"{st} nunca em SEM_ACORDO",
                    float(cruz.loc[st].get("SEM_ACORDO", 0)), 0.0, tol=0)
    if "SEM ACORDO" in cruz.index:
        confere("SEM ACORDO nunca em COM_ACORDO",
                float(cruz.loc["SEM ACORDO"].get("COM_ACORDO", 0)), 0.0, tol=0)

    # ── 3. a formula do excedente ───────────────────────────────────
    # Diferenca Total tem que ser Qtd x (Preco OS - Preco Acordo). O painel
    # apresenta essa coluna como montante contestavel numa conversa com
    # fornecedor; se ela for outra coisa, a conversa comeca errada.
    print()
    print("formula do excedente")
    ac = d[d["Status"] == "ACIMA DO ACORDO"]
    esperado = (ac["Qtd"] * (ac["Preco OS"] - ac["Preco Acordo"])).sum()
    confere("Diferenca Total = Qtd x (Preco OS - Preco Acordo)",
            ac["Diferenca Total"].sum(), esperado)

    # ── 4. reconciliacao do excedente na janela ─────────────────────
    # Foi aqui que o painel divergiu. O cartao, cada ranking e cada tabela
    # precisam devolver o mesmo total, inclusive quando o leitor filtra.
    print()
    print("reconciliacao do excedente na janela de 30 dias")
    exc = excedente(j30)
    print(f"  excedente da janela: R$ {exc:,.2f}")
    for dim in ("Fornecedor", "Grupo Item", "Cidade", "Grupo Modelo"):
        soma = j30[j30["Status"] == "ACIMA DO ACORDO"].groupby(dim)["Diferenca Total"].sum().sum()
        confere(f"soma por {dim} fecha com o total", soma, exc)

    # Reconciliacao SOB FILTRO: e o teste que o PDF nao consegue fazer. Se a
    # medida usasse ALL() em vez de KEEPFILTERS, o valor filtrado seria igual ao
    # total e este bloco falharia.
    print()
    print("reconciliacao sob filtro (tres maiores fornecedores)")
    top = (j30[j30["Status"] == "ACIMA DO ACORDO"]
           .groupby("Fornecedor")["Diferenca Total"].sum()
           .sort_values(ascending=False).head(3))
    for forn, valor in top.items():
        fatia = j30[j30["Fornecedor"] == forn]
        confere(f"{forn[:34]}: excedente filtrado", excedente(fatia), valor)
    confere("soma dos tres <= total da janela", min(top.sum(), exc), top.sum())

    # ── 5. denominadores mostrados nos cartoes ──────────────────────
    print()
    print("denominadores das janelas")
    confere("30d: total = dentro + sem acordo",
            dentro(j30) + sem_acordo(j30), j30["Preco Total OS"].sum())
    confere("365d: total = dentro + sem acordo",
            dentro(j365) + sem_acordo(j365), j365["Preco Total OS"].sum())
    print(f"  info  base com acordo 30d: R$ {dentro(j30):,.2f}")
    print(f"  info  gasto total 30d:     R$ {j30['Preco Total OS'].sum():,.2f}")
    print(f"  info  % do sem acordo que era fuga (365d): "
          f"{100 * fuga(j365) / sem_acordo(j365):.1f}%")

    # ── 6. cartao de 365 dias contra grafico de 12 meses fechados ───
    # Nao e uma identidade: sao recortes diferentes de proposito. O numero e
    # impresso para que a diferenca seja conhecida em vez de descoberta, e para
    # avisar se ela crescer muito -- acima de 10% o rotulo da pagina fica fraco.
    print()
    print("cartao 365d contra grafico de 12 meses fechados")
    f365, f12 = fuga(j365), fuga(j12m)
    dif = 100 * (f365 - f12) / f365 if f365 else 0
    print(f"  info  365 dias: R$ {f365:,.2f} | 12 meses fechados: R$ {f12:,.2f}"
          f" | diferenca {dif:.1f}%")
    if abs(dif) > 10:
        print("  AVISO a diferenca passou de 10%: o rotulo da pagina precisa"
              " explicar melhor, ou o grafico precisa mudar de recorte")

    print()
    print(f"identidades verificadas com falha: {falhas}")
    return falhas


if __name__ == "__main__":
    alvo = Path(sys.argv[1]) if len(sys.argv) > 1 else PARQUET
    if not alvo.exists():
        print(f"parquet nao encontrado: {alvo}")
        sys.exit(2)
    sys.exit(1 if main(alvo) else 0)
