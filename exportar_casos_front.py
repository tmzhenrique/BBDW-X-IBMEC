"""
Exporta casos reais da base consolidada para o protótipo React (frontend/src/casos.json).

Cada caso sai no formato de uma linha de carregar() do motor, já com as estimativas do
pacote estimativas/ (área por ML, bens e padrão sugerido): o front não roda o modelo.
Também marca um imóvel "destaque" para cada caminho do fluxo, com os mesmos critérios
de exemplos() do motor.

  python exportar_casos_front.py --base <csv_teste_consolidado>
"""
from __future__ import annotations

import argparse
import json

from pathlib import Path

import pandas as pd

from motor_perguntas import CATEGORIAS_BENS, candidatas, carregar, estado_inicial, precisa_residencia

PACOTE_COBERTURAS = Path(__file__).resolve().parent / "coberturas"

CAMPOS = [
    "cliente_id", "imovel_id", "possui_termo_apartamento", "possui_termo_condominio",
    "possui_seguro_residencial", "principal", "outros_principais",
    "pagamento_aluguel_recorrente", "valor_aluguel_recorrente",
    "credito_recorrente_compativel_aluguel", "valor_medio_credito_recorrente",
    "parcela_financiamento_imobiliario", "material_parede_externa_cadastrado",
    "gastos_material_construcao_24m", "gastos_vidracaria_24m",
    "area_cadastrada_m2", "origem_area", "padrao_construtivo_cadastrado",
    "area_est_m2", "area_est_min_m2", "area_est_max_m2", "area_est_confianca", "area_fora_dominio",
    "bens_est", "bens_est_min", "bens_est_max", "uf",
    *[f"bens_{c}_{k}" for c in CATEGORIAS_BENS for k in ("sugerido", "min", "max")],
    "quantidade_dependentes", "possui_pet_informado", "endereco_txt", "outro_endereco",
]

# (rótulo, critério sobre o estado inicial) - mesmos casos contrastantes de exemplos()
CAMINHOS = [
    ("One Click Buy: uma tela só, estimativas na declaração", lambda e: e["one_click"]),
    ("Dois endereços principais", precisa_residencia),
    ("Casa sem material cadastrado", lambda e: e["f"]["material"]["valor"] is None),
    ("Compras de obra: pergunta se está em obra", lambda e: e["f"]["obra"]["valor"] is None),
    ("Dados sugerem imóvel alugado para terceiros", lambda e: e["f"]["uso"]["valor"] == "ALUGADO_TERCEIROS"),
    ("Bens estimados que decidem o plano", lambda e: any(p.id == "bens" and n == 2 for n, _, p in candidatas(e))),
    ("Cliente já tem seguro BB: pergunta se é deste endereço", lambda e: e["f"]["seguro_bb"]["valor"] is None),
]


def limpo(v):
    if hasattr(v, "item"):  # numpy -> tipo nativo
        v = v.item()
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return "" if v != v else v  # NaN -> ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--saida", default="frontend/src/casos.json")
    ap.add_argument("--saida-coberturas", default="frontend/src/coberturas_config.json")
    ap.add_argument("--saida-score", default="frontend/src/score_config.json")
    a = ap.parse_args()
    exportar_config_coberturas(a.saida_coberturas)
    # premissas do score de aderência dos planos (fonte única: score/premissas_score.json)
    Path(a.saida_score).write_text((Path(__file__).resolve().parent / "score" / "premissas_score.json")
                                   .read_text(encoding="utf-8"), encoding="utf-8")
    print(f"premissas do score -> {a.saida_score}")

    casos, usados = [], set()
    for caso in carregar(a.base).to_dict("records"):
        e = estado_inicial(caso)
        destaque = next((r for r, f in CAMINHOS if r not in usados and f(e)), "")
        usados.add(destaque)
        casos.append({**{k: limpo(caso[k]) for k in CAMPOS}, "destaque": destaque})

    with open(a.saida, "w", encoding="utf-8") as fh:
        json.dump(casos, fh, ensure_ascii=False, indent=1)
    print(f"{len(casos)} casos -> {a.saida}")
    for c in casos:
        if c["destaque"]:
            print(f"  {c['imovel_id']}: {c['destaque']}")
    faltam = [r for r, _ in CAMINHOS if r not in usados]
    if faltam:
        print("Sem caso na base para:", faltam)


def exportar_config_coberturas(saida: str) -> None:
    """Premissas e CUB/m² do pacote de coberturas, para o front calcular as mesmas faixas (fonte única: coberturas/)."""
    prem = json.loads((PACOTE_COBERTURAS / "config" / "premissas.json").read_text(encoding="utf-8"))
    cub = pd.read_csv(PACOTE_COBERTURAS / prem["dados_externos"]["cub_m2_uf"])
    cfg = {"coberturas": prem["coberturas"], "seletor": prem["seletor"], "catalogo": prem["catalogo"],
           "cub": dict(zip(cub.uf, cub.cub_r8n_m2)), "cub_nacional": prem["dados_externos"]["cub_padrao_nacional_m2"]}
    with open(saida, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, ensure_ascii=False, indent=1)
    print(f"premissas das coberturas -> {saida}")


if __name__ == "__main__":
    main()
