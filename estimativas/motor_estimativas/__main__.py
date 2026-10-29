"""
Linha de comando:
    python -m motor_estimativas treinar --planilhas <dev.csv> [<teste.csv> ...]
    python -m motor_estimativas lote --planilha <consolidado.csv> --saida <pasta>
"""
import argparse
import time
from pathlib import Path

from . import contrato
from .estimador import Estimador


def main():
    ap = argparse.ArgumentParser(prog="python -m motor_estimativas")
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("treinar"); t.add_argument("--planilhas", nargs="+", required=True); t.add_argument("--seed", type=int, default=42)
    l = sub.add_parser("lote"); l.add_argument("--planilha", type=Path, required=True); l.add_argument("--saida", type=Path, default=Path("saidas"))
    a = ap.parse_args(); t0 = time.time()
    if a.cmd == "treinar":
        m = Estimador.treinar(a.planilhas, a.seed)
        cv, ho = m["avaliacao"]["validacao_cruzada"], m["avaliacao"].get("teste_a_parte")
        print(f"modelo de área: {m['n_treino']} imóveis · CV erro mediano {cv['erro_mediano_pct']}% · R² {cv['R2']}"
              + (f" · teste à parte {ho['erro_mediano_pct']}% · cobertura da faixa {ho['cobertura_faixa_P10_P90_pct']}%" if ho else ""))
    else:
        enr, cob = Estimador().estimar_planilha(contrato.carregar_planilha(a.planilha))
        a.saida.mkdir(parents=True, exist_ok=True)
        enr.to_csv(a.saida / f"{a.planilha.stem}_com_estimativas.csv", index=False, encoding="utf-8-sig")
        cob.to_csv(a.saida / f"{a.planilha.stem}_coberturas.csv", index=False, encoding="utf-8-sig")
        print(f"{len(enr)} perfis · {len(cob)} linhas de cobertura · arquivos em {a.saida}")
    print(f"({time.time() - t0:.1f} s)")


main()
