"""
Modelo de estimativa da área do imóvel (m²) — lê SOMENTE a planilha única.

    treinar(planilhas)  → artefato versionado (modelo + faixa P10–P90 + métricas)
    estimar(df, art)    → colunas est_area_* para cada perfil (lote ou um caso)

Modelo: ensemble (Gradient Boosting + HistGradientBoosting + Ridge) em log(área). As variáveis
mais importantes são estimadores físicos: IPTU ÷ (R$/m² da cidade e padrão), energia ÷ (R$/m² do
tipo) e condomínio ÷ (R$/m² da cidade), aprendidos só com os dados de treino.
Nenhum atributo pessoal (renda, idade, dependentes) entra no modelo.
"""
from __future__ import annotations

import platform
import time

import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import GradientBoostingRegressor, HistGradientBoostingRegressor
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import KFold

VERSAO = "2.0.0"
PADROES = ["ECONOMICO", "NORMAL", "SUPERIOR"]
SINAIS_DOMINIO = ["obs_pagamento_iptu_anual", "obs_energia_media_mensal_6m", "obs_agua_media_mensal_6m",
                  "obs_pagamento_condominio_mensal"]
QUANTIS = (0.10, 0.90)


def _tipo(d: pd.DataFrame) -> pd.Series:
    return pd.Series(np.where(d["obs_possui_termo_apartamento"] == "SIM", "APARTAMENTO", "CASA"), index=d.index)


