"""
Score de aderência dos planos (Essencial, Prático, Total) - Time Vector

Adaptado do motor de score do time (motor_score/motor/score.py, contrato proposta-0.2). Mantém o núcleo:
1. Necessidade (0 a 1) de cada cobertura opcional, a partir de evidências do perfil.
2. Score por utilidade marginal: Essencial = base; cada cobertura opcional do plano soma
   pontos × (necessidade - limiar). Cobertura sem necessidade tira pontos: mais coberturas não é
   automaticamente melhor (evita Total para todos).
3. Empate (diferença <= empate_pontos) -> plano mais simples.

Mudanças em relação ao original (premissas em score/premissas_score.json):
- Sem renda: o bônus "vive do aluguel" usava renda informada ou presumida e foi desativado
  (o guia proíbe atributos pessoais como atalho para escolher o plano).
- Imóvel desocupado não tem necessidade de perda de aluguel (a cobertura não vale nesse caso).
- Planos fixos: em vez de sugerir cobertura adicional avulsa, uma necessidade crítica
  (>= necessidade_critica_piso) obriga o plano mínimo que tem aquela cobertura.
- Necessidade crítica pesa mais (peso_necessidade_critica) no score e na aderência, para que o plano
  que a cobre ganhe e a % conte a mesma história do plano mínimo.
- Aderência em %: parte das necessidades do cliente que o plano atende sem incluir o que ele
  não precisa. Ordena os planos exatamente como o score (difere dele só por uma constante).
- Elegibilidade e escolha de perguntas ficam no motor_perguntas.py (Bússola), não aqui.
"""
from __future__ import annotations

import json
from pathlib import Path

PREM = json.loads((Path(__file__).resolve().parent / "score" / "premissas_score.json").read_text(encoding="utf-8"))
PLANOS = ["ESSENCIAL", "PRATICO", "TOTAL"]
NOME = {"ESSENCIAL": "Essencial", "PRATICO": "Prático", "TOTAL": "Total"}
OPCIONAIS = ["ROUBO_FURTO_ARROMBAMENTO", "QUEBRA_DE_VIDROS", "RESPONSABILIDADE_CIVIL_FAMILIAR",
             "PERDA_PAGAMENTO_ALUGUEL", "DESPESAS_EMERGENCIAIS"]
NOME_COB = {"ROUBO_FURTO_ARROMBAMENTO": "roubo e furto", "QUEBRA_DE_VIDROS": "quebra de vidros",
            "RESPONSABILIDADE_CIVIL_FAMILIAR": "responsabilidade civil familiar",
            "PERDA_PAGAMENTO_ALUGUEL": "perda ou pagamento de aluguel", "DESPESAS_EMERGENCIAIS": "despesas emergenciais"}


def brl(x: float) -> str:
    return f"{x:,.0f}".replace(",", ".")


