"""
Estimativas pré-preenchidas para confirmação — lê e escreve SOMENTE a planilha única.

    treinar_parametros(planilhas)          → parâmetros aprendidos (aluguel/m², IPTU/m² por cidade)
    enriquecer(df, art_area, params, prem) → planilha com est_/der_/conf_/ctl_ preenchidas

Métricas: área (modelo de ML) · bens por categoria · padrão de acabamento · tipo · uso · vínculo ·
aluguel equivalente · (dependentes e pet: só confirmação do cadastro).
Cada uma sai com valor sugerido + faixa + origem + confiança + pergunta pré-preenchida.

Princípios: renda e outros atributos pessoais NÃO estimam patrimônio; colunas obs_ nunca são
alteradas; tudo que depende de outro campo usa contrato.valor_efetivo() (confirmações valem).
"""
from __future__ import annotations

import json
from datetime import date

import numpy as np
import pandas as pd

from .contrato import CATEGORIAS_BENS, valor_efetivo
from . import modelo_area


def estimar_bens(pond, cad, compras, fracao_min: float = 0.5):
    """Faixa de uma categoria: mín = max(ponderado, fração × compras 36m); máx = cadastrado + compras;
    sugerido = média geométrica (ou metade do máx se o mín for zero)."""
    pond, cad = pd.Series(pond, dtype=float), pd.Series(cad, dtype=float)
    compras = pd.Series(compras, index=pond.index, dtype=float) if not isinstance(compras, pd.Series) else compras.astype(float)
    vmin = np.maximum(pond, fracao_min * compras)
    vmax = np.maximum(cad + compras, vmin)
    sug = pd.Series(np.where(vmin > 0, np.sqrt(vmin * vmax), 0.5 * vmax), index=pond.index)
    return sug, vmin, vmax


def arred(x) -> np.ndarray:
    x = pd.Series(x, dtype=float)
    return np.where(x < 10000, x.round(-2), x.round(-3))


def brl(x: float) -> str:
    return f"{x:,.0f}".replace(",", ".")


def treinar_parametros(planilhas: dict[str, pd.DataFrame]) -> dict:
    d = pd.concat(planilhas.values(), ignore_index=True)
    a = d[d["obs_area_cadastrada_m2"] > 0]
    iptu_m2 = a["obs_pagamento_iptu_anual"] / a["obs_area_cadastrada_m2"]
    inq = a[a["obs_valor_aluguel_recorrente"] > 0]
    alug_m2 = inq["obs_valor_aluguel_recorrente"] / inq["obs_area_cadastrada_m2"]
    return {
        "iptu_m2_mediana_cidade": iptu_m2.groupby(a["obs_municipio_real"]).median().round(2).to_dict(),
        "iptu_m2_mediana_global": round(float(iptu_m2.median()), 2),
        "aluguel_m2_quartis": [round(float(q), 2) for q in alug_m2.quantile([.25, .5, .75])],
        "n_imoveis_com_area": int(len(a)), "n_inquilinos_com_area": int(len(inq)),
    }


def _set(df: pd.DataFrame, nome: str, valores, novas: list) -> None:
    if nome not in df.columns:
        novas.append(nome)
    df[nome] = valores