class ModeloArea:
    def __init__(self, seed: int = 42):
        self.seed = seed

    # --- estimadores físicos (R$/m²) aprendidos no treino ------------------------------------
    def _ajustar_razoes(self, d: pd.DataFrame) -> None:
        area, tipo = d["obs_area_cadastrada_m2"], _tipo(d)
        iptu_m2 = d["obs_pagamento_iptu_anual"] / area
        self.r_iptu = iptu_m2.groupby([d["obs_municipio_real"], d["obs_padrao_construtivo_cadastrado"]]).median().to_dict()
        self.r_iptu_cidade = iptu_m2.groupby(d["obs_municipio_real"]).median().to_dict()
        self.r_iptu_global = float(iptu_m2.median())
        self.r_energia = (d["obs_energia_media_mensal_6m"] / area).groupby(tipo).median().to_dict()
        dc = d[d["obs_pagamento_condominio_mensal"] > 0]
        cm2 = dc["obs_pagamento_condominio_mensal"] / dc["obs_area_cadastrada_m2"]
        self.r_cond = cm2.groupby(dc["obs_municipio_real"]).median().to_dict()
        self.r_cond_global = float(cm2.median())

    def razoes(self, d: pd.DataFrame) -> pd.DataFrame:
        taxa_iptu = np.array([self.r_iptu.get((m, p), self.r_iptu_cidade.get(m, self.r_iptu_global))
                              for m, p in zip(d["obs_municipio_real"], d["obs_padrao_construtivo_cadastrado"])], float)
        taxa_ener = _tipo(d).map(self.r_energia).astype(float).values
        taxa_cond = d["obs_municipio_real"].map(self.r_cond).fillna(self.r_cond_global).astype(float).values
        tem_cond = d["obs_pagamento_condominio_mensal"].values > 0
        return pd.DataFrame({
            "taxa_iptu_m2": taxa_iptu,
            "area_por_iptu": d["obs_pagamento_iptu_anual"].values / taxa_iptu,
            "area_por_energia": d["obs_energia_media_mensal_6m"].values / taxa_ener,
            "area_por_condominio": np.where(tem_cond, d["obs_pagamento_condominio_mensal"].values / taxa_cond, np.nan),
        }, index=d.index)

    def variaveis(self, d: pd.DataFrame) -> pd.DataFrame:
        r = self.razoes(d)
        X = pd.DataFrame(index=d.index)
        X["log_iptu"] = np.log(d["obs_pagamento_iptu_anual"])
        X["log_energia"] = np.log(d["obs_energia_media_mensal_6m"])
        X["log_agua"] = np.log(d["obs_agua_media_mensal_6m"])
        X["log_cond"] = np.log1p(d["obs_pagamento_condominio_mensal"])
        X["tem_cond"] = (d["obs_pagamento_condominio_mensal"] > 0).astype(int)
        X["apto"] = (_tipo(d) == "APARTAMENTO").astype(int)
        X["casa_condominio"] = ((d["obs_possui_termo_casa"] == "SIM") & (d["obs_possui_termo_condominio"] == "SIM")).astype(int)
        X["log_aluguel"] = np.log1p(d["obs_valor_aluguel_recorrente"])
        X["log_parcela"] = np.log1p(d["obs_parcela_financiamento_imobiliario"])
        X["log_moveis"] = np.log1p(d["obs_compras_moveis_36m"])
        for p in PADROES:
            X[f"padrao_{p}"] = (d["obs_padrao_construtivo_cadastrado"] == p).astype(int)
        for c in self.cidades:
            X[f"mun_{c}"] = (d["obs_municipio_real"] == c).astype(int)
        X["lr_iptu"] = np.log(r["area_por_iptu"])
        X["lr_energia"] = np.log(r["area_por_energia"])
        X["lr_cond"] = np.log(r["area_por_condominio"].fillna(r["area_por_iptu"]))
        return X

    def _inter(self, X: pd.DataFrame) -> pd.DataFrame:
        X = X.copy()
        for c in self.cidades:
            X[f"iptuX{c}"] = X[f"mun_{c}"] * X["log_iptu"]
        X["condXapto"] = X["log_cond"] * X["apto"]
        X["energiaXapto"] = X["log_energia"] * X["apto"]
        return X

    def fit(self, d: pd.DataFrame) -> "ModeloArea":
        d = d[d["obs_area_cadastrada_m2"] > 0]
        self.cidades = sorted(d["obs_municipio_real"].unique())
        self._ajustar_razoes(d)
        self.dominio = {c: (float(d[c].min()), float(d[c].max())) for c in SINAIS_DOMINIO}
        self.area_min, self.area_max = float(d["obs_area_cadastrada_m2"].min()), float(d["obs_area_cadastrada_m2"].max())
        X, y = self.variaveis(d), np.log(d["obs_area_cadastrada_m2"].values)
        self.colunas = list(X.columns)
        self.gb = GradientBoostingRegressor(n_estimators=400, learning_rate=0.03, max_depth=3, subsample=0.8,
                                            random_state=self.seed).fit(X, y)
        self.hgb = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.04, max_leaf_nodes=15, min_samples_leaf=15,
                                                 l2_regularization=1.0, random_state=self.seed).fit(X, y)
        self.ridge = RidgeCV(alphas=np.logspace(-3, 2, 20)).fit(self._inter(X), y)
        return self

    def predict(self, d: pd.DataFrame) -> np.ndarray:
        X = self.variaveis(d)[self.colunas]
        return np.exp((self.gb.predict(X) + self.hgb.predict(X) + self.ridge.predict(self._inter(X))) / 3)

    def fora_do_dominio(self, d: pd.DataFrame) -> pd.Series:
        m = pd.Series("", index=d.index)
        for c, (lo, hi) in self.dominio.items():
            fora = (d[c] < lo) | (d[c] > hi)
            if c == "obs_pagamento_condominio_mensal":
                fora &= d[c] > 0
            m[fora] += c.removeprefix("obs_") + ";"
        m[~d["obs_municipio_real"].isin(self.cidades)] += "municipio_nao_visto;"
        return m.str.rstrip(";")


# ---------------------------------------------------------------------------------------------
def metricas(y, p) -> dict:
    e = p - y
    return {"n": int(len(y)), "MAE_m2": round(float(np.abs(e).mean()), 2),
            "erro_mediano_pct": round(float(np.median(np.abs(e) / y) * 100), 2),
            "R2": round(float(1 - (e ** 2).sum() / ((y - y.mean()) ** 2).sum()), 3),
            "pct_ate_15pct_erro": round(float(np.mean(np.abs(e) / y <= 0.15) * 100), 1)}


def _oof(d: pd.DataFrame, seed: int) -> np.ndarray:
    d = d.reset_index(drop=True)
    p = np.zeros(len(d))
    for tr, te in KFold(5, shuffle=True, random_state=seed).split(d):
        p[te] = ModeloArea(seed).fit(d.iloc[tr]).predict(d.iloc[te])
    return p