def necessidades(ctx: dict, prem: dict = PREM) -> tuple[dict, dict]:
    """Necessidade (0 a 1) de cada cobertura opcional e o motivo em texto.
    ctx: vinculo (vocabulário do pacote de coberturas), uso, dependentes, pet, vidracaria,
         bens_portateis (sugestão de roubo) e incendio_sugerido (R$)."""
    pn = prem["necessidade"]
    n, why = {}, {}
    v = ctx["vinculo"]
    locador = v == "PROPRIO_ALUGADO_TERCEIROS"
    vazio = ctx["uso"] in ("DESOCUPADO", "TEMPORADA")

    p = pn["ROUBO_FURTO_ARROMBAMENTO"]
    if locador:
        n["ROUBO_FURTO_ARROMBAMENTO"], why["ROUBO_FURTO_ARROMBAMENTO"] = p["locador"], "imóvel alugado a terceiros (os bens são do inquilino)"
    else:
        val = ctx["bens_portateis"]
        base = next(nv for lim, nv in p["faixas_valor_bens_portateis"] if val < lim)
        txt = f"bens portáteis de cerca de R$ {brl(val)}"
        if vazio:
            base += p["bonus_imovel_vazio"]
            txt += "; o imóvel fica vazio parte do tempo"
        n["ROUBO_FURTO_ARROMBAMENTO"], why["ROUBO_FURTO_ARROMBAMENTO"] = min(base, 1.0), txt

    p = pn["QUEBRA_DE_VIDROS"]
    if ctx["vidracaria"] > 0:
        n["QUEBRA_DE_VIDROS"], why["QUEBRA_DE_VIDROS"] = p["com_gasto_vidracaria"], f"gasto recente com vidraçaria (R$ {brl(ctx['vidracaria'])})"
    else:
        n["QUEBRA_DE_VIDROS"], why["QUEBRA_DE_VIDROS"] = p["sem_evidencia"], "sem indício de vidros de valor relevante"

    p = pn["RESPONSABILIDADE_CIVIL_FAMILIAR"]
    dep = min(ctx["dependentes"], p["max_dependentes"])
    partes = ([f"{ctx['dependentes']} dependente(s)"] if ctx["dependentes"] else []) + (["pet"] if ctx["pet"] else [])
    n["RESPONSABILIDADE_CIVIL_FAMILIAR"] = min(p["base"] + dep * p["por_dependente"] + (p["pet"] if ctx["pet"] else 0), 1.0)
    why["RESPONSABILIDADE_CIVIL_FAMILIAR"] = " e ".join(partes) if partes else "sem dependentes nem pet"

    p = pn["PERDA_PAGAMENTO_ALUGUEL"]
    if ctx["uso"] == "DESOCUPADO":
        n["PERDA_PAGAMENTO_ALUGUEL"], why["PERDA_PAGAMENTO_ALUGUEL"] = p["DESOCUPADO"], "imóvel desocupado: a cobertura não vale nesse caso"
    elif v == "INQUILINO":
        n["PERDA_PAGAMENTO_ALUGUEL"], why["PERDA_PAGAMENTO_ALUGUEL"] = p["INQUILINO"], "paga aluguel: continuaria pagando se o imóvel ficar inabitável"
    elif locador:
        n["PERDA_PAGAMENTO_ALUGUEL"], why["PERDA_PAGAMENTO_ALUGUEL"] = p["PROPRIO_ALUGADO_TERCEIROS"], "recebe aluguel deste imóvel: deixaria de receber se ele ficar inabitável"
    elif v == "PROPRIO_FINANCIADO":
        n["PERDA_PAGAMENTO_ALUGUEL"], why["PERDA_PAGAMENTO_ALUGUEL"] = p["PROPRIO_FINANCIADO"], "financiado: pagaria a parcela e uma moradia provisória ao mesmo tempo"
    else:
        n["PERDA_PAGAMENTO_ALUGUEL"], why["PERDA_PAGAMENTO_ALUGUEL"] = p["MORADOR"], "imóvel próprio: precisaria de moradia provisória"

    p = pn["DESPESAS_EMERGENCIAIS"]
    val, txt = p["base"], []
    if v == "PROPRIO_FINANCIADO":
        val += p["financiado"]
        txt.append("financiamento em curso")
    if ctx["incendio_sugerido"] >= p["limiar_valor_em_risco"]:
        val += p["bonus_valor_em_risco"]
        txt.append(f"valor em risco alto (cerca de R$ {brl(ctx['incendio_sugerido'])})")
    n["DESPESAS_EMERGENCIAIS"], why["DESPESAS_EMERGENCIAIS"] = min(val, 1.0), "; ".join(txt) or "sem fator adicional"
    return n, why


def _efeito(n: dict, c: str, prem: dict) -> float:
    """Quanto incluir a cobertura vale: necessidade - limiar; necessidade crítica pesa mais."""
    d = n[c] - prem["limiar_necessidade"]
    return d * prem["peso_necessidade_critica"] if n[c] >= prem["necessidade_critica_piso"] else d


def scores_planos(n: dict, prem: dict = PREM) -> dict:
    """Utilidade marginal: Essencial = base; cada opcional incluída soma k × efeito (necessidade - limiar)."""
    base, k = prem["base"], prem["pontos_por_necessidade"]
    return {pl: round(base + k * sum(_efeito(n, c, prem) for c in prem["planos"][pl]), 1) for pl in PLANOS}


