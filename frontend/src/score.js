// Porta em JS de score_planos.py: score de aderência dos planos (necessidade de cada cobertura opcional,
// utilidade marginal, necessidade crítica com peso e plano mínimo, aderência em %).
// Premissas vêm de score/premissas_score.json (score_config.json, gerado por exportar_casos_front.py).
import PREM from "./score_config.json" with { type: "json" };

export const PLANOS = ["ESSENCIAL", "PRATICO", "TOTAL"];
const NOME = { ESSENCIAL: "Essencial", PRATICO: "Prático", TOTAL: "Total" };
const OPCIONAIS = ["ROUBO_FURTO_ARROMBAMENTO", "QUEBRA_DE_VIDROS", "RESPONSABILIDADE_CIVIL_FAMILIAR",
  "PERDA_PAGAMENTO_ALUGUEL", "DESPESAS_EMERGENCIAIS"];
const NOME_COB = { ROUBO_FURTO_ARROMBAMENTO: "roubo e furto", QUEBRA_DE_VIDROS: "quebra de vidros",
  RESPONSABILIDADE_CIVIL_FAMILIAR: "responsabilidade civil familiar",
  PERDA_PAGAMENTO_ALUGUEL: "perda ou pagamento de aluguel", DESPESAS_EMERGENCIAIS: "despesas emergenciais" };
const brl = (x) => Math.round(x).toLocaleString("pt-BR");
// mesmo arredondamento do Python (round com meio para o par)
const meioParaPar = (v) => {
  const f = Math.floor(v);
  return Math.abs(v - f - 0.5) < 1e-9 ? (f % 2 === 0 ? f : f + 1) : Math.round(v);
};
const round1 = (x) => meioParaPar(x * 10) / 10;

// Necessidade (0 a 1) de cada cobertura opcional e o motivo em texto.
export function necessidades(ctx) {
  const pn = PREM.necessidade, n = {}, why = {};
  const v = ctx.vinculo, locador = v === "PROPRIO_ALUGADO_TERCEIROS";
  const vazio = ["DESOCUPADO", "TEMPORADA"].includes(ctx.uso);

  let p = pn.ROUBO_FURTO_ARROMBAMENTO;
  if (locador) [n.ROUBO_FURTO_ARROMBAMENTO, why.ROUBO_FURTO_ARROMBAMENTO] = [p.locador, "imóvel alugado a terceiros (os bens são do inquilino)"];
  else {
    let base = p.faixas_valor_bens_portateis.find(([lim]) => ctx.bens_portateis < lim)[1];
    let txt = `bens portáteis de cerca de R$ ${brl(ctx.bens_portateis)}`;
    if (vazio) { base += p.bonus_imovel_vazio; txt += "; o imóvel fica vazio parte do tempo"; }
    [n.ROUBO_FURTO_ARROMBAMENTO, why.ROUBO_FURTO_ARROMBAMENTO] = [Math.min(base, 1), txt];
  }

  p = pn.QUEBRA_DE_VIDROS;
  [n.QUEBRA_DE_VIDROS, why.QUEBRA_DE_VIDROS] = ctx.vidracaria > 0
    ? [p.com_gasto_vidracaria, `gasto recente com vidraçaria (R$ ${brl(ctx.vidracaria)})`]
    : [p.sem_evidencia, "sem indício de vidros de valor relevante"];

  p = pn.RESPONSABILIDADE_CIVIL_FAMILIAR;
  const dep = Math.min(ctx.dependentes, p.max_dependentes);
  const partes = [...(ctx.dependentes ? [`${ctx.dependentes} dependente(s)`] : []), ...(ctx.pet ? ["pet"] : [])];
  n.RESPONSABILIDADE_CIVIL_FAMILIAR = Math.min(p.base + dep * p.por_dependente + (ctx.pet ? p.pet : 0), 1);
  why.RESPONSABILIDADE_CIVIL_FAMILIAR = partes.length ? partes.join(" e ") : "sem dependentes nem pet";

  p = pn.PERDA_PAGAMENTO_ALUGUEL;
  [n.PERDA_PAGAMENTO_ALUGUEL, why.PERDA_PAGAMENTO_ALUGUEL] =
    ctx.uso === "DESOCUPADO" ? [p.DESOCUPADO, "imóvel desocupado: a cobertura não vale nesse caso"]
    : v === "INQUILINO" ? [p.INQUILINO, "paga aluguel: continuaria pagando se o imóvel ficar inabitável"]
    : locador ? [p.PROPRIO_ALUGADO_TERCEIROS, "recebe aluguel deste imóvel: deixaria de receber se ele ficar inabitável"]
    : v === "PROPRIO_FINANCIADO" ? [p.PROPRIO_FINANCIADO, "financiado: pagaria a parcela e uma moradia provisória ao mesmo tempo"]
    : [p.MORADOR, "imóvel próprio: precisaria de moradia provisória"];

  p = pn.DESPESAS_EMERGENCIAIS;
  let val = p.base; const txt = [];
  if (v === "PROPRIO_FINANCIADO") { val += p.financiado; txt.push("financiamento em curso"); }
  if (ctx.incendio_sugerido >= p.limiar_valor_em_risco) {
    val += p.bonus_valor_em_risco; txt.push(`valor em risco alto (cerca de R$ ${brl(ctx.incendio_sugerido)})`);
  }
  [n.DESPESAS_EMERGENCIAIS, why.DESPESAS_EMERGENCIAIS] = [Math.min(val, 1), txt.join("; ") || "sem fator adicional"];
  return [n, why];
}