def _fatores(d: pd.DataFrame, oof: np.ndarray) -> dict:
    res, tipo = np.log(d["obs_area_cadastrada_m2"].values / oof), _tipo(d).values
    return {t: tuple(float(np.exp(q)) for q in np.quantile(res[tipo == t], QUANTIS)) for t in ["CASA", "APARTAMENTO"]}


def treinar(planilhas: dict[str, pd.DataFrame], seed: int = 42) -> dict:
    """
    planilhas: {"desenvolvimento": df, "teste": df, ...} no formato da planilha única.
    Avalia com validação cruzada na primeira e com as demais como teste à parte; o modelo final usa todas.
    """
    t0 = time.time()
    nomes = list(planilhas)
    rot = {n: planilhas[n][planilhas[n]["obs_area_cadastrada_m2"] > 0].reset_index(drop=True) for n in nomes}
    base = rot[nomes[0]]
    oof_base = _oof(base, seed)
    aval = {"validacao_cruzada": {"base": nomes[0], **metricas(base["obs_area_cadastrada_m2"].values, oof_base)}}
    fat_base = _fatores(base, oof_base)
    if len(nomes) > 1:
        outros = pd.concat([rot[n] for n in nomes[1:]], ignore_index=True)
        if len(outros):
            p = ModeloArea(seed).fit(base).predict(outros)
            lo = p * _tipo(outros).map(lambda t: fat_base[t][0]).values
            hi = p * _tipo(outros).map(lambda t: fat_base[t][1]).values
            y = outros["obs_area_cadastrada_m2"].values
            aval["teste_a_parte"] = {"bases": nomes[1:], **metricas(y, p),
                                     "cobertura_faixa_P10_P90_pct": round(float(np.mean((y >= lo) & (y <= hi)) * 100), 1)}
    todos = pd.concat(rot.values(), ignore_index=True)
    oof_todos = _oof(todos, seed)
    return {
        "versao": VERSAO, "modelo": ModeloArea(seed).fit(todos), "fatores_faixa": _fatores(todos, oof_todos),
        "oof_por_id": dict(zip(todos["ID"], oof_todos)), "avaliacao": aval, "n_treino": int(len(todos)),
        "ambiente": {"python": platform.python_version(), "scikit_learn": sklearn.__version__},
        "seed": seed, "tempo_treino_s": round(time.time() - t0, 1),
    }


def estimar(df: pd.DataFrame, art: dict) -> pd.DataFrame:
    """Colunas est_area_* para cada perfil. Perfis usados no treino recebem a previsão fora da amostra."""
    m, fat = art["modelo"], art["fatores_faixa"]
    est = pd.Series(m.predict(df), index=df.index)
    oof = df["ID"].map(art["oof_por_id"])
    est = oof.where(oof.notna(), est)
    est_c = est.clip(m.area_min, m.area_max)
    tipo = _tipo(df)
    f_lo, f_hi = tipo.map(lambda t: fat[t][0]), tipo.map(lambda t: fat[t][1])
    fora = m.fora_do_dominio(df)
    r = m.razoes(df)
    obs = df["obs_area_cadastrada_m2"]
    out = pd.DataFrame(index=df.index)
    out["est_area_m2"] = est_c.round(0)
    out["est_area_min_m2"] = (est_c * f_lo).clip(lower=m.area_min * 0.8).round(0)
    out["est_area_max_m2"] = (est_c * f_hi).clip(upper=m.area_max * 1.2).round(0)
    out["est_area_por_iptu_m2"] = r["area_por_iptu"].round(0)
    out["est_area_por_energia_m2"] = r["area_por_energia"].round(0)
    out["est_area_por_condominio_m2"] = r["area_por_condominio"].round(0)
    out["ctl_estimativa_area_confianca"] = np.where((fora != "") | (est != est_c), "BAIXA", "MEDIA")
    out["ctl_estimativa_area_fora_dominio"] = fora.replace("", np.nan)
    out["der_area_divergente_dos_sinais"] = np.where(
        (obs > 0) & ((obs < est * f_lo * 0.9) | (obs > est * f_hi * 1.1)), "SIM", "NAO")
    return out