def enriquecer(df: pd.DataFrame, art_area: dict, params: dict, prem: dict) -> pd.DataFrame:
    df = df.copy()
    original = list(df.columns)
    novas: list[str] = []
    pe = prem["estimativas"]

    # --- tipo, uso e vínculo sugeridos (derivados dos sinais) ---------------------------------
    apto = df["obs_possui_termo_apartamento"] == "SIM"
    cond = df["obs_possui_termo_condominio"] == "SIM"
    _set(df, "der_tipo_imovel_sugerido", np.where(apto, "APARTAMENTO", np.where(cond, "CASA_CONDOMINIO", "CASA")), novas)
    aluga = df["obs_credito_recorrente_compativel_aluguel"] == "SIM"
    _set(df, "der_tipo_vinculo_sugerido", np.select(
        [df["obs_pagamento_aluguel_recorrente"] == "SIM", df["obs_parcela_financiamento_imobiliario"] > 0, aluga],
        ["INQUILINO", "PROPRIO_FINANCIADO", "PROPRIO_ALUGADO_TERCEIROS"], "PROPRIO_QUITADO_PRESUMIDO"), novas)
    _set(df, "der_uso_imovel_sugerido", np.select(
        [aluga, df["obs_endereco_principal_compativel"] == "SIM"],
        ["ALUGADO_A_TERCEIROS", "RESIDENCIAL_HABITUAL"], "A_CONFIRMAR_TEMPORADA_OU_DESOCUPADO"), novas)

    # --- área: modelo de ML ----------------------------------------------------------------------
    est = modelo_area.estimar(df, art_area)
    for c in est.columns:
        _set(df, c, est[c].values, novas)
    area = valor_efetivo(df, "area_m2")
    _set(df, "der_area_para_calculo_m2", area["valor"].astype(float).values, novas)
    _set(df, "ctl_origem_area_para_calculo", area["origem"].values, novas)
    meta = {
        "ctl_estimativa_area_status": "CALCULADO",
        "ctl_estimativa_area_metodo": "ENSEMBLE_ML_GB_HGB_RIDGE_LOG_AREA",
        "ctl_estimativa_area_formula": ("média de 3 modelos em log(área) com estimadores físicos: IPTU/(R$/m² cidade×padrão), "
                                        "energia/(R$/m² tipo), condomínio/(R$/m² cidade); faixa P10–P90 por resíduos fora da amostra"),
        "ctl_estimativa_area_versao_metodo": art_area["versao"],
        "ctl_estimativa_area_dados_utilizados_json": json.dumps(modelo_area.SINAIS_DOMINIO + [
            "obs_municipio_real", "obs_padrao_construtivo_cadastrado", "obs_possui_termo_apartamento"]),
        "ctl_estimativa_area_parametros_json": json.dumps({"faixa": "P10-P90", "fatores": art_area["fatores_faixa"],
                                                           "n_treino": art_area["n_treino"], "atributos_pessoais": "nenhum"}),
        "ctl_estimativa_area_fonte_referencia": "motor_estimativas/modelo_area.py · artefatos/metricas_modelo_area.json",
        "ctl_estimativa_area_data_referencia": date.today().isoformat(),
        "ctl_estimativa_area_limitacoes": ("erro mediano ~11% (validação cruzada e teste à parte); sinais fora da faixa "
                                           "de treino reduzem a confiança; confirmar com o cliente"),
    }
    for k, v in meta.items():
        _set(df, k, v, novas)

    # --- bens por categoria (sem renda) ---------------------------------------------------------
    tot_s = tot_lo = tot_hi = 0
    for cat in CATEGORIAS_BENS:
        col_compra = pe["categorias_bens"][cat]
        sug, vmin, vmax = estimar_bens(df[f"est_valor_bens_{cat}_ponderado_referencia"].fillna(0),
                                       df[f"der_valor_bens_{cat}_cadastrado_referencia"].fillna(0),
                                       df[col_compra].fillna(0) if col_compra else 0.0, pe["fracao_compras_min"])
        _set(df, f"est_valor_bens_{cat}_sugerido", arred(sug), novas)
        _set(df, f"est_valor_bens_{cat}_min", arred(vmin), novas)
        _set(df, f"est_valor_bens_{cat}_max", arred(vmax), novas)
        tot_s, tot_lo, tot_hi = tot_s + sug, tot_lo + vmin, tot_hi + vmax
    _set(df, "est_valor_bens_sugerido", arred(tot_s), novas)
    _set(df, "est_valor_bens_min", arred(tot_lo), novas)
    _set(df, "est_valor_bens_max", arred(tot_hi), novas)
    _set(df, "ctl_status_faixa_bens", "CALCULADO", novas)
    _set(df, "ctl_estimativa_bens_regra",
         f"por categoria: mín = maior entre bens ponderados e {pe['fracao_compras_min']:.0%} das compras 36m; "
         "máx = bens cadastrados + compras 36m; sugerido = média geométrica; renda NÃO utilizada", novas)

    # --- padrão sugerido (sinal fraco; só onde falta) ---------------------------------------------
    lo, hi = pe["padrao_limites_iptu_m2_relativo"]
    ref = df["obs_municipio_real"].map(params["iptu_m2_mediana_cidade"]).fillna(params["iptu_m2_mediana_global"])
    rel = df["obs_pagamento_iptu_anual"] / df["der_area_para_calculo_m2"] / ref
    tem_pad = df["obs_padrao_construtivo_cadastrado"] != "NAO_DISPONIVEL"
    _set(df, "der_padrao_construtivo_sugerido", np.where(
        tem_pad, df["obs_padrao_construtivo_cadastrado"],
        np.where(rel >= hi, "SUPERIOR", np.where(rel <= lo, "ECONOMICO", "NORMAL"))), novas)
    _set(df, "ctl_confianca_padrao_sugerido", np.where(tem_pad, "ALTA", "BAIXA"), novas)
    _set(df, "ctl_padrao_sugerido_regra", f"IPTU/m² relativo à mediana da cidade: ≤{lo} econômico, ≥{hi} superior "
         "(acerto de 63% onde há padrão cadastrado; usar só como sugestão)", novas)

    # --- aluguel equivalente (proprietário que mora no imóvel) ------------------------------------
    q1, q2, q3 = params["aluguel_m2_quartis"]
    vinc = valor_efetivo(df, "tipo_vinculo")["valor"]
    morador = vinc.isin(["PROPRIO_FINANCIADO", "PROPRIO_QUITADO_PRESUMIDO", "PROPRIO_QUITADO"]).values
    for suf, a_col, q in [("", "valor", q2), ("_min", "min", q1), ("_max", "max", q3)]:
        _set(df, f"est_aluguel_equivalente_mensal{suf}", arred(area[a_col].astype(float) * q), novas)
    _set(df, "ctl_estimativa_aluguel_regra", f"área × R$/m² de aluguel dos inquilinos (mediana R$ {q2:.1f}; "
         f"P25–P75 R$ {q1:.1f}–{q3:.1f}); pergunta pré-preenchida só para proprietário morador", novas)
    _set(df, "ctl_aluguel_equivalente_perguntar", np.where(morador, "SIM", "NAO"), novas)

    # --- colunas de confirmação (criadas vazias se ainda não existirem) ---------------------------
    for campo in ["padrao_construtivo", *[f"valor_bens_{c}" for c in CATEGORIAS_BENS], "aluguel_equivalente_mensal",
                  "quantidade_dependentes", "possui_pet"]:
        if f"conf_{campo}" not in df.columns:
            _set(df, f"conf_{campo}", np.nan, novas)
            _set(df, f"ctl_status_conf_{campo}", "NAO_COLETADO", novas)

    _set(df, "ctl_sugestoes_confirmacao_json", sugestoes(df), novas)
    _set(df, "ctl_status_inferencias", "CALCULADO", novas)

    # colunas novas entram junto do seu grupo de prefixo; a ordem original é preservada
    cols = original.copy()
    for nome in novas:
        pref = nome.split("_")[0] + "_"
        pos = [i for i, c in enumerate(cols) if c.startswith(pref)]
        cols.insert((max(pos) + 1) if pos else len(cols), nome)
    return df[cols]


