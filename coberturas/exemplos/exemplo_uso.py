"""Exemplos de uso. Rodar da raiz do pacote:  python exemplos/exemplo_uso.py"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from motor_coberturas import CalculadoraCoberturas  # noqa: E402

calc = CalculadoraCoberturas()


def mostra(titulo, cobs):
    print(f"\n{titulo}")
    for c in cobs:
        print(f"  {c['cobertura']:32s} sugestão R$ {c['valor_sugerido']:>9,}  seletor {c['faixa_valor_min']:>9,} – "
              f"{c['faixa_valor_max']:>9,}  ({c['confianca_estimativa']})")


# A) perfil da planilha única já enriquecido pelas estimativas
perfil = json.loads((Path(__file__).parent / "perfil_exemplo.json").read_text(encoding="utf-8"))
mostra("A) Perfil da planilha (área e bens estimados)", calc.calcular_caso(perfil))

# B) mesmo perfil depois que o cliente confirmou a área e o padrão
mostra("B) Após confirmar área = 180 m² e padrão NORMAL",
       calc.calcular_caso(perfil, {"conf_area_m2": 180, "conf_padrao_construtivo": "NORMAL"}))

# C) direto pelos valores (sem planilha) + filtro do plano Prático com RC familiar como adicional
cobs = calc.calcular_insumos(uf="PR", tipo="CASA", area=180, padrao="NORMAL", vinculo="PROPRIO_QUITADO",
                             bens={"movel": 15000, "eletrodomestico": 10000, "eletronico": 6000, "item_lazer": 1000},
                             dependentes=2, pet=True)
mostra("C) Prático + RC familiar, calculado pelos valores", calc.filtrar_plano(cobs, "PRATICO", ["RESPONSABILIDADE_CIVIL_FAMILIAR"]))
print("\nRegra do incêndio:", cobs[0]["regra_calculo_utilizada"])