def aderencia(n: dict, prem: dict = PREM) -> dict:
    """% das necessidades atendidas sem incluir o que não precisa: cada opcional pesa |efeito|;
    conta a favor quando o plano tem a cobertura e ela é necessária, ou não tem e ela não é."""
    ef = {c: _efeito(n, c, prem) for c in OPCIONAIS}
    total = sum(abs(x) for x in ef.values())
    if total == 0:
        return {pl: 100 for pl in PLANOS}
    return {pl: round(100 * sum(max(ef[c], 0) if c in prem["planos"][pl] else max(-ef[c], 0)
                                for c in OPCIONAIS) / total) for pl in PLANOS}


def plano_minimo(n: dict, prem: dict = PREM) -> tuple[str, list[str]]:
    """Plano mínimo exigido por necessidade crítica: só o plano que tem a cobertura atende."""
    criticas = [c for c in OPCIONAIS if n[c] >= prem["necessidade_critica_piso"]]
    minimo = "ESSENCIAL"
    for c in criticas:
        menor = next(pl for pl in PLANOS if c in prem["planos"][pl])
        minimo = max(minimo, menor, key=PLANOS.index)
    return minimo, criticas


def avaliar(ctx: dict, prem: dict = PREM) -> dict:
    """Plano recomendado, score e aderência de cada plano, piso por necessidade crítica e justificativas."""
    n, why = necessidades(ctx, prem)
    sc = scores_planos(n, prem)
    ad = aderencia(n, prem)
    minimo, criticas = plano_minimo(n, prem)
    permitidos = PLANOS[PLANOS.index(minimo):]
    melhor = max(sc[p] for p in permitidos)
    plano = next(p for p in permitidos if sc[p] >= melhor - prem["empate_pontos"])  # empate: o mais simples
    alternativa = max((p for p in PLANOS if p != plano), key=lambda p: sc[p])

    just = [f"O {NOME[plano]} tem {ad[plano]}% de aderência ao seu perfil ("
            + ", ".join(f"{NOME[p]} {ad[p]}%" for p in PLANOS if p != plano) + ")."]
    if minimo != "ESSENCIAL" and plano == minimo and sc[plano] < max(sc.values()) - prem["empate_pontos"]:
        just.append(f"Só a partir do {NOME[minimo]} existe " + ", ".join(NOME_COB[c] for c in criticas
                    if c in prem["planos"][minimo]) + ", e essa proteção é muito importante para você.")
    empate = PLANOS.index(alternativa) > PLANOS.index(plano) and sc[alternativa] >= sc[plano]
    if empate:
        just.append(f"O {NOME[alternativa]} ficou praticamente empatado; nesse caso recomendamos o mais simples.")
    atendidas = [c for c in prem["planos"][plano] if n[c] >= prem["limiar_necessidade"]]
    if atendidas:
        just.append("Atende o que você mais precisa: " + "; ".join(f"{NOME_COB[c]} ({why[c]})" for c in atendidas) + ".")
    if PLANOS.index(alternativa) > PLANOS.index(plano) and not empate:
        extra = [c for c in prem["planos"][alternativa] if c not in prem["planos"][plano]]
        just.append(f"O {NOME[alternativa]} acrescentaria " + ", ".join(NOME_COB[c] for c in extra)
                    + ", que pesam pouco no seu caso.")
    elif PLANOS.index(alternativa) < PLANOS.index(plano):
        perde = [c for c in prem["planos"][plano] if c not in prem["planos"][alternativa]]
        just.append(f"O {NOME[alternativa]} é mais simples, mas ficaria sem " + ", ".join(NOME_COB[c] for c in perde) + ".")
    return {"plano": plano, "alternativa": alternativa, "scores": sc, "aderencia": ad,
            "plano_minimo": minimo, "necessidades_criticas": criticas,
            "necessidades": {c: round(n[c], 2) for c in OPCIONAIS}, "motivos": why, "justificativas": just,
            "versao": prem["versao"]}
