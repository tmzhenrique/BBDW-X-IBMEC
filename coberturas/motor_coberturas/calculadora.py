"""
Calculadora de faixas de cobertura — ponto de entrada do pacote.

Três formas de usar (todas chegam ao MESMO cálculo de coberturas.calcular_imovel):

    from motor_coberturas import CalculadoraCoberturas
    calc = CalculadoraCoberturas()

    # 1) planilha única já enriquecida pelas estimativas (est_area_*, est_valor_bens_*, der_*)
    cob = calc.calcular_planilha(df)

    # 2) um perfil (linha da planilha) + respostas do cliente em colunas conf_
    cob = calc.calcular_caso(perfil, {"conf_area_m2": 180})

    # 3) direto pelos valores (sem planilha): útil para o MVP recalcular quando o cliente edita
    cob = calc.calcular_insumos(uf="PR", tipo="CASA", area=180, padrao="NORMAL", vinculo="PROPRIO_QUITADO",
                                bens={"movel": 15000, "eletrodomestico": 10000, "eletronico": 6000, "item_lazer": 1000})

    # filtrar o que entra no plano recomendado (fixas do plano + adicionais escolhidos)
    calc.filtrar_plano(cob, "PRATICO", adicionais=["RESPONSABILIDADE_CIVIL_FAMILIAR"])
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import contrato, coberturas

PLANOS = ["ESSENCIAL", "PRATICO", "TOTAL"]


class CalculadoraCoberturas:
    def __init__(self, premissas=None):
        self.prem = contrato.carregar_premissas(premissas)
        self.cub = pd.read_csv(contrato.RAIZ / self.prem["dados_externos"]["cub_m2_uf"]).set_index("uf")

    # ------------------------------------------------------------------------------------------
    def calcular_planilha(self, df: pd.DataFrame) -> pd.DataFrame:
        """Uma linha por perfil × cobertura (12 coberturas), no formato do template_coberturas_times + extras."""
        return coberturas.calcular(df, self.prem)

    def calcular_caso(self, perfil, confirmacoes: dict | None = None) -> list[dict]:
        df = contrato.perfil_para_df(perfil)
        for col, val in (confirmacoes or {}).items():
            if not col.startswith("conf_"):
                raise ValueError(f"confirmações só alteram colunas conf_: {col}")
            df[col] = val
        return _registros(self.calcular_planilha(df))

    def calcular_insumos(self, *, uf: str, tipo: str, area: float, area_min: float | None = None,
                         area_max: float | None = None, area_origem: str = "CONFIRMADO", area_confianca: str = "ALTA",
                         padrao: str = "NAO_DISPONIVEL", vinculo: str = "PROPRIO_QUITADO",
                         bens: dict | None = None, bens_min: dict | None = None, bens_max: dict | None = None,
                         bens_origem: str = "CONFIRMADO", aluguel_pago: float = 0.0, aluguel_recebido: float = 0.0,
                         aluguel_equivalente: float | None = None, aluguel_equivalente_origem: str = "ESTIMADO",
                         dependentes: int = 0, pet: bool = False, gasto_vidracaria_24m: float = 0.0,
                         ID: str = "CASO_MANUAL", cliente_id: str = "", imovel_id: str = "") -> list[dict]:
        """
        Calcula as 12 coberturas direto pelos valores. Valores informados sem faixa são tratados como exatos
        (min = max = valor). Para estimativas, informe area_min/area_max e bens_min/bens_max e a origem ESTIMADO.
        tipo: CASA | APARTAMENTO · vinculo: PROPRIO_QUITADO | PROPRIO_FINANCIADO | INQUILINO | PROPRIO_ALUGADO_TERCEIROS
        padrao: ECONOMICO | NORMAL | SUPERIOR | NAO_DISPONIVEL
        """
        bens = {c: float((bens or {}).get(c, 0)) for c in contrato.CATEGORIAS_BENS}
        bmin = {c: float((bens_min or bens).get(c, bens[c])) for c in contrato.CATEGORIAS_BENS}
        bmax = {c: float((bens_max or bens).get(c, bens[c])) for c in contrato.CATEGORIAS_BENS}
        uf = uf.upper()
        if uf in self.cub.index:
            cub, ref, cub_origem = float(self.cub.at[uf, "cub_r8n_m2"]), self.cub.at[uf, "referencia"], "TABELA_UF"
        else:
            cub, ref, cub_origem = self.prem["dados_externos"]["cub_padrao_nacional_m2"], "média nacional", "PADRAO_NACIONAL"
        if aluguel_equivalente is None:
            aluguel_equivalente = area * self.prem["coberturas"]["aluguel_m2_referencia"]
            aluguel_equivalente_origem = "ESTIMADO"
        r = pd.Series({
            "ID": ID, "cliente_id": cliente_id, "imovel_id": imovel_id, "obs_uf_real": uf,
            "obs_valor_aluguel_recorrente": aluguel_pago, "obs_valor_medio_credito_recorrente": aluguel_recebido,
            "obs_gastos_vidracaria_24m": gasto_vidracaria_24m,
            "area": float(area), "area_min": float(area_min if area_min is not None else area),
            "area_max": float(area_max if area_max is not None else area),
            "area_origem": area_origem, "area_conf": area_confianca,
            "padrao": padrao.upper(), "padrao_origem": "CONFIRMADO" if padrao.upper() != "NAO_DISPONIVEL" else "DESCONHECIDO",
            "tipo": "APARTAMENTO" if tipo.upper() == "APARTAMENTO" else "CASA", "vinculo": vinculo.upper(),
            **{f"bens_{c}_min": bmin[c] for c in bmin}, **{f"bens_{c}_max": bmax[c] for c in bmax},
            **{f"bens_{c}_origem": bens_origem for c in bens},
            "alug_eq": float(aluguel_equivalente), "alug_eq_origem": aluguel_equivalente_origem,
            "dependentes": int(dependentes), "pet": bool(pet),
            "cub_r8n_m2": cub, "referencia": ref, "cub_origem": cub_origem,
        })
        return _registros(pd.DataFrame(coberturas.calcular_imovel(r, self.prem))[coberturas.COLUNAS_SAIDA])

    # ------------------------------------------------------------------------------------------
    def filtrar_plano(self, cob, plano: str, adicionais: list[str] | None = None) -> list[dict]:
        """Coberturas fixas do plano (pelo catálogo) + adicionais escolhidos de planos superiores."""
        plano = plano.upper()
        regs = cob if isinstance(cob, list) else _registros(cob)
        fixas = {c for c, p in self.prem["catalogo"].items() if PLANOS.index(p) <= PLANOS.index(plano)}
        extra = set(adicionais or [])
        return [dict(r, tipo_inclusao="FIXA_DO_PLANO" if r["cobertura"] in fixas else "ADICIONAL")
                for r in regs if r["cobertura"] in fixas | extra]


def _limpo(x):
    if isinstance(x, np.integer):
        return int(x)
    if isinstance(x, np.floating):
        return None if np.isnan(x) else float(x)
    if isinstance(x, float) and np.isnan(x):
        return None
    return x


def _registros(df: pd.DataFrame) -> list[dict]:
    return [{k: _limpo(v) for k, v in r.items()} for r in df.to_dict(orient="records")]
