"""
Estimador — ponto de entrada único das estimativas do Seguro Residencial.

    from motor_estimativas import Estimador
    est = Estimador()                                     # carrega modelo treinado + premissas

    # lote: planilha única inteira
    perfis, coberturas = est.estimar_planilha(df)

    # um caso (MVP / Bússola): perfil = uma linha da planilha única (dict)
    r = est.estimar_caso(perfil)
    r = est.estimar_caso(perfil, {"conf_area_m2": 150})  # resposta do cliente → recalcula tudo

    # retreinar com dados novos (novas cidades, mais imóveis com área cadastrada)
    Estimador.treinar(["dev_consolidado.csv", "teste_consolidado.csv"])

O que é estimado
    área (modelo de ML) · bens por categoria · padrão de acabamento sugerido · tipo, uso e vínculo
    sugeridos · aluguel equivalente · faixas (sugestão, mín, máx) das 12 coberturas
Cada valor sai com origem (CONFIRMADO / OBSERVADO / ESTIMADO / DERIVADO) e confiança.
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from . import coberturas, contrato, estimativas, modelo_area

ART = contrato.RAIZ / "artefatos"
CAMPOS = ["area_m2", "padrao_construtivo", "tipo_imovel", "uso_imovel", "tipo_vinculo",
          *[f"valor_bens_{c}" for c in contrato.CATEGORIAS_BENS], "aluguel_equivalente_mensal",
          "quantidade_dependentes", "possui_pet"]


def _limpo(x):
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.floating,)):
        return None if np.isnan(x) else float(x)
    if isinstance(x, float) and np.isnan(x):
        return None
    return x


class Estimador:
    def __init__(self, pasta_artefatos: Path | None = None, premissas: Path | None = None):
        art = Path(pasta_artefatos or ART)
        self.prem = contrato.carregar_premissas(premissas)
        self.art_area = joblib.load(art / "modelo_area.joblib")
        self.params = json.loads((art / "parametros_estimativas.json").read_text(encoding="utf-8"))
        self.versao = f"premissas {self.prem['versao']} · modelo_area {self.art_area['versao']}"

    # ------------------------------------------------------------------------------------------
    @staticmethod
    def treinar(caminhos: list[str | Path], seed: int = 42, pasta_artefatos: Path | None = None) -> dict:
        """Treina o modelo de área e os parâmetros das estimativas a partir de planilhas únicas."""
        art_dir = Path(pasta_artefatos or ART)
        planilhas = {Path(c).stem: contrato.carregar_planilha(c) for c in caminhos}
        art = modelo_area.treinar(planilhas, seed)
        params = estimativas.treinar_parametros(planilhas)
        art_dir.mkdir(parents=True, exist_ok=True)
        joblib.dump(art, art_dir / "modelo_area.joblib")
        (art_dir / "parametros_estimativas.json").write_text(json.dumps(params, ensure_ascii=False, indent=2), encoding="utf-8")
        metr = {k: v for k, v in art.items() if k not in ("modelo", "oof_por_id")} | {"fontes": list(planilhas)}
        (art_dir / "metricas_modelo_area.json").write_text(json.dumps(metr, ensure_ascii=False, indent=2), encoding="utf-8")
        return metr

    # ------------------------------------------------------------------------------------------
    def estimar_planilha(self, df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
        """Planilha única → (planilha enriquecida com est_/der_/conf_/ctl_, coberturas por perfil)."""
        enr = estimativas.enriquecer(df, self.art_area, self.params, self.prem)
        enr["ctl_versao_estimativas"] = self.versao
        return enr, coberturas.calcular(enr, self.prem)

    def estimar_caso(self, perfil, confirmacoes: dict | None = None) -> dict:
        """Um perfil (dict ou linha) + respostas do cliente (colunas conf_) → estimativas em JSON."""
        df = contrato.perfil_para_df(perfil)
        for col, val in (confirmacoes or {}).items():
            if not col.startswith("conf_"):
                raise ValueError(f"confirmações só alteram colunas conf_: {col}")
            df[col] = val
            df[f"ctl_status_conf_{col.removeprefix('conf_')}"] = "CONFIRMADO"
        enr, cob = self.estimar_planilha(df)
        valores = {}
        for campo in CAMPOS:
            v = contrato.valor_efetivo(enr, campo).iloc[0]
            valores[campo] = {k: _limpo(v[k]) for k in ("valor", "min", "max", "origem", "confianca")}
        linha = enr.iloc[0]
        extras = ["est_area_por_iptu_m2", "est_area_por_energia_m2", "est_area_por_condominio_m2",
                  "ctl_estimativa_area_fora_dominio", "der_area_divergente_dos_sinais",
                  "est_valor_bens_sugerido", "est_valor_bens_min", "est_valor_bens_max"]
        return {
            "ID": linha["ID"], "versao": self.versao,
            "estimativas": valores,
            "detalhes": {c: _limpo(linha.get(c)) for c in extras},
            "sugestoes_confirmacao": json.loads(linha["ctl_sugestoes_confirmacao_json"]),
            "coberturas": [{k: _limpo(v) for k, v in r.items()} for r in cob.to_dict(orient="records")],
        }
