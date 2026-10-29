"""Testes de sanidade. Rodar da raiz do pacote:  python testes/teste_rapido.py"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from motor_coberturas import CalculadoraCoberturas  # noqa: E402

calc = CalculadoraCoberturas()
perfil = json.loads((Path(__file__).resolve().parent.parent / "exemplos" / "perfil_exemplo.json").read_text(encoding="utf-8"))
ok = True


def checa(nome, cond):
    global ok
    ok &= bool(cond)
    print(("OK   " if cond else "FALHA"), nome)


def get(cobs, c):
    return next(x for x in cobs if x["cobertura"] == c)


a = calc.calcular_caso(perfil)
checa("12 coberturas", len(a) == 12)
checa("mín ≤ sugestão ≤ máx", all(c["faixa_valor_min"] <= c["valor_sugerido"] <= c["faixa_valor_max"] for c in a))
checa("nenhuma faixa zerada", all(c["faixa_valor_max"] > 0 for c in a))
checa("valores inteiros em reais", all(isinstance(c["faixa_valor_min"], int) and isinstance(c["faixa_valor_max"], int) for c in a))
checa("reprodutível", json.dumps(calc.calcular_caso(perfil), sort_keys=True) == json.dumps(a, sort_keys=True))

b = calc.calcular_caso(perfil, {"conf_area_m2": 180, "conf_padrao_construtivo": "NORMAL"})
ia, ib = get(a, "INCENDIO_RAIO_EXPLOSAO_FUMACA"), get(b, "INCENDIO_RAIO_EXPLOSAO_FUMACA")
checa("confirmar área e padrão estreita a faixa de incêndio",
      ib["faixa_valor_max"] / ib["faixa_valor_min"] < ia["faixa_valor_max"] / ia["faixa_valor_min"])
checa("confirmar área e padrão sobe a confiança de incêndio", ib["confianca_estimativa"] == "ALTA")

x = calc.calcular_insumos(uf="PR", tipo="CASA", area=180, padrao="NORMAL", vinculo="PROPRIO_QUITADO",
                          bens={"movel": 15000, "eletrodomestico": 10000, "eletronico": 6000, "item_lazer": 1000})
checa("bens confirmados: danos elétricos = eletro + eletrônicos (16 mil)", get(x, "DANOS_ELETRICOS")["valor_sugerido"] == 16000)
checa("roubo = eletrônicos + lazer + 50% eletrodomésticos (12 mil)", get(x, "ROUBO_FURTO_ARROMBAMENTO")["valor_sugerido"] == 12000)

apto = calc.calcular_insumos(uf="SP", tipo="APARTAMENTO", area=180, padrao="NORMAL", vinculo="PROPRIO_QUITADO", bens={})
checa("apartamento: incêndio bem menor que casa (só benfeitorias)",
      get(apto, "INCENDIO_RAIO_EXPLOSAO_FUMACA")["valor_sugerido"] < 0.4 * get(x, "INCENDIO_RAIO_EXPLOSAO_FUMACA")["valor_sugerido"])

inq = calc.calcular_insumos(uf="SP", tipo="APARTAMENTO", area=70, vinculo="INQUILINO", aluguel_pago=3000, bens={})
checa("inquilino: aluguel 3.000 × 6–12 meses", get(inq, "PERDA_PAGAMENTO_ALUGUEL")["estimativa_min"] == 18000
      and get(inq, "PERDA_PAGAMENTO_ALUGUEL")["estimativa_max"] == 36000)

loc = calc.calcular_insumos(uf="SP", tipo="CASA", area=120, vinculo="PROPRIO_ALUGADO_TERCEIROS", aluguel_recebido=2500,
                            bens={"movel": 20000})
checa("aluga para terceiros: conteúdo fora do incêndio", "conteúdo não incluído" in get(loc, "INCENDIO_RAIO_EXPLOSAO_FUMACA")["regra_calculo_utilizada"])

am = calc.calcular_insumos(uf="AM", tipo="CASA", area=100, bens={})
checa("UF sem CUB: usa média nacional e não dá confiança ALTA",
      "média nacional" in get(am, "INCENDIO_RAIO_EXPLOSAO_FUMACA")["regra_calculo_utilizada"]
      and get(am, "INCENDIO_RAIO_EXPLOSAO_FUMACA")["confianca_estimativa"] != "ALTA")

p = calc.filtrar_plano(x, "ESSENCIAL")
checa("Essencial: 7 coberturas fixas", len(p) == 7)
checa("Total: 12 coberturas", len(calc.filtrar_plano(x, "TOTAL")) == 12)
checa("adicional marcado como ADICIONAL", calc.filtrar_plano(x, "ESSENCIAL", ["QUEBRA_DE_VIDROS"])[-1]["tipo_inclusao"] == "ADICIONAL")

print("\nTODOS OS TESTES PASSARAM" if ok else "\nHÁ FALHAS")
sys.exit(0 if ok else 1)