def sugestoes(df: pd.DataFrame) -> list[str]:
    """Lista, por perfil, do que a Bússola deve mostrar pré-preenchido (só o que ainda não foi confirmado)."""
    area, pad = valor_efetivo(df, "area_m2"), valor_efetivo(df, "padrao_construtivo")
    vinc, uso = valor_efetivo(df, "tipo_vinculo"), valor_efetivo(df, "uso_imovel")
    alug = valor_efetivo(df, "aluguel_equivalente_mensal")
    bens = {c: valor_efetivo(df, f"valor_bens_{c}") for c in CATEGORIAS_BENS}
    dep, pet = valor_efetivo(df, "quantidade_dependentes"), valor_efetivo(df, "possui_pet")
    out = []
    for i in df.index:
        s = []
        if area.at[i, "origem"] == "ESTIMADO":
            s.append({"campo": "area_m2", "prioridade": "P2", "valor_sugerido": float(area.at[i, "valor"]),
                      "min": float(area.at[i, "min"]), "max": float(area.at[i, "max"]), "origem": "ESTIMADO",
                      "confianca": area.at[i, "confianca"],
                      "pergunta": f"Estimamos que seu imóvel tenha cerca de {brl(area.at[i, 'valor'])} m². Está correto?"})
        if any(bens[c].at[i, "origem"] == "ESTIMADO" for c in CATEGORIAS_BENS):
            v = {c: float(bens[c].at[i, "valor"]) for c in CATEGORIAS_BENS}
            s.append({"campo": "valor_bens_por_categoria", "prioridade": "P2", "valor_sugerido": v,
                      "min": {c: float(bens[c].at[i, "min"]) for c in CATEGORIAS_BENS},
                      "max": {c: float(bens[c].at[i, "max"]) for c in CATEGORIAS_BENS},
                      "origem": "ESTIMADO", "confianca": "MEDIA",
                      "pergunta": ("Estimamos seus bens neste imóvel em: móveis ~R$ {movel}, eletrodomésticos ~R$ {eletrodomestico}, "
                                   "eletrônicos ~R$ {eletronico}, lazer ~R$ {item_lazer}. Ajuste o que não estiver certo."
                                   ).format(**{k: brl(x) for k, x in v.items()})})
        if pad.at[i, "origem"] in ("DERIVADO", "DESCONHECIDO"):
            s.append({"campo": "padrao_construtivo", "prioridade": "P2", "valor_sugerido": pad.at[i, "valor"],
                      "opcoes": ["ECONOMICO", "NORMAL", "SUPERIOR"], "origem": "DERIVADO", "confianca": "BAIXA",
                      "pergunta": "Como é o acabamento do imóvel? (simples, normal ou alto padrão)"})
        if vinc.at[i, "origem"] == "DERIVADO":
            s.append({"campo": "tipo_vinculo", "prioridade": "P2", "valor_sugerido": vinc.at[i, "valor"], "origem": "DERIVADO",
                      "confianca": "MEDIA", "opcoes": ["PROPRIO_QUITADO", "PROPRIO_FINANCIADO", "INQUILINO",
                                                       "PROPRIO_ALUGADO_TERCEIROS", "OUTRO"],
                      "pergunta": "Qual é a sua relação com este imóvel?"})
        if uso.at[i, "origem"] == "DERIVADO" and uso.at[i, "valor"] != "RESIDENCIAL_HABITUAL":
            s.append({"campo": "uso_imovel", "prioridade": "P2", "valor_sugerido": uso.at[i, "valor"], "origem": "DERIVADO",
                      "confianca": "BAIXA", "opcoes": ["MORO_AQUI", "TEMPORADA_LAZER", "ALUGADO_A_TERCEIROS", "DESOCUPADO"],
                      "pergunta": "Como este imóvel é usado hoje?"})
        if alug.at[i, "origem"] == "ESTIMADO" and df.at[i, "ctl_aluguel_equivalente_perguntar"] == "SIM":
            s.append({"campo": "aluguel_equivalente_mensal", "prioridade": "P3", "valor_sugerido": float(alug.at[i, "valor"]),
                      "min": float(alug.at[i, "min"]), "max": float(alug.at[i, "max"]), "origem": "ESTIMADO", "confianca": "BAIXA",
                      "pergunta": f"Um imóvel parecido custaria cerca de R$ {brl(alug.at[i, 'valor'])}/mês de aluguel?"})
        if dep.at[i, "origem"] == "OBSERVADO" or pet.at[i, "origem"] == "OBSERVADO":
            s.append({"campo": "dependentes_e_pet", "prioridade": "P3", "origem": "OBSERVADO", "confianca": "MEDIA",
                      "valor_sugerido": {"dependentes": int(dep.at[i, "valor"]), "pet": pet.at[i, "valor"]},
                      "pergunta": "Confirma quantas pessoas moram com você e se há pet?"})
        out.append(json.dumps(s, ensure_ascii=False))
    return out
