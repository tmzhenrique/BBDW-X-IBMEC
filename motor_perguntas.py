"""
Motor de perguntas adaptativas (Bússola) - Time Vector
Datathon Proteção Inteligente (Ibmec + BB Seguros) - Seguro Residencial

Segue o documento "Regras de Elegibilidade Definitivas" do time (28/10/2026),
que consolida o Guia dos Times final (seção 9.1) e as regras de condução da Bússola.
Lê a base consolidada (uma linha por cliente + imóvel, schema 0.2.0).

Ideia central
-------------
1. Cada informação vira um CAMPO com valor + origem + confiança. Origens:
   OBSERVADO (cadastro), DERIVADO (regra), ESTIMADO (modelo), DECLARADO (cliente),
   VERIFICADO_EXTERNO (sistema ou documento da BB) e AUSENTE.
2. O estado inicial usa só os dados da base.
3. Cada caso tem três dimensões separadas:
     eleg_situacao  SEM_RESTRICAO_IDENTIFICADA / PENDENTE_VERIFICACAO / RESTRICAO_CONFIRMADA
                    (pior resultado entre as regras E1 a E7)
     origem         de onde veio cada informação
     bussola_acao   CONTINUAR / PERGUNTAR / RESULTADO_PRELIMINAR / ENCAMINHAR_HUMANO / REVISAO_APOLICE
   O motor nunca recusa sozinho: restrição confirmada leva ao atendimento humano
   ou à revisão da apólice. Encaminhamento não é rejeição.
4. A prioridade de cada pergunta vem da consequência, simulando todas as respostas:
     P1 - alguma resposta muda a situação de elegibilidade (material, obra, seguro)
          ou é preciso saber qual imóvel (B1); a declaração final também é P1
     P2 - campo de cotação (uso, vínculo), confirmação da área estimada (sempre,
          um clique) ou resposta que muda o plano recomendado
     P3 - só estreita as faixas (refino opcional)
     nenhum - nada muda -> a pergunta não é feita (B4)
   P0 não é pergunta: é a ação quando uma resposta confirma uma restrição.
5. "Não sei" nunca vira zero nem "não" (B8): mantém a pendência.
6. O plano vem do score de aderência (score_planos.py, adaptado do motor de score do time):
   necessidade de cada cobertura opcional, score por utilidade marginal, aderência em % e plano
   mínimo quando uma necessidade é crítica. Ver plano_recomendado().

Os pontos marcados VALIDAR dependem da BB Seguros e estão nos parâmetros abaixo.

Uso
---
  python motor_perguntas.py --base <csv_consolidado> --lote
  python motor_perguntas.py --base <csv_consolidado> --interativo IMO_CLI_00001_01
  python motor_perguntas.py --base <csv_consolidado> --exemplos

As estimativas (área por machine learning, bens e padrão sugerido) vêm do pacote do time em
estimativas/. O modelo é treinado uma vez com as bases consolidadas:
  cd estimativas && python -m motor_estimativas treinar --planilhas <dev.csv> <teste.csv>

Requer Python 3.10+, pandas, numpy e scikit-learn.
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd

# Estimativas do time (área por ML, bens por categoria, padrão sugerido): estimativas/motor_estimativas
sys.path.insert(0, str(Path(__file__).resolve().parent / "estimativas"))
from motor_estimativas import Estimador  # noqa: E402
from motor_estimativas import estimativas as _est  # noqa: E402

# Faixas de valor das 12 coberturas (pacote do time): coberturas/motor_coberturas
sys.path.insert(0, str(Path(__file__).resolve().parent / "coberturas"))
from motor_coberturas import CalculadoraCoberturas  # noqa: E402
CATEGORIAS_BENS = ("movel", "eletrodomestico", "eletronico", "item_lazer")

import score_planos as _score  # noqa: E402  (score de aderência dos planos)

# --------------------------------------------------------------------------
# Parâmetros calibráveis (documentar no README)
# --------------------------------------------------------------------------
LIMIAR_OBRA_PERGUNTA = 5_000       # R$ em material de construção (24m) que abre a pergunta de obra (TIME, VALIDAR)
GANHO_MINIMO_REFINO = 0.10         # refino só vale se estreitar a faixa em pelo menos 10%
MAX_REFINO = 2                     # máximo de perguntas de refino por imóvel
# Custo de reconstrução por m². VALORES ILUSTRATIVOS: trocar pelo CUB da UF (Sinduscon), com fonte e data.
CUSTO_M2_ILUSTRATIVO = {"ECONOMICO": 2000, "NORMAL": 2800, "SUPERIOR": 3800}

CAMPOS_COTACAO = {"uso", "vinculo"}  # "Informações mínimas para cotação" do guia (tipo já vem do endereço)

# Pontos a VALIDAR com a BB (documento definitivo, seção 5)
VINCULO_CEDIDO_SITUACAO = "PENDENTE_VERIFICACAO"  # "cedido" não está na lista do guia; nem libera nem bloqueia

# E7 - comunidade carente / favela: item da declaração final, igual para todos os clientes.
# Nenhum dado nem métrica é usado para inferir (nem para escolher a quem perguntar).
# Em produção, a BB verifica pelo endereço real contra a malha de Favelas e Comunidades Urbanas do IBGE.


SEM, PEND, REST = "SEM_RESTRICAO_IDENTIFICADA", "PENDENTE_VERIFICACAO", "RESTRICAO_CONFIRMADA"
GRAVIDADE = {SEM: 0, PEND: 1, REST: 2}
NAO_SEI = "NAO_SEI"
CONFIRMO, NAO_E_O_CASO = "CONFIRMO", "NAO_E_O_CASO"
REGRAS = ["e1_material", "e2_obra", "e3_seguro", "e4_rural", "e5_situacao", "e6_comercial", "e7_territorial",
          "enq_vinculo"]
REGRAS_E = REGRAS[:7]  # E1 a E7: definem eleg_situacao
DESTINO_REVISAO = "revisão da apólice"
DUVIDA_DECLARACAO = {"rural": "se o imóvel tem ligação com atividade rural",
                     "tombado": "se o imóvel é tombado, desapropriado ou condenado",
                     "comercial": "se há atividade comercial além de MEI aceito",
                     "comunidade": "se o imóvel fica em comunidade carente ou favela"}


def brl(x: float) -> str:
    return "R$ " + f"{x:,.0f}".replace(",", ".")


# --------------------------------------------------------------------------
# Carga da base consolidada (uma linha por cliente + imóvel)
# --------------------------------------------------------------------------
def carregar(arquivo: str, estimador: Estimador | None = None) -> pd.DataFrame:
    """Lê a base consolidada e roda as estimativas do pacote do time (área por ML, bens e padrão)."""
    b = pd.read_csv(arquivo, encoding="utf-8-sig", low_memory=False)
    est = estimador or Estimador()
    b = _est.enriquecer(b, est.art_area, est.params, est.prem)
    o = lambda c: b[f"obs_{c}"]
    df = pd.DataFrame({
        "cliente_id": b.cliente_id, "imovel_id": b.imovel_id,
        **{c: o(c) for c in (
            "possui_termo_apartamento", "possui_termo_condominio", "material_parede_externa_cadastrado",
            "padrao_construtivo_cadastrado", "possui_seguro_residencial",
            "pagamento_aluguel_recorrente", "valor_aluguel_recorrente", "credito_recorrente_compativel_aluguel",
            "valor_medio_credito_recorrente", "parcela_financiamento_imobiliario",
            "gastos_material_construcao_24m", "gastos_vidracaria_24m", "quantidade_dependentes",
            "possui_pet_informado")},
        # nulo = sem área cadastral utilizável (não é zero m²)
        "area_cadastrada_m2": b.der_area_cadastral_utilizavel_m2.fillna(0),
        "origem_area": b.ctl_origem_area,
        # estimativas (motor_estimativas): valor + faixa P10-P90 da área; sugerido + mín/máx dos bens
        "area_est_m2": b.est_area_m2, "area_est_min_m2": b.est_area_min_m2, "area_est_max_m2": b.est_area_max_m2,
        "area_est_confianca": b.ctl_estimativa_area_confianca,
        "area_fora_dominio": b.ctl_estimativa_area_fora_dominio.fillna(""),
        "bens_est": b.est_valor_bens_sugerido, "bens_est_min": b.est_valor_bens_min,
        "bens_est_max": b.est_valor_bens_max,
        # bens por categoria (as coberturas de danos elétricos e roubo usam a composição)
        **{f"bens_{c}_{k}": b[f"est_valor_bens_{c}_{k}"] for c in CATEGORIAS_BENS for k in ("sugerido", "min", "max")},
        "uf": o("uf_real"),
        "principal": o("endereco_principal_compativel").eq("SIM"),
        "endereco_txt": (o("logradouro") + ", " + o("numero").astype(str) + " " + o("complemento").fillna("")
                         + " - " + o("municipio_real") + "/" + o("uf_real")),
    })

    # Endereços do mesmo cliente (para quem tem 2 imóveis)
    df["outros_principais"] = df.groupby("cliente_id").principal.transform("sum") - df.principal.astype(int)
    por_cliente: dict[str, list] = {}
    for c, im, t in zip(df.cliente_id, df.imovel_id, df.endereco_txt):
        por_cliente.setdefault(c, []).append((im, t))
    df["outro_endereco"] = [next((t for i, t in por_cliente[c] if i != im), "")
                            for c, im in zip(df.cliente_id, df.imovel_id)]
    return df


# --------------------------------------------------------------------------
# Estado inicial: só dados, nenhuma pergunta
# --------------------------------------------------------------------------
def C(valor, origem: str, confianca: str, nota: str = "", **extra) -> dict:
    return {"valor": valor, "origem": origem, "confianca": confianca, "nota": nota, **extra}


def estado_inicial(caso: dict) -> dict:
    apto = caso["possui_termo_apartamento"] == "SIM"
    principal = caso["principal"]
    paga = caso["pagamento_aluguel_recorrente"] == "SIM"
    recebe = caso["credito_recorrente_compativel_aluguel"] == "SIM"
    financia = caso["parcela_financiamento_imobiliario"] > 0
    f: dict[str, dict] = {}

    casa_cond = not apto and caso["possui_termo_condominio"] == "SIM"
    f["tipo"] = C("APARTAMENTO" if apto else "CASA_CONDOMINIO" if casa_cond else "CASA",
                  "DERIVADO", "alta", "complemento e termos do endereço")

    mat = caso["material_parede_externa_cadastrado"]
    if mat != "NAO_DISPONIVEL":
        f["material"] = C(mat, "OBSERVADO", "alta", "cadastro")
    elif apto:
        f["material"] = C("ALVENARIA", "DERIVADO", "media", "apartamento: presumido alvenaria (VALIDAR)")
    else:
        f["material"] = C(None, "AUSENTE", "nenhuma", "material não cadastrado")

    # Ausência de gasto não comprova ausência de obra: por isso a declaração final também cobre obra.
    g = caso["gastos_material_construcao_24m"]
    if g > LIMIAR_OBRA_PERGUNTA:
        f["obra"] = C(None, "AUSENTE", "nenhuma", f"{brl(g)} em material de construção em 24 meses")
    else:
        f["obra"] = C("NAO", "DERIVADO", "media",
                      "sem compra de material de construção" if g == 0 else f"compras pequenas ({brl(g)})")

    if principal and caso["outros_principais"] == 0:
        f["uso"] = C("HABITUAL", "DERIVADO", "media", "endereço compatível com o principal")
    elif principal:
        f["uso"] = C(None, "AUSENTE", "nenhuma", "mais de um endereço compatível com o principal")
    elif recebe:
        f["uso"] = C("ALUGADO_TERCEIROS", "DERIVADO", "baixa",
                     f"crédito recorrente compatível com aluguel (~{brl(caso['valor_medio_credito_recorrente'])}/mês)")
    else:
        f["uso"] = C(None, "AUSENTE", "nenhuma", "endereço diferente do principal")

    # Pagamentos sugerem, mas não comprovam. Ausência de aluguel ou financiamento não prova imóvel quitado.
    if financia:
        f["vinculo"] = C("PROPRIETARIO_FINANCIADO", "DERIVADO", "alta",
                         f"parcela de financiamento de {brl(caso['parcela_financiamento_imobiliario'])}")
    elif paga and principal:
        f["vinculo"] = C("INQUILINO", "DERIVADO", "media", "aluguel recorrente e endereço principal")
    elif paga:
        f["vinculo"] = C("INQUILINO", "DERIVADO", "baixa", "paga aluguel, mas este não é o endereço principal")
    elif recebe and not principal:
        f["vinculo"] = C("LOCADOR", "DERIVADO", "baixa", "recebe crédito compatível com aluguel")
    else:
        f["vinculo"] = C(None, "AUSENTE", "nenhuma", "sem sinal de aluguel nem de financiamento")

    if caso["area_cadastrada_m2"] > 0:
        a = float(caso["area_cadastrada_m2"])
        f["area"] = C(a, "OBSERVADO", "alta", caso["origem_area"], faixa=(a, a))
    else:
        lo, mid, hi = caso["area_est_min_m2"], caso["area_est_m2"], caso["area_est_max_m2"]
        fora = f"; sinais fora da faixa de treino ({caso['area_fora_dominio']})" if caso["area_fora_dominio"] else ""
        f["area"] = C(mid, "ESTIMADO", str(caso["area_est_confianca"]).lower(),
                      "modelo de ML (IPTU, energia, água, condomínio, tipo e cidade); faixa P10-P90" + fora,
                      faixa=(lo, hi))

    pad = caso["padrao_construtivo_cadastrado"]
    f["padrao"] = (C(pad, "OBSERVADO", "alta", "cadastro") if pad != "NAO_DISPONIVEL"
                   else C(None, "AUSENTE", "nenhuma", "padrão não cadastrado; não é perguntado ao cliente (decisão do time)"))

    lo, sug, hi = caso["bens_est_min"], caso["bens_est"], caso["bens_est_max"]
    if hi > 0:
        f["bens"] = C(sug, "ESTIMADO", "media",
                      "bens cadastrados ponderados + compras de 36 meses, por categoria (renda não usada)",
                      faixa=(lo, hi))
    else:
        f["bens"] = C(0.0, "DERIVADO", "media", "sem bens cadastrados nem compras recentes", faixa=(0.0, 0.0))

    # O indicador é do cliente: não comprova seguradora, endereço nem apólice vigente.
    # Uma consulta à base de apólices da BB (VERIFICADO_EXTERNO) dispensaria a pergunta.
    if caso["possui_seguro_residencial"] == "SIM":
        f["seguro_bb"] = C(None, "AUSENTE", "nenhuma", "cliente tem seguro residencial BB em algum endereço")
    else:
        f["seguro_bb"] = C("NAO", "DERIVADO", "alta", "cliente sem seguro residencial BB")

    e = {"caso": caso, "f": f, "respondidas": [], "declaracao": None, "refinos": 0, "revisao": 0}
    # One Click Buy: nenhuma pergunta de decisão desde o início (fora as estimativas de área e bens).
    # Decidido aqui e guardado: depois das respostas, todo caso ficaria sem perguntas.
    e["one_click"] = not [c for c in candidatas(e) if c[0] <= 2 and c[2].id not in ESTIMATIVAS]
    return e


# --------------------------------------------------------------------------
# Regras de restrição E1 a E7 (guia final 9.1; gatilhos e ações = proposta do time)
# --------------------------------------------------------------------------
def regras(e: dict) -> dict[str, tuple[str, str, str]]:
    """(situação, motivo, destino) de cada regra. O destino só existe quando a restrição é confirmada."""
    f, d = e["f"], (e["declaracao"] or {})
    r = {k: (SEM, "", "") for k in REGRAS}

    mat = f["material"]["valor"]
    if mat in ("MADEIRA", "MADEIRA_PREFABRICADA", "COMBUSTIVEL_PREDOMINANTE"):
        r["e1_material"] = (REST, "material combustível declarado: verificar material e exceção de madeira "
                                  "pré-fabricada ABNT/IBAMA", "especialista")
    elif mat in (None, "MISTA", NAO_SEI):
        r["e1_material"] = (PEND, "material das paredes externas a confirmar", "")

    obra = f["obra"]["valor"]
    if obra == "EM_ANDAMENTO":
        r["e2_obra"] = (REST, "imóvel em construção, reforma ou reconstrução: verificar fase e previsão de término",
                        "especialista")
    elif obra in (None, NAO_SEI):
        r["e2_obra"] = (PEND, "situação de obra a confirmar", "")

    seguro = f["seguro_bb"]["valor"]
    if seguro == "SIM":
        r["e3_seguro"] = (REST, "endereço já tem seguro residencial BB: vedada nova proposta", DESTINO_REVISAO)
    elif seguro in (None, NAO_SEI):
        r["e3_seguro"] = (PEND, "seguro BB do endereço a confirmar", "")

    for regra, item, motivo, destino in (
            ("e4_rural", "rural", "imóvel ligado a atividade rural: avaliar exceção da casa-sede ou seguro rural",
             "especialista ou seguro rural"),
            ("e5_situacao", "tombado", "imóvel tombado, desapropriado ou condenado", "especialista"),
            ("e6_comercial", "comercial", "atividade comercial além de MEI aceito", "Seguro Empresarial"),
            ("e7_territorial", "comunidade", "imóvel em comunidade carente ou favela", "especialista")):
        if d.get(item) == NAO_E_O_CASO:
            r[regra] = (REST, motivo, destino)
        elif d.get(item) == NAO_SEI:
            r[regra] = (PEND, f"{DUVIDA_DECLARACAO[item]}: cliente não soube responder", "")

    if f["vinculo"]["valor"] == "CEDIDO":
        r["enq_vinculo"] = (VINCULO_CEDIDO_SITUACAO, "vínculo cedido: validar aceitação com a BB",
                            "especialista" if VINCULO_CEDIDO_SITUACAO == REST else "")
    return r


def elegibilidade(e: dict) -> tuple[str, str]:
    """Situação do caso = pior resultado entre as regras E1 a E7, com os motivos desse nível.
    O enquadramento (enq_vinculo) não entra aqui: ele só afeta a ação da Bússola."""
    r = [v for k, v in regras(e).items() if k in REGRAS_E]
    pior = max((s for s, _, _ in r), key=GRAVIDADE.get)
    return pior, "; ".join(m for s, m, _ in r if s == pior and s != SEM)


def contexto_score(e: dict) -> dict:
    """Evidências do perfil para o score: vínculo e uso efetivos, dependentes, pet, vidraçaria e os valores
    sugeridos de roubo (bens portáteis) e incêndio (valor em risco). Renda e idade não entram."""
    cob = {c["cobertura"]: c["valor_sugerido"] for c in coberturas(e)}
    caso = e["caso"]
    return {"vinculo": insumos_coberturas(e)["vinculo"], "uso": e["f"]["uso"]["valor"],
            "dependentes": int(caso["quantidade_dependentes"]), "pet": caso["possui_pet_informado"] == "SIM",
            "vidracaria": float(caso["gastos_vidracaria_24m"]),
            "bens_portateis": float(cob["ROUBO_FURTO_ARROMBAMENTO"]),
            "incendio_sugerido": float(cob["INCENDIO_RAIO_EXPLOSAO_FUMACA"])}


def avaliacao_plano(e: dict) -> dict:
    """Score e aderência (%) de cada plano, plano mínimo por necessidade crítica e justificativas."""
    return _score.avaliar(contexto_score(e))


def plano_recomendado(e: dict) -> str:
    return avaliacao_plano(e)["plano"]


# --------------------------------------------------------------------------
# Coberturas: faixa de valor de cada uma (pacote coberturas/), com o estado atual do cliente
# --------------------------------------------------------------------------
_CALCULADORA: CalculadoraCoberturas | None = None
_CACHE_COBERTURAS: dict[str, list[dict]] = {}
# vínculo do motor -> vínculo do pacote de coberturas (sob gestão, cedido ou desconhecido: como morador proprietário)
VINCULO_COBERTURA = {"PROPRIETARIO_QUITADO": "PROPRIO_QUITADO", "PROPRIETARIO_FINANCIADO": "PROPRIO_FINANCIADO",
                     "INQUILINO": "INQUILINO", "LOCADOR": "PROPRIO_ALUGADO_TERCEIROS"}


def bens_por_categoria(e: dict) -> tuple[dict, dict]:
    """(mín, máx) por categoria. Estimados: os do pacote de estimativas. Faixa informada pelo cliente (total):
    distribuída entre as categorias na proporção da estimativa."""
    caso, f = e["caso"], e["f"]["bens"]
    if f["origem"] != "DECLARADO":
        return ({c: float(caso[f"bens_{c}_min"]) for c in CATEGORIAS_BENS},
                {c: float(caso[f"bens_{c}_max"]) for c in CATEGORIAS_BENS})
    sug = {c: float(caso[f"bens_{c}_sugerido"]) for c in CATEGORIAS_BENS}
    total = sum(sug.values())
    peso = {c: (sug[c] / total if total else 1 / len(CATEGORIAS_BENS)) for c in CATEGORIAS_BENS}
    lo, hi = f["faixa"]
    return {c: lo * peso[c] for c in CATEGORIAS_BENS}, {c: hi * peso[c] for c in CATEGORIAS_BENS}


def insumos_coberturas(e: dict) -> dict:
    """Valores efetivos do cliente (dados, estimativas e respostas) no formato da calculadora de coberturas."""
    f, caso = e["f"], e["caso"]
    area = f["area"]
    bmin, bmax = bens_por_categoria(e)
    vinculo = ("PROPRIO_ALUGADO_TERCEIROS" if f["uso"]["valor"] == "ALUGADO_TERCEIROS"
               else VINCULO_COBERTURA.get(f["vinculo"]["valor"], "PROPRIO_QUITADO"))
    return dict(
        uf=caso["uf"], tipo="APARTAMENTO" if f["tipo"]["valor"] == "APARTAMENTO" else "CASA",
        area=float(area["valor"]), area_min=float(area["faixa"][0]), area_max=float(area["faixa"][1]),
        area_origem={"ESTIMADO": "ESTIMADO", "OBSERVADO": "OBSERVADO"}.get(area["origem"], "CONFIRMADO"),
        area_confianca=area["confianca"].upper(),
        padrao=f["padrao"]["valor"] or "NAO_DISPONIVEL",  # só do cadastro: o padrão não é perguntado
        vinculo=vinculo,
        bens={c: (bmin[c] * bmax[c]) ** 0.5 for c in CATEGORIAS_BENS}, bens_min=bmin, bens_max=bmax,
        bens_origem="CONFIRMADO" if f["bens"]["origem"] == "DECLARADO" else "ESTIMADO",
        aluguel_pago=float(caso["valor_aluguel_recorrente"]), aluguel_recebido=float(caso["valor_medio_credito_recorrente"]),
        dependentes=int(caso["quantidade_dependentes"]), pet=caso["possui_pet_informado"] == "SIM",
        gasto_vidracaria_24m=float(caso["gastos_vidracaria_24m"]),
        ID=caso["imovel_id"], cliente_id=caso["cliente_id"], imovel_id=caso["imovel_id"])


def coberturas(e: dict, plano: str | None = None) -> list[dict]:
    """Faixa de valor de cada cobertura (sugerido, mínimo e máximo do seletor). Com `plano`, só as do plano."""
    global _CALCULADORA
    _CALCULADORA = _CALCULADORA or CalculadoraCoberturas()
    ins = insumos_coberturas(e)
    chave = json.dumps(ins, sort_keys=True, default=float)
    if chave not in _CACHE_COBERTURAS:  # o score recalcula a cada resposta simulada: evita refazer o mesmo cálculo
        _CACHE_COBERTURAS[chave] = _CALCULADORA.calcular_insumos(**ins)
    linhas = _CACHE_COBERTURAS[chave]
    return _CALCULADORA.filtrar_plano(linhas, plano) if plano else linhas


def faixa_referencia(e: dict) -> tuple[float, float]:
    """Proxy de 'quanto a gente ainda não sabe': reconstrução (área x custo/m²) + conteúdo."""
    f = e["f"]
    a_lo, a_hi = f["area"]["faixa"]
    p = f["padrao"]["valor"]
    c_lo, c_hi = (CUSTO_M2_ILUSTRATIVO[p],) * 2 if p else (min(CUSTO_M2_ILUSTRATIVO.values()),
                                                            max(CUSTO_M2_ILUSTRATIVO.values()))
    b_lo, b_hi = f["bens"]["faixa"]
    return a_lo * c_lo + b_lo, a_hi * c_hi + b_hi


# --------------------------------------------------------------------------
# Banco de perguntas
# --------------------------------------------------------------------------
@dataclass
class Opcao:
    rotulo: str
    efeito: Callable[[dict], None]


@dataclass
class Pergunta:
    id: str
    campo: str
    ordem: int                                   # desempate dentro da mesma prioridade
    gatilho: Callable[[dict], bool]              # quando a pergunta faz sentido
    texto: Callable[[dict], str]                 # texto personalizado com os dados do cliente
    opcoes: Callable[[dict], list[Opcao]]
    sugestao: Callable[[dict], int | None] = lambda e: None  # opção pré-selecionada pelos dados


def setar(campo: str, valor, nota: str = "resposta do cliente", **extra):
    def ef(e):
        e["f"][campo] = C(valor, "DECLARADO", "alta", nota, **extra)
    return ef


def manter(campo: str):
    """'Não sei' em campo com estimativa: mantém o valor e a origem, só registra a resposta (B8)."""
    def ef(e):
        e["f"][campo] = {**e["f"][campo], "nota": e["f"][campo]["nota"] + "; cliente não soube confirmar"}
    return ef


def varios(*efeitos):
    def ef(e):
        for x in efeitos:
            x(e)
    return ef


NAO_SEI_OPCAO = "Não sei"


def precisa_residencia(e: dict) -> bool:
    c = e["caso"]
    return (c["principal"] and c["outros_principais"] > 0 and e["f"]["uso"]["valor"] is None
            and "residencia_principal" not in e["respondidas"])


def _arred(x: float) -> float:
    """Centenas abaixo de R$ 10 mil, milhares acima; 0,5 arredonda para cima (igual ao Math.round do front)."""
    passo = 100 if x < 10_000 else 1000
    return float(np.floor(x / passo + 0.5) * passo)


def _faixas(lo: float, mid: float, hi: float) -> list[tuple[float, float]]:
    """Cinco faixas em volta da estimativa; a do meio contém o valor estimado.
    Quando o mínimo é zero, a faixa 'menos de' some."""
    a, b = (lo + mid) / 2, (mid + hi) / 2
    fx = [(lo * 0.7, lo), (lo, a), (a, b), (b, hi), (hi, hi * 1.3)]
    return fx[1:] if lo <= 0 else fx


def _opcoes_faixa(campo: str, fmt: Callable[[float], str]):
    """Confirmação por faixa (DECLARADO com a faixa escolhida) + 'Não sei' (mantém a estimativa)."""
    def opcoes(e):
        f = e["f"][campo]
        fx = _faixas(f["faixa"][0], f["valor"], f["faixa"][1])
        rot = ([f"Menos de {fmt(fx[0][1])}"] if len(fx) == 5 else []) + \
              [f"Entre {fmt(x)} e {fmt(y)}" for x, y in fx[len(fx) - 4:-1]] + [f"Mais de {fmt(fx[-1][0])}"]
        return ([Opcao(r, setar(campo, (x + y) / 2, faixa=(x, y))) for r, (x, y) in zip(rot, fx)]
                + [Opcao(NAO_SEI_OPCAO, manter(campo))])
    return opcoes


def _faixa_estimada(e: dict, campo: str) -> int:
    """Índice da faixa que contém a estimativa (pré-marcada)."""
    f = e["f"][campo]
    return 2 if f["faixa"][0] > 0 else 1


_opcoes_area = _opcoes_faixa("area", lambda x: f"{round(x)} m²")
_opcoes_bens = _opcoes_faixa("bens", lambda x: brl(_arred(x)))


def _texto_vinculo(e):
    c = e["caso"]
    if c["pagamento_aluguel_recorrente"] == "SIM":
        return (f"Identificamos um pagamento recorrente de aluguel de ~{brl(c['valor_aluguel_recorrente'])}/mês. "
                "Qual é a sua relação com este imóvel?")
    return "Qual é a sua relação com este imóvel?"


def _texto_seguro(e):
    c = e["caso"]
    if c["outro_endereco"]:  # B1: com dois imóveis, esclarecer só a associação necessária
        return "Você tem seguro residencial da BB Seguros. Qual dos seus imóveis já tem seguro?"
    return f"Você tem seguro residencial da BB Seguros. Este endereço ({c['endereco_txt']}) já tem seguro?"


def _opcoes_seguro(e):
    c = e["caso"]
    if c["outro_endereco"]:
        return [Opcao(f"O outro: {c['outro_endereco']}", setar("seguro_bb", "NAO")),
                Opcao(f"Este: {c['endereco_txt']}", setar("seguro_bb", "SIM")),
                Opcao("Os dois", setar("seguro_bb", "SIM")),
                Opcao(NAO_SEI_OPCAO, setar("seguro_bb", NAO_SEI))]
    return [Opcao("Não", setar("seguro_bb", "NAO")),
            Opcao("Sim", setar("seguro_bb", "SIM")),
            Opcao(NAO_SEI_OPCAO, setar("seguro_bb", NAO_SEI))]


BANCO: list[Pergunta] = [
    Pergunta(
        id="residencia_principal", campo="uso", ordem=0,
        gatilho=precisa_residencia,
        texto=lambda e: (f"Você tem mais de um endereço cadastrado. Você mora em "
                         f"{e['caso']['endereco_txt']}?"),
        opcoes=lambda e: [
            Opcao("Sim, moro neste", setar("uso", "HABITUAL")),
            Opcao(f"Não, moro em {e['caso']['outro_endereco'] or 'outro endereço'}",
                  lambda e: e["f"].__setitem__("uso", C(None, "AUSENTE", "nenhuma", "cliente mora em outro endereço"))),
        ],
    ),
    Pergunta(
        id="uso", campo="uso", ordem=1,
        gatilho=lambda e: e["f"]["uso"]["confianca"] in ("nenhuma", "baixa") and not precisa_residencia(e),
        texto=lambda e: "Como este imóvel é usado hoje?",
        opcoes=lambda e: [
            Opcao("Moro nele", setar("uso", "HABITUAL")),
            Opcao("Casa de temporada / lazer", setar("uso", "TEMPORADA")),
            Opcao("Está alugado para outra pessoa",
                  varios(setar("uso", "ALUGADO_TERCEIROS"), setar("vinculo", "LOCADOR"))),
            Opcao("Está desocupado", setar("uso", "DESOCUPADO")),
            Opcao(NAO_SEI_OPCAO, manter("uso")),
        ],
        sugestao=lambda e: 2 if e["f"]["uso"]["valor"] == "ALUGADO_TERCEIROS" else None,
    ),
    Pergunta(
        id="material", campo="material", ordem=2,
        gatilho=lambda e: e["f"]["material"]["valor"] is None,
        texto=lambda e: "De que material são feitas as paredes externas do imóvel?",
        opcoes=lambda e: [
            Opcao("Alvenaria ou concreto", setar("material", "ALVENARIA")),
            Opcao("Mista (alvenaria e madeira)", setar("material", "MISTA")),
            Opcao("Madeira pré-fabricada (normas ABNT e IBAMA)", setar("material", "MADEIRA_PREFABRICADA")),
            Opcao("Madeira ou outro material inflamável", setar("material", "MADEIRA")),
            Opcao(NAO_SEI_OPCAO, setar("material", NAO_SEI)),
        ],
        sugestao=lambda e: 0,
    ),
    Pergunta(  # só aparece se a resposta anterior foi "Mista"
        id="material_predominante", campo="material", ordem=3,
        gatilho=lambda e: e["f"]["material"]["valor"] == "MISTA",
        texto=lambda e: "Mais da metade das paredes externas é de alvenaria ou concreto?",
        opcoes=lambda e: [
            Opcao("Sim", setar("material", "ALVENARIA_PREDOMINANTE")),
            Opcao("Não", setar("material", "COMBUSTIVEL_PREDOMINANTE")),
            Opcao(NAO_SEI_OPCAO, setar("material", NAO_SEI)),
        ],
    ),
    Pergunta(
        id="obra", campo="obra", ordem=4,
        gatilho=lambda e: e["f"]["obra"]["valor"] is None,
        texto=lambda e: ((f"Vimos {brl(e['caso']['gastos_material_construcao_24m'])} em compras de material "
                          "de construção nos últimos 24 meses. ")
                         if e["caso"]["gastos_material_construcao_24m"] > 0 else "")
                        + "O imóvel está em obra ou reforma agora?",
        opcoes=lambda e: [
            Opcao("Não", setar("obra", "NAO")),
            Opcao("A obra já foi concluída", setar("obra", "CONCLUIDA")),
            Opcao("Só manutenção (pintura, pequenos reparos)", setar("obra", "MANUTENCAO")),
            Opcao("Sim, em andamento", setar("obra", "EM_ANDAMENTO")),
            Opcao(NAO_SEI_OPCAO, setar("obra", NAO_SEI)),
        ],
    ),
    Pergunta(
        id="seguro_bb", campo="seguro_bb", ordem=5,
        gatilho=lambda e: e["f"]["seguro_bb"]["valor"] is None,
        texto=_texto_seguro,
        opcoes=_opcoes_seguro,
    ),
    Pergunta(
        id="vinculo", campo="vinculo", ordem=6,
        gatilho=lambda e: e["f"]["vinculo"]["confianca"] in ("nenhuma", "baixa"),
        texto=_texto_vinculo,
        opcoes=lambda e: [
            Opcao("É meu e já está quitado", setar("vinculo", "PROPRIETARIO_QUITADO")),
            Opcao("É meu e está financiado em outra instituição", setar("vinculo", "PROPRIETARIO_FINANCIADO")),
            Opcao("Eu alugo este imóvel", setar("vinculo", "INQUILINO")),
            Opcao("Administro o imóvel (sob gestão)", setar("vinculo", "SOB_GESTAO")),
            Opcao("É cedido / emprestado", setar("vinculo", "CEDIDO")),
            Opcao(NAO_SEI_OPCAO, manter("vinculo")),
        ],
        sugestao=lambda e: 2 if e["caso"]["pagamento_aluguel_recorrente"] == "SIM" else 0,
    ),
    Pergunta(  # bens estimados: confirmação por faixa, pré-marcada na faixa da estimativa
        id="bens", campo="bens", ordem=7,
        gatilho=lambda e: e["f"]["bens"]["origem"] == "ESTIMADO",
        texto=lambda e: ("Pelos bens cadastrados e pelas compras recentes, estimamos que móveis, eletrodomésticos, "
                         f"eletrônicos e itens de lazer neste imóvel valham cerca de "
                         f"{brl(_arred(e['f']['bens']['valor']))}. Qual faixa descreve melhor?"),
        opcoes=_opcoes_bens,
        sugestao=lambda e: _faixa_estimada(e, "bens"),
    ),
    Pergunta(  # a área define a importância segurada de incêndio: confirmação sempre, pré-preenchida
        id="area", campo="area", ordem=8,
        gatilho=lambda e: e["f"]["area"]["origem"] == "ESTIMADO",
        texto=lambda e: (f"Pelas contas do imóvel, estimamos cerca de {round(e['f']['area']['valor'])} m² "
                         f"(provavelmente entre {round(e['f']['area']['faixa'][0])} e "
                         f"{round(e['f']['area']['faixa'][1])} m²). Qual faixa descreve melhor?"),
        opcoes=_opcoes_area,
        sugestao=lambda e: _faixa_estimada(e, "area"),
    ),
]
POR_ID = {p.id: p for p in BANCO}
PERGUNTAS_FAIXA = {"bens", "area"}  # além das faixas prontas, aceitam uma faixa livre (mínimo e máximo do cliente)
# No One Click Buy as estimativas não viram tela própria: são confirmadas no fim da declaração final
# ("Confirmo" ou "Editar"; "Editar" leva à pergunta de faixa e volta). Nos demais casos, área e bens
# têm página própria, para ganhar precisão.
ESTIMATIVAS = ("area", "bens")


def agrupa_estimativas(e: dict) -> tuple[str, ...]:
    """Estimativas que ficam na declaração em vez de virar página (só no One Click Buy)."""
    return ESTIMATIVAS if e["one_click"] else ()


def estimativas_declaracao(e: dict) -> list[str]:
    """Campos estimados mostrados no fim da declaração (os já editados também, para poder editar de novo)."""
    return [c for c in agrupa_estimativas(e) if e["f"][c]["origem"] == "ESTIMADO" or c in e["respondidas"]]


def frase_estimativa(e: dict, campo: str) -> str:
    lo, hi = e["f"][campo]["faixa"]
    if campo == "bens":  # faixa editada pelo cliente aparece exata; estimada, arredondada
        fmt = brl if campo in e["respondidas"] else (lambda x: brl(_arred(x)))
        return f"Seus bens neste imóvel estão entre {fmt(lo)} e {fmt(hi)}"
    return f"A área do imóvel está entre {round(lo)} e {round(hi)} m²"


# --------------------------------------------------------------------------
# Priorização: simula as respostas e vê o que muda
# --------------------------------------------------------------------------
def _copia(e: dict) -> dict:
    return {**e, "f": copy.deepcopy(e["f"]), "respondidas": list(e["respondidas"])}


def classificar(p: Pergunta, e: dict) -> tuple[int | None, float]:
    saidas = []
    for op in p.opcoes(e):
        e2 = _copia(e)
        op.efeito(e2)
        saidas.append((elegibilidade(e2)[0], plano_recomendado(e2), faixa_referencia(e2)))
    if len({s[0] for s in saidas}) > 1 or p.id == "residencia_principal":
        return 1, 0.0
    # estimativas (área e bens) são base das faixas de cobertura: confirmação sempre (P2)
    if p.campo in CAMPOS_COTACAO or p.id in ESTIMATIVAS or len({s[1] for s in saidas}) > 1:
        return 2, 0.0
    lo, hi = faixa_referencia(e)
    largura = hi - lo
    depois = float(np.mean([s[2][1] - s[2][0] for s in saidas]))
    ganho = (largura - depois) / largura if largura > 0 else 0.0
    return (3, ganho) if ganho >= GANHO_MINIMO_REFINO else (None, 0.0)


def candidatas(e: dict) -> list[tuple[int, float, Pergunta]]:
    if elegibilidade(e)[0] == REST:
        return []
    out = []
    for p in BANCO:
        if p.id in e["respondidas"] or not p.gatilho(e):
            continue
        nivel, ganho = classificar(p, e)
        if nivel is not None:
            out.append((nivel, ganho, p))
    return sorted(out, key=lambda t: (t[0], -t[1], t[2].ordem))


def itens_declaracao(e: dict) -> list[tuple[str, str]]:
    """(campo, frase). Valores derivados de confiança média + restrições sem dado na base (E4 a E7)."""
    f, itens = e["f"], []
    if f["material"]["origem"] == "DERIVADO":
        itens.append(("material", "As paredes externas do prédio são de alvenaria ou concreto"))
    if f["obra"]["origem"] == "DERIVADO":
        itens.append(("obra", "O imóvel não está em construção, reforma ou reconstrução"))
    if f["uso"]["origem"] == "DERIVADO" and f["uso"]["valor"] == "HABITUAL":
        itens.append(("uso", "Você mora neste imóvel"))
    if f["vinculo"]["origem"] == "DERIVADO" and f["vinculo"]["confianca"] == "media":
        itens.append(("vinculo", "Você é inquilino deste imóvel"))
    itens += [("rural", "O imóvel não é rural nem usado para atividade rural (a casa-sede de uso pessoal é aceita)"),
              ("tombado", "O imóvel não é tombado, desapropriado nem condenado por órgão público"),
              ("comercial", "Não há atividade comercial no imóvel, exceto MEI da lista aceita"),
              ("comunidade", "O imóvel não fica em favela ou comunidade urbana")]
    return itens


def proxima(e: dict, refino: bool = True):
    """Devolve ('pergunta', prioridade, Pergunta) | ('declaracao', itens) | None."""
    cands = [c for c in candidatas(e) if c[2].id not in agrupa_estimativas(e)]
    decisao = [c for c in cands if c[0] <= 2]
    if decisao:
        return ("pergunta", decisao[0][0], decisao[0][2])
    if elegibilidade(e)[0] == REST:
        return None
    if e["declaracao"] is None:
        return ("declaracao", itens_declaracao(e))
    if refino and e["refinos"] < MAX_REFINO:
        ref = [c for c in cands if c[0] == 3]
        if ref:
            return ("pergunta", 3, ref[0][2])
    return None


def decisoes(e: dict) -> list[tuple[int, float, Pergunta]]:
    """Perguntas (P1/P2) que ainda viram tela própria; no One Click Buy, as estimativas ficam na declaração."""
    return [c for c in candidatas(e) if c[0] <= 2 and c[2].id not in agrupa_estimativas(e)]


def acao(e: dict, refino: bool = True) -> tuple[str, str]:
    """(bussola_acao, bussola_destino): o que a jornada faz agora."""
    r = regras(e)
    destinos = {dest for s, _, dest in r.values() if s == REST}
    if destinos == {DESTINO_REVISAO}:
        return "REVISAO_APOLICE", DESTINO_REVISAO
    if destinos:
        return "ENCAMINHAR_HUMANO", ", ".join(sorted(destinos - {DESTINO_REVISAO}))
    if proxima(e, refino) is not None:
        return "PERGUNTAR", ""
    if any(s == PEND for s, _, _ in r.values()):
        return "RESULTADO_PRELIMINAR", ""
    return "CONTINUAR", ""


def responder(e: dict, p: Pergunta, indice: int, nivel: int | None = None) -> None:
    p.opcoes(e)[indice].efeito(e)
    e["respondidas"].append(p.id)
    e["revisao"] += 1  # B9: toda resposta recalcula as decisões afetadas
    if nivel == 3:
        e["refinos"] += 1


def responder_faixa(e: dict, p: Pergunta, lo: float, hi: float, nivel: int | None = None) -> None:
    """Resposta com faixa livre (controle de mínimo e máximo): DECLARADO com a faixa que o cliente definiu."""
    setar(p.campo, (lo + hi) / 2, "faixa definida pelo cliente", faixa=(lo, hi))(e)
    e["respondidas"].append(p.id)
    e["revisao"] += 1
    if nivel == 3:
        e["refinos"] += 1


def responder_declaracao(e: dict, respostas: dict[str, str] | None = None) -> None:
    """respostas: campo -> CONFIRMO | NAO_E_O_CASO | NAO_SEI (ausente = CONFIRMO).
    Item ligado a um campo: 'não é o caso' -> o campo volta a 'ausente' e a pergunta específica reaparece;
    'não sei' em material ou obra mantém a pendência. Itens E4 a E7 ficam guardados para as regras.
    Estimativas ainda não editadas (área, bens) são confirmadas com a faixa estimada."""
    respostas = respostas or {}
    for campo in estimativas_declaracao(e):
        if campo not in e["respondidas"]:
            e["f"][campo].update(origem="DECLARADO", confianca="alta", nota="faixa estimada confirmada na declaração")
            e["respondidas"].append(campo)
    e["declaracao"] = {}
    for campo, _ in itens_declaracao(e):
        r = respostas.get(campo, CONFIRMO)
        if campo not in e["f"]:
            e["declaracao"][campo] = r
        elif r == NAO_E_O_CASO:
            e["f"][campo] = C(None, "AUSENTE", "nenhuma", "cliente não confirmou a declaração")
        elif r == CONFIRMO:
            e["f"][campo].update(origem="DECLARADO", confianca="alta", nota="confirmado na declaração")
        elif campo in ("material", "obra"):
            e["f"][campo] = C(NAO_SEI, "DECLARADO", "nenhuma", "cliente não soube confirmar")
    e["revisao"] += 1


def observacoes(e: dict) -> list[str]:
    """Informações que o guia pede na cotação, mas que não mudam a situação do caso."""
    f, obs = e["f"], []
    if f["vinculo"]["valor"] == "INQUILINO" or f["uso"]["valor"] == "ALUGADO_TERCEIROS":
        obs.append("imóvel alugado: indicar beneficiários distintos (locador para o imóvel, locatário para o conteúdo)")
    if f["obra"]["valor"] == "MANUTENCAO":
        obs.append("manutenção declarada: segue com ressalva (não equiparar manutenção a reforma)")
    if f["uso"]["valor"] == "DESOCUPADO":
        obs.append("imóvel desocupado: informação para o score; restrição a VALIDAR com a BB")
    return obs


def limitacoes(e: dict) -> list[str]:
    lim = []
    lim.append("E7 comunidade/favela: declarada pelo cliente; em produção a BB verifica pelo endereço real "
               "(malha de Favelas e Comunidades Urbanas do IBGE)")
    if e["f"]["area"]["origem"] == "ESTIMADO":
        lim.append("área estimada por modelo de ML (faixa P10-P90), ainda não confirmada")
    return lim


def pacote_encaminhamento(e: dict) -> dict:
    """B10: o que o gerente recebe para não repetir a entrevista."""
    r = regras(e)
    return {"situacao": elegibilidade(e)[0], "acao": acao(e)[0], "destino": acao(e)[1],
            "regras_acionadas": {k: v for k, v in r.items() if v[0] != SEM},
            "campos": {k: {x: v[x] for x in ("valor", "origem", "confianca", "nota")} for k, v in e["f"].items()},
            "respostas": list(e["respondidas"]), "declaracao": e["declaracao"],
            "perfil_revisao": e["revisao"]}


# --------------------------------------------------------------------------
# Modo lote: o que perguntaríamos, sem resposta nenhuma
# --------------------------------------------------------------------------
def perguntas_lote(e: dict) -> list[tuple[int, str, str]]:
    cands = [c for c in candidatas(e) if c[2].id not in agrupa_estimativas(e)]
    out = [(n, p.id, p.texto(e)) for n, _, p in cands if n <= 2]
    if elegibilidade(e)[0] != REST:
        frases = "; ".join([t for _, t in itens_declaracao(e)] + [frase_estimativa(e, c) for c in estimativas_declaracao(e)])
        out.append((1, "declaracao", f"Confirme: {frases}"))
        out += [(n, p.id, p.texto(e)) for n, _, p in cands if n == 3][:MAX_REFINO]
    return out


def linha_lote(e: dict) -> dict:
    caso, r = e["caso"], regras(e)
    situacao, motivo = elegibilidade(e)
    ac, destino = acao(e)
    ps = perguntas_lote(e)
    linha = {"cliente_id": caso["cliente_id"], "imovel_id": caso["imovel_id"],
             **{f"eleg_{k}": s for k, (s, _, _) in r.items()},
             "eleg_situacao": situacao, "eleg_motivo": motivo,
             "eleg_regra_acionada": " | ".join(k for k, (s, _, _) in r.items()
                                               if k in REGRAS_E and s == situacao and s != SEM),
             "bussola_acao": ac, "bussola_destino": destino,
             "bussola_pendencias": " | ".join(f"P{n}:{i}" for n, i, _ in ps),
             "one_click_buy": "SIM" if e["one_click"] else "NAO",
             "confirmar_na_declaracao": " | ".join(estimativas_declaracao(e)),
             "n_p1": sum(n == 1 for n, *_ in ps), "n_p2": sum(n == 2 for n, *_ in ps),
             "n_p3": sum(n == 3 for n, *_ in ps),
             "perfil_revisao": e["revisao"]}
    av = avaliacao_plano(e)
    linha.update({"plano_recomendado": av["plano"], "plano_alternativo": av["alternativa"],
                  "plano_minimo_por_necessidade": av["plano_minimo"],
                  **{f"aderencia_{p.lower()}_pct": av["aderencia"][p] for p in _score.PLANOS},
                  "scores_json": json.dumps(av["scores"]), "necessidades_json": json.dumps(av["necessidades"]),
                  "justificativa_plano": " ".join(av["justificativas"])})
    for k, v in e["f"].items():
        linha.update({k: v["valor"], f"{k}_origem": v["origem"], f"{k}_confianca": v["confianca"]})
        if "faixa" in v:  # faixa da estimativa (ou a escolhida pelo cliente), base para as faixas das coberturas
            linha.update({f"{k}_min": round(v["faixa"][0], 1), f"{k}_max": round(v["faixa"][1], 1)})
    linha.update({"perguntas_confirmacao": " | ".join(t for _, _, t in ps),
                  "observacoes": " | ".join(observacoes(e)), "limitacoes": " | ".join(limitacoes(e))})
    return linha


# --------------------------------------------------------------------------
# Execução
# --------------------------------------------------------------------------
def simular(e: dict, respostas: dict[str, int] | None = None, declarar: dict[str, str] | None = None,
            refino: bool = True, editar: dict[str, tuple[float, float]] | None = None) -> list[str]:
    """Respondente simulado: usa a resposta dada em `respostas`, senão a sugestão dos dados, senão a 1ª.
    `declarar` responde a declaração final (campo -> NAO_E_O_CASO | NAO_SEI); vale só na primeira vez.
    `editar` troca a faixa de uma estimativa pelo botão "Editar" da declaração (campo -> (mín, máx))."""
    respostas, log = respostas or {}, []
    while (passo := proxima(e, refino)) is not None:
        if passo[0] == "declaracao":
            for campo, (lo, hi) in (editar or {}).items():
                responder_faixa(e, POR_ID[campo], lo, hi)
                log.append(f"[declaração: editar {campo}] faixa {brl(lo)} a {brl(hi)}")
            est = [frase_estimativa(e, c) for c in estimativas_declaracao(e)]
            d = {c: r for c, r in (declarar or {}).items() if c in dict(passo[1])}
            log.append(f"[declaração P1] {len(passo[1])} itens + {len(est)} estimativas -> "
                       + ("confirma tudo" if not d else str(d)) + "".join(f"\n           {t}" for t in est))
            responder_declaracao(e, d)
            editar = {}
            declarar = {}
            continue
        _, nivel, p = passo
        sug = p.sugestao(e)
        i = respostas.get(p.id, sug if sug is not None else 0)
        rot = p.opcoes(e)[i].rotulo
        log.append(f"[P{nivel}] {p.texto(e)}\n           -> {rot}")
        responder(e, p, i, nivel)
    situacao, motivo = elegibilidade(e)
    ac, destino = acao(e, refino)
    lo, hi = faixa_referencia(e)
    log.append(f"RESULTADO: {situacao}{' (' + motivo + ')' if motivo else ''} | ação={ac}"
               f"{' -> ' + destino if destino else ''} | plano={plano_recomendado(e)} ({avaliacao_plano(e)['aderencia'][plano_recomendado(e)]}% de aderência) | "
               f"incerteza de valor (proxy)={brl(lo)} a {brl(hi)}")
    return log


def interativo(e: dict) -> None:
    def mostrar_estado():
        for k, v in e["f"].items():
            print(f"   {k:9s} {str(v['valor']):26s} {v['origem']:11s} {v['confianca']:8s} {v['nota']}")
    print("\nEstado inicial (só dados):"); mostrar_estado()
    while (passo := proxima(e)) is not None:
        if passo[0] == "declaracao":
            print("\nConfirme as informações abaixo:")
            for i, (_, t) in enumerate(passo[1], 1):
                print(f"  {i}. {t}")
            for c in estimativas_declaracao(e):
                r = input(f"  {frase_estimativa(e, c)}. Enter = confirmo, ou digite outra faixa (ex.: 80-120): ").strip()
                if "-" in r:
                    lo, hi = sorted(float(x) for x in r.replace(".", "").split("-")[:2])
                    responder_faixa(e, POR_ID[c], lo, hi)
            itens = [c for c, _ in passo[1]]
            ler = lambda msg: [itens[int(x) - 1] for x in input(msg).replace(",", " ").split()
                               if x.isdigit() and 0 < int(x) <= len(itens)]
            d = {c: NAO_E_O_CASO for c in ler("Números que NÃO são o caso (Enter = nenhum): ")}
            d.update({c: NAO_SEI for c in ler("Números que você NÃO SABE (Enter = nenhum): ")})
            responder_declaracao(e, d)
            continue
        _, nivel, p = passo
        print(f"\n[P{nivel}] {p.texto(e)}")
        sug = p.sugestao(e)
        for i, op in enumerate(p.opcoes(e), 1):
            print(f"  {i}. {op.rotulo}{'   <- sugerido pelos dados' if sug == i - 1 else ''}")
        if p.id in PERGUNTAS_FAIXA:
            print("  ou digite uma faixa sua, por exemplo 15000-25000")
        r = input("Resposta: ").strip()
        if p.id in PERGUNTAS_FAIXA and "-" in r:
            lo, hi = sorted(float(x) for x in r.replace(".", "").split("-")[:2])
            responder_faixa(e, p, lo, hi, nivel)
        else:
            responder(e, p, (int(r) - 1) if r.isdigit() else (sug or 0), nivel)
        print(f"   situação: {elegibilidade(e)[0]} | ação: {acao(e)[0]}")
    print("\nEstado final:"); mostrar_estado()
    situacao, motivo = elegibilidade(e)
    ac, destino = acao(e)
    print(f"\nSituação: {situacao} {motivo}\nAção: {ac} {destino}\nPlano: {plano_recomendado(e)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="CSV consolidado a processar")
    ap.add_argument("--lote", action="store_true")
    ap.add_argument("--interativo", metavar="IMOVEL_ID")
    ap.add_argument("--exemplos", action="store_true")
    ap.add_argument("--saida", default="perguntas_por_caso.csv")
    a = ap.parse_args()

    est = Estimador()
    print(f"Estimativas: {est.versao}")
    df = carregar(a.base, est)
    casos = {r["imovel_id"]: r for r in df.to_dict("records")}

    if a.interativo:
        interativo(estado_inicial(casos[a.interativo]))
    if a.lote:
        estados = [estado_inicial(caso) for caso in casos.values()]
        out = pd.DataFrame([linha_lote(e) for e in estados])
        out.to_csv(a.saida, index=False, encoding="utf-8-sig")
        print(f"\n{len(out)} imóveis processados -> {a.saida}")
        # coberturas do plano recomendado de cada imóvel, no formato do template_coberturas_times (+ seletor)
        cob = pd.DataFrame([l for e in estados for l in coberturas(e, plano_recomendado(e))])
        saida_cob = str(Path(a.saida).with_name(Path(a.saida).stem + "_coberturas.csv"))
        cob.to_csv(saida_cob, index=False, encoding="utf-8-sig")
        print(f"{len(cob)} linhas de cobertura (plano recomendado de cada imóvel) -> {saida_cob}")
        print("Situação:", out.eleg_situacao.value_counts().to_dict())
        print("Pendências por regra:", {k: int((out[f"eleg_{k}"] == PEND).sum()) for k in REGRAS})
        n_dec = out.n_p1 + out.n_p2 - 1  # a declaração final (com as estimativas) conta como P1 em todos
        print(f"Perguntas por imóvel: {n_dec.mean():.2f} P1/P2 + 1 declaração + {out.n_p3.mean():.2f} P3")
        print(f"One Click Buy (uma tela só, estimativas na declaração): {(out.one_click_buy == 'SIM').mean():.0%}")
        freq = pd.Series([i.split(":")[1] for s in out.bussola_pendencias for i in s.split(" | ")]).value_counts()
        print("Frequência de cada pergunta (% dos imóveis):", (freq / len(out) * 100).round(0).astype(int).to_dict())
        print("Plano recomendado:", out.plano_recomendado.value_counts().to_dict())
    if a.exemplos:
        exemplos(casos)


def exemplos(casos: dict) -> None:
    """Casos contrastantes: mesmo motor, caminhos diferentes conforme dados e respostas."""
    E = estado_inicial

    def achar(cond):
        return next(c for c in casos.values() if cond(c, E(c)))

    def mostrar(titulo, caso, **kw):
        print(f"\n=== {titulo} [{caso['imovel_id']}]")
        for linha in simular(E(caso), **kw):
            print("   " + linha)

    c = achar(lambda c, e: not decisoes(e))
    mostrar("A1) One Click Buy: uma tela só, estimativas confirmadas na declaração", c, refino=False)
    lo = estado_inicial(c)["f"]["bens"]["faixa"][0]
    mostrar("A2) Mesmo caso: cliente clica em 'Editar' nos bens e põe uma faixa menor", c,
            editar={"bens": (lo * 0.5, lo * 0.7)}, refino=False)

    c = achar(lambda c, e: precisa_residencia(e))
    mostrar("B1) Dois endereços, cliente mora neste", c, respostas={"residencia_principal": 0})
    mostrar("B2) Mesmo cliente, mora no outro: a próxima pergunta muda", c,
            respostas={"residencia_principal": 1, "uso": 1})

    c = achar(lambda c, e: e["f"]["material"]["valor"] is None and e["f"]["obra"]["valor"] is not None
              and e["f"]["seguro_bb"]["valor"] is not None)
    mostrar("C1) Casa sem material cadastrado, responde alvenaria", c)
    mostrar("C2) Mesma casa, responde 'mista' e depois 'não' -> encaminha ao humano", c,
            respostas={"material": 1, "material_predominante": 1})
    mostrar("C3) Mesma casa, responde 'não sei' -> resultado preliminar com ressalva", c,
            respostas={"material": 4})

    c = achar(lambda c, e: e["f"]["uso"]["valor"] == "ALUGADO_TERCEIROS")
    mostrar("D) Dados sugerem imóvel alugado para terceiros: a resposta já resolve o vínculo", c)

    c = achar(lambda c, e: not e["one_click"] and any(p.id == "bens" and n == 2 for n, _, p in candidatas(e)))
    mostrar("E1) Fora do One Click Buy, bens têm página própria: cliente confirma a faixa estimada", c)
    mostrar("E2) Mesmo caso: cliente escolhe a menor faixa", c, respostas={"bens": 0})

    c = achar(lambda c, e: e["f"]["uso"]["valor"] == "HABITUAL" and e["f"]["uso"]["confianca"] == "media")
    mostrar("F) Cliente nega 'você mora neste imóvel' na declaração: a pergunta de uso reaparece", c,
            declarar={"uso": NAO_E_O_CASO}, refino=False)

    c = achar(lambda c, e: e["f"]["seguro_bb"]["valor"] is None and not c["outro_endereco"])
    mostrar("G) Endereço já tem seguro BB -> revisão da apólice", c, respostas={"seguro_bb": 1}, refino=False)

    c = achar(lambda c, e: not [x for x in candidatas(e) if x[0] <= 2])
    mostrar("H) Há outra atividade comercial -> Seguro Empresarial", c,
            declarar={"comercial": NAO_E_O_CASO}, refino=False)

    mostrar("I) Cliente diz que o imóvel fica em favela ou comunidade -> especialista", c,
            declarar={"comunidade": NAO_E_O_CASO}, refino=False)


if __name__ == "__main__":
    main()
