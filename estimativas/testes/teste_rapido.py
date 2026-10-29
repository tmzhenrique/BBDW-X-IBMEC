"""Testes rápidos de sanidade e robustez. Rodar da raiz do pacote:  python testes/teste_rapido.py"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from motor_estimativas import Estimador  # noqa: E402

base = json.loads((Path(__file__).resolve().parent.parent / "exemplos" / "perfil_exemplo.json").read_text(encoding="utf-8"))
est = Estimador()
ok = True


def checa(nome, cond):
    global ok
    ok &= bool(cond)
    print(("OK   " if cond else "FALHA"), nome)


r = est.estimar_caso(base)
cob = r["coberturas"]
checa("12 coberturas calculadas", len(cob) == 12)
checa("mín ≤ sugestão ≤ máx em todas", all(c["faixa_valor_min"] <= c["valor_sugerido"] <= c["faixa_valor_max"] for c in cob))
checa("nenhuma faixa zerada", all(c["faixa_valor_max"] > 0 for c in cob))
checa("área estimada com faixa", r["estimativas"]["area_m2"]["min"] <= r["estimativas"]["area_m2"]["valor"] <= r["estimativas"]["area_m2"]["max"])
checa("reprodutível", json.dumps(est.estimar_caso(base), sort_keys=True, default=str) == json.dumps(r, sort_keys=True, default=str))

c = est.estimar_caso(base, {"conf_area_m2": 150})
checa("confirmação vira origem CONFIRMADO", c["estimativas"]["area_m2"]["origem"] == "CONFIRMADO")
checa("pergunta de área some após confirmar", all(s["campo"] != "area_m2" for s in c["sugestoes_confirmacao"]))

nova = dict(base, ID="NOVO__CASO", obs_municipio_real="Manaus", obs_uf_real="AM", obs_codigo_ibge_municipio=1302603)
n = est.estimar_caso(nova)
checa("cidade e UF nunca vistas: estima sem erro", n["estimativas"]["area_m2"]["valor"] is not None)
checa("cidade nunca vista: marcada fora do domínio", "municipio_nao_visto" in (n["detalhes"]["ctl_estimativa_area_fora_dominio"] or ""))
checa("cidade nunca vista: confiança da área BAIXA", n["estimativas"]["area_m2"]["confianca"] == "BAIXA")
inc = next(x for x in n["coberturas"] if x["cobertura"] == "INCENDIO_RAIO_EXPLOSAO_FUMACA")
checa("UF sem CUB: usa CUB nacional e baixa a confiança", "média nacional" in inc["regra_calculo_utilizada"] and inc["confianca_estimativa"] != "ALTA")

ext = dict(base, ID="EXTREMO", obs_pagamento_iptu_anual=60000, obs_energia_media_mensal_6m=9000)
e = est.estimar_caso(ext)
checa("valores extremos: área limitada ao intervalo de treino", e["estimativas"]["area_m2"]["valor"] <= 330)

print("\nTODOS OS TESTES PASSARAM" if ok else "\nHÁ FALHAS")
sys.exit(0 if ok else 1)
