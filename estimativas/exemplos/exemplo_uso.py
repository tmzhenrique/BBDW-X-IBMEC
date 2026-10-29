"""Exemplo: estimar um caso, simular a confirmação do cliente e ver o recálculo.
Rodar da pasta raiz do pacote:  python exemplos/exemplo_uso.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from motor_estimativas import Estimador  # noqa: E402

perfil = json.loads((Path(__file__).parent / "perfil_exemplo.json").read_text(encoding="utf-8"))
est = Estimador()

r = est.estimar_caso(perfil)
print("ANTES da confirmação")
for campo in ("area_m2", "padrao_construtivo", "tipo_vinculo", "valor_bens_eletronico"):
    print(f"  {campo:24s}", r["estimativas"][campo])
inc = next(c for c in r["coberturas"] if c["cobertura"] == "INCENDIO_RAIO_EXPLOSAO_FUMACA")
print(f"  incêndio: sugestão R$ {inc['valor_sugerido']:,} · seletor {inc['faixa_valor_min']:,}–{inc['faixa_valor_max']:,} · {inc['confianca_estimativa']}")
print("  perguntas pré-preenchidas:")
for s in r["sugestoes_confirmacao"]:
    print(f"   [{s['prioridade']}] {s['pergunta']}")

# o cliente confirma a área (com um ajuste) e o padrão
r2 = est.estimar_caso(perfil, {"conf_area_m2": 180, "conf_padrao_construtivo": "NORMAL"})
inc = next(c for c in r2["coberturas"] if c["cobertura"] == "INCENDIO_RAIO_EXPLOSAO_FUMACA")
print("\nDEPOIS de confirmar área = 180 m² e padrão NORMAL")
print("  area_m2", r2["estimativas"]["area_m2"])
print(f"  incêndio: sugestão R$ {inc['valor_sugerido']:,} · seletor {inc['faixa_valor_min']:,}–{inc['faixa_valor_max']:,} · {inc['confianca_estimativa']}")
print("  perguntas restantes:", [s["campo"] for s in r2["sugestoes_confirmacao"]])
