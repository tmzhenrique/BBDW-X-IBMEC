"""python -m motor_coberturas --planilha <consolidado_com_estimativas.csv> --saida <arquivo.csv>"""
import argparse
from pathlib import Path

from . import contrato
from .calculadora import CalculadoraCoberturas

ap = argparse.ArgumentParser(prog="python -m motor_coberturas")
ap.add_argument("--planilha", type=Path, required=True)
ap.add_argument("--saida", type=Path, default=Path("coberturas.csv"))
a = ap.parse_args()
cob = CalculadoraCoberturas().calcular_planilha(contrato.carregar_planilha(a.planilha))
cob.to_csv(a.saida, index=False, encoding="utf-8-sig")
print(f"{cob['ID'].nunique()} perfis × 12 coberturas = {len(cob)} linhas → {a.saida}")