// Quanto incluir a cobertura vale: necessidade - limiar; necessidade crítica pesa mais.
const efeito = (n, c) => {
  const d = n[c] - PREM.limiar_necessidade;
  return n[c] >= PREM.necessidade_critica_piso ? d * PREM.peso_necessidade_critica : d;
};

export const scoresPlanos = (n) => Object.fromEntries(PLANOS.map((pl) =>
  [pl, round1(PREM.base + PREM.pontos_por_necessidade * PREM.planos[pl].reduce((s, c) => s + efeito(n, c), 0))]));

// % das necessidades atendidas sem incluir o que não precisa (cada opcional pesa |efeito|).
export function aderencia(n) {
  const ef = Object.fromEntries(OPCIONAIS.map((c) => [c, efeito(n, c)]));
  const total = OPCIONAIS.reduce((s, c) => s + Math.abs(ef[c]), 0);
  if (total === 0) return Object.fromEntries(PLANOS.map((pl) => [pl, 100]));
  return Object.fromEntries(PLANOS.map((pl) => [pl, meioParaPar(100 * OPCIONAIS.reduce((s, c) =>
    s + (PREM.planos[pl].includes(c) ? Math.max(ef[c], 0) : Math.max(-ef[c], 0)), 0) / total)]));
}

// Plano mínimo exigido por necessidade crítica: só o plano que tem a cobertura atende.
export function planoMinimo(n) {
  const criticas = OPCIONAIS.filter((c) => n[c] >= PREM.necessidade_critica_piso);
  let minimo = "ESSENCIAL";
  for (const c of criticas) {
    const menor = PLANOS.find((pl) => PREM.planos[pl].includes(c));
    if (PLANOS.indexOf(menor) > PLANOS.indexOf(minimo)) minimo = menor;
  }
  return [minimo, criticas];
}

export function avaliar(ctx) {
  const [n, why] = necessidades(ctx);
  const sc = scoresPlanos(n), ad = aderencia(n);
  const [minimo, criticas] = planoMinimo(n);
  const permitidos = PLANOS.slice(PLANOS.indexOf(minimo));
  const melhor = Math.max(...permitidos.map((p) => sc[p]));
  const plano = permitidos.find((p) => sc[p] >= melhor - PREM.empate_pontos); // empate: o mais simples
  const alternativa = PLANOS.filter((p) => p !== plano).reduce((a, b) => (sc[b] > sc[a] ? b : a));

  const just = [`O ${NOME[plano]} tem ${ad[plano]}% de aderência ao seu perfil (` +
    PLANOS.filter((p) => p !== plano).map((p) => `${NOME[p]} ${ad[p]}%`).join(", ") + ").",];
  if (minimo !== "ESSENCIAL" && plano === minimo && sc[plano] < Math.max(...Object.values(sc)) - PREM.empate_pontos)
    just.push(`Só a partir do ${NOME[minimo]} existe ` + criticas.filter((c) => PREM.planos[minimo].includes(c))
      .map((c) => NOME_COB[c]).join(", ") + ", e essa proteção é muito importante para você.");
  const empate = PLANOS.indexOf(alternativa) > PLANOS.indexOf(plano) && sc[alternativa] >= sc[plano];
  if (empate) just.push(`O ${NOME[alternativa]} ficou praticamente empatado; nesse caso recomendamos o mais simples.`);
  const atendidas = PREM.planos[plano].filter((c) => n[c] >= PREM.limiar_necessidade);
  if (atendidas.length) just.push("Atende o que você mais precisa: " + atendidas.map((c) => `${NOME_COB[c]} (${why[c]})`).join("; ") + ".");
  if (PLANOS.indexOf(alternativa) > PLANOS.indexOf(plano) && !empate) {
    const extra = PREM.planos[alternativa].filter((c) => !PREM.planos[plano].includes(c));
    just.push(`O ${NOME[alternativa]} acrescentaria ${extra.map((c) => NOME_COB[c]).join(", ")}, que pesam pouco no seu caso.`);
  } else if (PLANOS.indexOf(alternativa) < PLANOS.indexOf(plano)) {
    const perde = PREM.planos[plano].filter((c) => !PREM.planos[alternativa].includes(c));
    just.push(`O ${NOME[alternativa]} é mais simples, mas ficaria sem ${perde.map((c) => NOME_COB[c]).join(", ")}.`);
  }
  return { plano, alternativa, scores: sc, aderencia: ad, plano_minimo: minimo, necessidades_criticas: criticas,
    necessidades: n, motivos: why, justificativas: just };
}
