"""
Contrato da planilha única — a ÚNICA fonte de dados de todos os módulos do motor.

Uma linha = um perfil cliente + imóvel. Prefixos:
    obs_  observado/cadastral      der_  derivado por regra      est_  estimado por modelo
    conf_ confirmado pelo cliente  ctl_  controle e metadados    motor_ saídas do motor

Regra de ouro: nenhum cálculo lê uma coluna de valor diretamente. Todos pedem o valor por
valor_efetivo(), que aplica a precedência

    conf_ (cliente confirmou)  >  obs_ (cadastro)  >  est_/der_ (estimativa)

e devolve junto a origem e a confiança. Quando a Bússola preenche uma coluna conf_, todo o
motor passa a usar o valor confirmado automaticamente.

Funciona tanto para a planilha inteira (lote) quanto para um único perfil (DataFrame de 1 linha).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
CATEGORIAS_BENS = ["movel", "eletrodomestico", "eletronico", "item_lazer"]

# colunas mínimas para o motor rodar (as demais são opcionais)
COLUNAS_OBRIGATORIAS = [
    "ID", "cliente_id", "imovel_id", "obs_municipio_real", "obs_uf_real", "obs_possui_termo_apartamento",
    "obs_possui_termo_casa", "obs_possui_termo_condominio", "obs_area_cadastrada_m2", "obs_padrao_construtivo_cadastrado",
    "obs_pagamento_iptu_anual", "obs_energia_media_mensal_6m", "obs_agua_media_mensal_6m",
    "obs_pagamento_condominio_mensal", "obs_pagamento_aluguel_recorrente", "obs_valor_aluguel_recorrente",
    "obs_credito_recorrente_compativel_aluguel", "obs_valor_medio_credito_recorrente",
    "obs_parcela_financiamento_imobiliario", "obs_compras_moveis_36m", "obs_compras_eletrodomesticos_36m",
    "obs_compras_eletronicos_36m", "obs_gastos_vidracaria_24m", "obs_quantidade_dependentes",
    "obs_possui_pet_informado", "obs_endereco_principal_compativel",
] + [f"der_valor_bens_{c}_cadastrado_referencia" for c in CATEGORIAS_BENS] \
  + [f"est_valor_bens_{c}_ponderado_referencia" for c in CATEGORIAS_BENS]


def carregar_premissas(caminho: Path | None = None) -> dict:
    return json.loads((caminho or RAIZ / "config" / "premissas.json").read_text(encoding="utf-8"))


def carregar_planilha(caminho: Path | str) -> pd.DataFrame:
    df = pd.read_csv(caminho, encoding="utf-8-sig", low_memory=False)
    faltando = [c for c in COLUNAS_OBRIGATORIAS if c not in df.columns]
    if faltando:
        raise ValueError(f"Planilha única sem colunas obrigatórias: {faltando}")
    return df


def perfil_para_df(perfil: dict | pd.Series | pd.DataFrame) -> pd.DataFrame:
    """Aceita um perfil (dict/linha) e devolve um DataFrame de 1 linha no formato da planilha."""
    if isinstance(perfil, pd.DataFrame):
        return perfil.copy()
    return pd.DataFrame([dict(perfil)])


def _col(df: pd.DataFrame, nome: str, default=np.nan) -> pd.Series:
    return df[nome] if nome in df.columns else pd.Series(default, index=df.index)


def _tem(s: pd.Series) -> pd.Series:
    return s.notna() & (s.astype(str).str.strip() != "")


def valor_efetivo(df: pd.DataFrame, campo: str) -> pd.DataFrame:
    """
    Devolve, para cada linha, o valor que o motor deve usar no campo pedido:
    colunas valor, min, max, origem, confianca.
    """
    n = df.index
    out = pd.DataFrame(index=n, columns=["valor", "min", "max", "origem", "confianca"], dtype=object)

    def aplica(mask, valor, vmin=None, vmax=None, origem="", conf=""):
        m = mask & out["valor"].isna()
        out.loc[m, "valor"] = pd.Series(valor, index=n)[m]
        out.loc[m, "min"] = pd.Series(valor if vmin is None else vmin, index=n)[m]
        out.loc[m, "max"] = pd.Series(valor if vmax is None else vmax, index=n)[m]
        out.loc[m, "origem"] = origem
        out.loc[m, "confianca"] = pd.Series(conf, index=n)[m] if isinstance(conf, pd.Series) else conf

    if campo == "area_m2":
        conf = _col(df, "conf_area_m2")
        aplica(_tem(conf), pd.to_numeric(conf, errors="coerce"), origem="CONFIRMADO", conf="ALTA")
        obs = df["obs_area_cadastrada_m2"]
        aplica(obs > 0, obs, origem="OBSERVADO", conf="ALTA")
        aplica(_tem(_col(df, "est_area_m2")), _col(df, "est_area_m2"), _col(df, "est_area_min_m2"),
               _col(df, "est_area_max_m2"), "ESTIMADO", _col(df, "ctl_estimativa_area_confianca", "MEDIA").fillna("MEDIA"))

    elif campo == "padrao_construtivo":
        aplica(_tem(_col(df, "conf_padrao_construtivo")), _col(df, "conf_padrao_construtivo"), origem="CONFIRMADO", conf="ALTA")
        obs = df["obs_padrao_construtivo_cadastrado"]
        aplica(obs != "NAO_DISPONIVEL", obs, origem="OBSERVADO", conf="ALTA")
        aplica(_tem(_col(df, "der_padrao_construtivo_sugerido")), _col(df, "der_padrao_construtivo_sugerido"),
               origem="DERIVADO", conf="BAIXA")
        aplica(pd.Series(True, index=n), "NAO_DISPONIVEL", origem="DESCONHECIDO", conf="BAIXA")

    elif campo in ("tipo_imovel", "uso_imovel", "tipo_vinculo"):
        aplica(_tem(_col(df, f"conf_{campo}")), _col(df, f"conf_{campo}"), origem="CONFIRMADO", conf="ALTA")
        aplica(_tem(_col(df, f"der_{campo}_sugerido")), _col(df, f"der_{campo}_sugerido"), origem="DERIVADO",
               conf="ALTA" if campo == "tipo_imovel" else "MEDIA")

    elif campo.startswith("valor_bens_"):
        cat = campo.removeprefix("valor_bens_")
        aplica(_tem(_col(df, f"conf_{campo}")), pd.to_numeric(_col(df, f"conf_{campo}"), errors="coerce"),
               origem="CONFIRMADO", conf="ALTA")
        aplica(_tem(_col(df, f"est_valor_bens_{cat}_sugerido")), _col(df, f"est_valor_bens_{cat}_sugerido"),
               _col(df, f"est_valor_bens_{cat}_min"), _col(df, f"est_valor_bens_{cat}_max"), "ESTIMADO", "MEDIA")

    elif campo == "aluguel_equivalente_mensal":
        aplica(_tem(_col(df, "conf_aluguel_equivalente_mensal")),
               pd.to_numeric(_col(df, "conf_aluguel_equivalente_mensal"), errors="coerce"), origem="CONFIRMADO", conf="ALTA")
        aplica(_tem(_col(df, "est_aluguel_equivalente_mensal")), _col(df, "est_aluguel_equivalente_mensal"),
               _col(df, "est_aluguel_equivalente_mensal_min"), _col(df, "est_aluguel_equivalente_mensal_max"), "ESTIMADO", "BAIXA")

    elif campo in ("quantidade_dependentes", "possui_pet"):
        obs_col = "obs_quantidade_dependentes" if campo == "quantidade_dependentes" else "obs_possui_pet_informado"
        aplica(_tem(_col(df, f"conf_{campo}")), _col(df, f"conf_{campo}"), origem="CONFIRMADO", conf="ALTA")
        aplica(pd.Series(True, index=n), df[obs_col], origem="OBSERVADO", conf="MEDIA")

    else:
        raise KeyError(f"campo sem regra de valor efetivo: {campo}")
    return out
