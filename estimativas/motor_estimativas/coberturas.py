"""
Faixas de cobertura (R$) — lê SOMENTE a planilha única (já enriquecida por estimativas.py).

    calcular(df, prem) → uma linha por perfil × cobertura, com as colunas do template_coberturas_times
                         + valor_sugerido, faixa do seletor, estimativa (incerteza) e plano mínimo.

Todo insumo vem de contrato.valor_efetivo(): se o cliente confirmou área, padrão, bens, vínculo,
aluguel, dependentes ou pet, o cálculo usa o valor confirmado e a confiança sobe.
Premissas (percentuais, pisos, margens) ficam em config/premissas.json.

Lógica: incêndio = reconstrução (área × CUB/m² da UF × fator do padrão; em apartamento, só
benfeitorias internas) + conteúdo (bens por categoria). As demais coberturas usam dados próprios
(bens, aluguel, vidraçaria) ou, sem dado, premissas explícitas do time.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .contrato import CATEGORIAS_BENS, RAIZ, valor_efetivo


def brl(x: float) -> str:
    return f"{x:,.0f}".replace(",", ".")


def arred(x: float) -> int:
    if pd.isna(x):
        return 0
    return int(round(x, -2) if x < 10000 else round(x, -3))


def faixa_combinada(central: float, fatores: list[tuple[float, float]]) -> tuple[float, float]:
    """Incertezas independentes combinadas em quadratura no log (não multiplica todos os extremos)."""
    lo = np.sqrt(sum(np.log(a) ** 2 for a, _ in fatores))
    hi = np.sqrt(sum(np.log(b) ** 2 for _, b in fatores))
    return central * np.exp(-lo), central * np.exp(hi)


def preparar(df: pd.DataFrame, prem: dict) -> pd.DataFrame:
    """Resolve os valores efetivos de cada insumo (confirmado > observado > estimado)."""
    p = pd.DataFrame(index=df.index)
    for k in ["ID", "cliente_id", "imovel_id", "obs_uf_real", "obs_valor_aluguel_recorrente",
              "obs_valor_medio_credito_recorrente", "obs_gastos_vidracaria_24m"]:
        p[k] = df[k]
    a = valor_efetivo(df, "area_m2")
    p["area"], p["area_min"], p["area_max"] = a["valor"].astype(float), a["min"].astype(float), a["max"].astype(float)
    p["area_origem"], p["area_conf"] = a["origem"], a["confianca"]
    pad = valor_efetivo(df, "padrao_construtivo")
    # padrão só derivado (sugestão fraca) não estreita a faixa: conta como desconhecido até o cliente confirmar
    p["padrao"] = np.where(pad["origem"].isin(["OBSERVADO", "CONFIRMADO"]), pad["valor"], "NAO_DISPONIVEL")
    p["padrao_origem"] = pad["origem"]
    tipo = valor_efetivo(df, "tipo_imovel")["valor"]
    p["tipo"] = np.where(tipo == "APARTAMENTO", "APARTAMENTO", "CASA")
    p["vinculo"] = valor_efetivo(df, "tipo_vinculo")["valor"]
    for c in CATEGORIAS_BENS:
        b = valor_efetivo(df, f"valor_bens_{c}")
        p[f"bens_{c}_min"], p[f"bens_{c}_max"] = b["min"].astype(float), b["max"].astype(float)
        p[f"bens_{c}_origem"] = b["origem"]
    al = valor_efetivo(df, "aluguel_equivalente_mensal")
    p["alug_eq"], p["alug_eq_origem"] = pd.to_numeric(al["valor"], errors="coerce"), al["origem"]
    p["dependentes"] = pd.to_numeric(valor_efetivo(df, "quantidade_dependentes")["valor"], errors="coerce").fillna(0).astype(int)
    p["pet"] = valor_efetivo(df, "possui_pet")["valor"].isin(["SIM", True, "True", 1])
    cub = pd.read_csv(RAIZ / prem["dados_externos"]["cub_m2_uf"])
    p = p.merge(cub[["uf", "cub_r8n_m2", "referencia"]].rename(columns={"uf": "obs_uf_real"}), on="obs_uf_real", how="left")
    p["cub_origem"] = np.where(p["cub_r8n_m2"].isna(), "PADRAO_NACIONAL", "TABELA_UF")
    p["cub_r8n_m2"] = p["cub_r8n_m2"].fillna(prem["dados_externos"]["cub_padrao_nacional_m2"])
    p["referencia"] = p["referencia"].fillna("média nacional")
    return p


def calcular_imovel(r: pd.Series, prem: dict) -> list[dict]:
    pc, sel = prem["coberturas"], prem["seletor"]
    tipo, vinc = r["tipo"], r["vinculo"]
    padrao = r["padrao"] if r["padrao"] in pc["fator_padrao"] else "NAO_DISPONIVEL"
    f_lo, f_hi = pc["fator_padrao"][padrao]
    cub, a_lo, a_mid, a_hi = r["cub_r8n_m2"], r["area_min"], r["area"], r["area_max"]
    locador, inquilino = vinc == "PROPRIO_ALUGADO_TERCEIROS", vinc == "INQUILINO"
    area_txt = f"área {r['area_origem'].lower()} {a_mid:.0f} m²" + (
        f" (faixa {a_lo:.0f}–{a_hi:.0f} m²)" if r["area_origem"] == "ESTIMADO" else "")
    cub_txt = f"CUB R8-N {r['obs_uf_real']} (R$ {brl(cub)}/m², {r['referencia']})"

    # --- estrutura ---------------------------------------------------------------------------
    f_mid = (f_lo * f_hi) ** 0.5
    inc = [(a_lo / a_mid, a_hi / a_mid), (f_lo / f_mid, f_hi / f_mid)]
    if tipo == "APARTAMENTO":
        b0, b1 = pc["apto_benfeitorias"]
        b_mid = (b0 * b1) ** 0.5
        est_lo, est_hi = faixa_combinada(a_mid * cub * f_mid * b_mid, inc + [(b0 / b_mid, b1 / b_mid)])
        est_regra = (f"benfeitorias internas = área × {cub_txt} × fator do padrão {padrao} ({f_lo}–{f_hi}) × "
                     f"{b0:.0%}–{b1:.0%} (estrutura do prédio coberta pelo seguro obrigatório do condomínio)")
    else:
        est_lo, est_hi = faixa_combinada(a_mid * cub * f_mid, inc)
        est_regra = f"reconstrução = área × {cub_txt} × fator do padrão {padrao} ({f_lo}–{f_hi})"
    est_regra += "; incertezas de área e padrão combinadas como independentes"

    # --- conteúdo (bens efetivos por categoria) -------------------------------------------------
    bmin = {c: r[f"bens_{c}_min"] for c in CATEGORIAS_BENS}
    bmax = {c: r[f"bens_{c}_max"] for c in CATEGORIAS_BENS}
    bens_conf = all(r[f"bens_{c}_origem"] == "CONFIRMADO" for c in CATEGORIAS_BENS)
    if locador:
        con_lo = con_hi = 0.0
        con_regra = "conteúdo não incluído: imóvel alugado a terceiros (bens do inquilino)"
    else:
        con_lo, con_hi = sum(bmin.values()), sum(bmax.values())
        con_regra = ("conteúdo = soma dos bens por categoria (móveis, eletrodomésticos, eletrônicos, lazer)" +
                     (", confirmados pelo cliente" if bens_conf else ", estimados a partir de bens cadastrados e compras 36m"))
    inc_lo, inc_hi = est_lo + con_lo, est_hi + con_hi
    inc_c = (inc_lo * inc_hi) ** 0.5
    conf_inc = ("ALTA" if r["area_conf"] == "ALTA" and padrao != "NAO_DISPONIVEL" and r["cub_origem"] == "TABELA_UF"
                else "BAIXA" if r["area_conf"] == "BAIXA" else "MEDIA")
    confirmar_area = "área do imóvel (pré-preenchida); " if r["area_origem"] == "ESTIMADO" else ""
    confirmar_padrao = "padrão de acabamento; " if padrao == "NAO_DISPONIVEL" else ""
    linhas = []

    def add(cob, lo, hi, conf, dados, regra, just, confirmar, obs=""):
        if hi < lo:
            lo, hi = hi, lo
        if arred(hi) == arred(lo) and conf != "ALTA":   # piso prevaleceu: abre a faixa de 1x a 1,5x
            hi = lo * 1.5
            obs = (obs + " Piso aplicado.").strip()
        sug = (lo * hi) ** 0.5                       # valor exato (confirmado) → sugestão = o próprio valor
        m_lo, m_hi = sel["margem_por_confianca"][conf]
        if cob == "INCENDIO_RAIO_EXPLOSAO_FUMACA":
            obs = (obs + " Valores abaixo da sugestão aumentam o risco de rateio: a indenização cai na proporção "
                         "em que o valor segurado fica abaixo do valor em risco.").strip()
        passo = sel["passo"]["abaixo"] if sug < sel["passo"]["limite"] else sel["passo"]["acima"]
        linhas.append({
            "cliente_id": r["cliente_id"], "imovel_id": r["imovel_id"], "cobertura": cob,
            "faixa_valor_min": arred(sug * (1 - m_lo)), "faixa_valor_max": arred(sug * (1 + m_hi)),
            "confianca_estimativa": conf, "dados_utilizados": dados,
            "regra_calculo_utilizada": (f"sugestão = centro da estimativa ({brl(arred(lo))}–{brl(arred(hi))}); faixa de escolha = "
                                        f"sugestão -{m_lo:.0%}/+{m_hi:.0%} (confiança {conf.lower()}). Estimativa: {regra}"),
            "justificativa": just, "informacao_a_confirmar": confirmar.strip().rstrip(";"), "observacao": obs,
            "valor_sugerido": arred(sug), "margem_seletor": f"-{m_lo:.0%}/+{m_hi:.0%}", "passo_seletor": passo,
            "estimativa_min": arred(lo), "estimativa_max": arred(hi), "plano_minimo": prem["catalogo"][cob],
            "ID": r["ID"], "tipo_imovel": tipo, "tipo_vinculo": vinc, "area_origem": r["area_origem"],
        })

    add("INCENDIO_RAIO_EXPLOSAO_FUMACA", inc_lo, inc_hi, conf_inc,
        f"{area_txt}; padrão {padrao} ({r['padrao_origem'].lower()}); CUB/m² da UF; bens por categoria; vínculo {vinc}",
        f"limite único imóvel + conteúdo: {est_regra}; {con_regra}",
        "Cobertura básica: deve repor a reconstrução e o conteúdo; valor abaixo disso gera rateio na indenização.",
        confirmar_area + confirmar_padrao + ("se o imóvel é mobiliado; " if locador else "") +
        ("se o contrato de locação exige seguro do imóvel; " if inquilino else ""),
        ("Imóvel alugado: beneficiário do imóvel é o locador e do conteúdo é o locatário. " if inquilino else "") +
        ("Financiado: o seguro habitacional (DFI) já cobre danos físicos ao imóvel; confirmar para evitar sobreposição."
         if vinc == "PROPRIO_FINANCIADO" else ""))

    add("QUEDA_AERONAVE", inc_lo, inc_hi, conf_inc, "mesma base da cobertura de incêndio",
        "igual à faixa de incêndio (evento de perda total) [premissa do time]",
        "Evento raro, mas de destruição total: a referência é o mesmo valor em risco da cobertura básica.", confirmar_area)

    for cob, just in [("DANOS_POR_AGUA", "Vazamentos e rompimentos danificam acabamentos e bens, raramente o imóvel inteiro."),
                      ("VENDAVAL_GRANIZO", "Casas expõem telhado e esquadrias; em apartamento o dano se concentra em janelas e varanda."),
                      ("IMPACTO_VEICULOS_TERRESTRES", "Dano típico em muro, portão e fachada; menor exposição em apartamento.")]:
        p = pc["percentual_incendio"][cob]
        lo_p, hi_p = p[tipo]
        add(cob, max(inc_c * lo_p, p["piso"]), max(inc_c * hi_p, p["piso"]), "BAIXA", "valor central de incêndio; tipo do imóvel",
            f"{lo_p:.0%}–{hi_p:.0%} do valor central de incêndio (R$ {brl(inc_c)}) para {tipo.lower()}, "
            f"mínimo R$ {brl(p['piso'])} [premissa do time]", just, "",
            "Percentual sem base própria nos dados; validar com os limites do produto." +
            (" Enriquecimento possível: histórico de desastres por município (S2iD)." if cob == "VENDAVAL_GRANIZO" else ""))

    piso = pc["piso_bens"]
    el_lo = max(bmin["eletrodomestico"] + bmin["eletronico"], piso)
    el_hi = max(bmax["eletrodomestico"] + bmax["eletronico"], el_lo)
    add("DANOS_ELETRICOS", el_lo, min(el_hi, inc_hi), "ALTA" if bens_conf else "MEDIA",
        "bens efetivos de eletrodomésticos e eletrônicos",
        f"soma das categorias eletrodomésticos e eletrônicos (faixa de bens); piso R$ {brl(piso)}",
        "Danos elétricos atingem equipamentos ligados à rede: a faixa segue o valor desses bens.",
        "" if bens_conf else "equipamentos de maior valor e se estão neste imóvel")

    pr = pc["pequenos_reparos"]
    add("INSTALACOES_PEQUENOS_REPAROS", pr[0], pr[1], "BAIXA", "nenhum dado específico",
        f"valor fixo R$ {brl(pr[0])}–{brl(pr[1])} [premissa do time]",
        "Cobertura listada como fixa no guia final; reparos de pequeno valor.", "",
        "Ausente do catalogo_coberturas_fixas_planos.csv; confirmar nomenclatura e limite com a organização.")

    pesos = pc["roubo_peso_categoria"]
    if locador:
        rb_lo, rb_hi, rb_conf = piso, piso * 2, "BAIXA"
    else:
        rb_lo = max(sum(bmin[c] * pesos.get(c, 0) for c in CATEGORIAS_BENS), piso)
        rb_hi = max(sum(bmax[c] * pesos.get(c, 0) for c in CATEGORIAS_BENS), rb_lo)
        rb_conf = "ALTA" if bens_conf else "MEDIA"
    peso_txt = ", ".join(f"{c} {w:.0%}" for c, w in pesos.items())
    add("ROUBO_FURTO_ARROMBAMENTO", rb_lo, rb_hi, rb_conf, "bens efetivos por categoria",
        f"soma ponderada das categorias de bens ({peso_txt}) [premissa do time]; piso R$ {brl(piso)}",
        "Roubo atinge principalmente bens portáteis e de valor; móveis raramente são levados.",
        ("bens de maior valor e se ficam neste imóvel" + ("; se o imóvel é mobiliado" if locador else "")) if not bens_conf else "")

    v_lo, v_hi = pc["vidros_base"][tipo]
    vid = r["obs_gastos_vidracaria_24m"]
    fg = pc["vidros_fator_gasto"]
    if vid > 0:
        v_lo, v_hi = max(v_lo, fg[0] * vid), max(v_hi, fg[1] * vid)
    add("QUEBRA_DE_VIDROS", v_lo, v_hi, "MEDIA" if vid > 0 else "BAIXA",
        "tipo do imóvel" + ("; gasto com vidraçaria em 24 meses" if vid > 0 else ""),
        f"base {tipo.lower()} R$ {brl(pc['vidros_base'][tipo][0])}–{brl(pc['vidros_base'][tipo][1])} [premissa do time]" +
        (f"; ajustada pelo gasto com vidraçaria (R$ {brl(vid)}): {fg[0]:.0%}–{fg[1]:.0%} do gasto" if vid > 0 else ""),
        "Vidros, espelhos e box; gasto recente com vidraçaria indica valor relevante instalado.",
        "box, sacada envidraçada ou vidros grandes" if vid == 0 else "")

    rc = pc["rc_familiar"]
    dep, pet = int(r["dependentes"]), bool(r["pet"])
    add("RESPONSABILIDADE_CIVIL_FAMILIAR",
        min(rc["base"][0] + dep * rc["por_dependente"][0] + pet * rc["pet"][0], rc["teto"]),
        min(rc["base"][1] + dep * rc["por_dependente"][1] + pet * rc["pet"][1], rc["teto"]), "BAIXA",
        "quantidade de dependentes; pet",
        f"base R$ {brl(rc['base'][0])}–{brl(rc['base'][1])} + R$ {brl(rc['por_dependente'][0])}–{brl(rc['por_dependente'][1])} "
        f"por dependente + R$ {brl(rc['pet'][0])}–{brl(rc['pet'][1])} com pet; teto R$ {brl(rc['teto'])} [premissa do time]",
        "Cobre danos causados a terceiros pela família; dependentes e pet aumentam a exposição (necessidade, não risco do cliente).",
        "dependentes e pet")

    meses = pc["aluguel_meses"]
    eq_conf = r["alug_eq_origem"] == "CONFIRMADO"
    if inquilino and r["obs_valor_aluguel_recorrente"] > 0:
        ref, m, txt, c_al = r["obs_valor_aluguel_recorrente"], meses["INQUILINO"], "aluguel pago (observado)", "ALTA"
    elif locador and r["obs_valor_medio_credito_recorrente"] > 0:
        ref, m, txt, c_al = r["obs_valor_medio_credito_recorrente"], meses["PROPRIO_ALUGADO_TERCEIROS"], \
            "aluguel recebido (crédito recorrente observado)", "ALTA"
    else:
        # sem valor observado: aluguel informado pelo cliente ou aluguel equivalente estimado
        m = meses["INQUILINO"] if inquilino else meses["PROPRIO_ALUGADO_TERCEIROS"] if locador else meses["MORADOR_PROPRIETARIO"]
        ref = r["alug_eq"]
        txt, c_al = ("aluguel informado pelo cliente", "ALTA") if eq_conf else \
            ("aluguel equivalente estimado (área × R$/m² de aluguel dos inquilinos)", "BAIXA")
    add("PERDA_PAGAMENTO_ALUGUEL", ref * m[0], ref * m[1], c_al, f"{txt}; vínculo {vinc}", f"{txt} × {m[0]} a {m[1]} meses",
        {"INQUILINO": "Paga o aluguel enquanto o imóvel fica inabitável após sinistro.",
         "PROPRIO_ALUGADO_TERCEIROS": "Repõe o aluguel que o proprietário deixa de receber após sinistro."}.get(
            vinc, "Paga moradia provisória enquanto o imóvel próprio é reparado."),
        "" if c_al == "ALTA" else ("valor do aluguel" if (inquilino or locador) else "valor de aluguel de um imóvel equivalente"))

    p = pc["percentual_incendio"]["DESPESAS_EMERGENCIAIS"]
    de_hi = min(max(inc_c * p[tipo][1], p["piso"]), p["teto"])
    de_lo = min(max(inc_c * p[tipo][0], p["piso"]), de_hi / 2 if de_hi == p["teto"] else de_hi)
    add("DESPESAS_EMERGENCIAIS", de_lo, de_hi, "BAIXA", "valor central de incêndio",
        f"{p[tipo][0]:.0%}–{p[tipo][1]:.0%} do valor central de incêndio (R$ {brl(inc_c)}), entre R$ {brl(p['piso'])} "
        f"e R$ {brl(p['teto'])} [premissa do time]", "Despesas imediatas após sinistro (contenção, guarda de bens, mudança).", "",
        "Percentual sem base própria nos dados; validar com os limites do produto.")
    return linhas


COLUNAS_SAIDA = ["cliente_id", "imovel_id", "cobertura", "faixa_valor_min", "faixa_valor_max", "confianca_estimativa",
                 "dados_utilizados", "regra_calculo_utilizada", "justificativa", "informacao_a_confirmar", "observacao",
                 "valor_sugerido", "margem_seletor", "passo_seletor", "estimativa_min", "estimativa_max", "plano_minimo",
                 "ID", "tipo_imovel", "tipo_vinculo", "area_origem"]


def calcular(df: pd.DataFrame, prem: dict) -> pd.DataFrame:
    p = preparar(df, prem)
    return pd.DataFrame([l for _, r in p.iterrows() for l in calcular_imovel(r, prem)])[COLUNAS_SAIDA]
