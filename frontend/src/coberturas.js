// Porta em JS de coberturas/motor_coberturas/coberturas.py (calcular_imovel): faixa de valor de cada
// cobertura, recalculada no front quando o cliente confirma ou edita área e bens.
// Premissas e CUB/m² vêm do pacote (coberturas_config.json, gerado por exportar_casos_front.py).
import CFG from "./coberturas_config.json" with { type: "json" };

const CATEGORIAS = ["movel", "eletrodomestico", "eletronico", "item_lazer"];

// mesmo arredondamento do Python (round com meio para o par): centenas abaixo de R$ 10 mil, milhares acima
const meioParaPar = (v) => {
  const f = Math.floor(v);
  return Math.abs(v - f - 0.5) < 1e-9 ? (f % 2 === 0 ? f : f + 1) : Math.round(v);
};
export const arred = (x) => (Number.isNaN(x) ? 0 : x < 10_000 ? meioParaPar(x / 100) * 100 : meioParaPar(x / 1000) * 1000);

// incertezas independentes combinadas em quadratura no log (não multiplica todos os extremos)
function faixaCombinada(central, fatores) {
  const lo = Math.sqrt(fatores.reduce((s, [a]) => s + Math.log(a) ** 2, 0));
  const hi = Math.sqrt(fatores.reduce((s, [, b]) => s + Math.log(b) ** 2, 0));
  return [central * Math.exp(-lo), central * Math.exp(hi)];
}

// ins: mesmos campos de insumos_coberturas() do motor Python
export function calcularCoberturas(ins) {
  const pc = CFG.coberturas, sel = CFG.seletor;
  const { tipo, vinculo: vinc } = ins;
  const padrao = pc.fator_padrao[ins.padrao] ? ins.padrao : "NAO_DISPONIVEL";
  const [fLo, fHi] = pc.fator_padrao[padrao];
  const cubOrigem = ins.uf in CFG.cub ? "TABELA_UF" : "PADRAO_NACIONAL";
  const cub = CFG.cub[ins.uf] ?? CFG.cub_nacional;
  const [aLo, aMid, aHi] = [ins.area_min, ins.area, ins.area_max];
  const locador = vinc === "PROPRIO_ALUGADO_TERCEIROS", inquilino = vinc === "INQUILINO";

  // estrutura
  const fMid = Math.sqrt(fLo * fHi);
  const inc = [[aLo / aMid, aHi / aMid], [fLo / fMid, fHi / fMid]];
  let estLo, estHi;
  if (tipo === "APARTAMENTO") {
    const [b0, b1] = pc.apto_benfeitorias, bMid = Math.sqrt(b0 * b1);
    [estLo, estHi] = faixaCombinada(aMid * cub * fMid * bMid, [...inc, [b0 / bMid, b1 / bMid]]);
  } else [estLo, estHi] = faixaCombinada(aMid * cub * fMid, inc);

  // conteúdo (bens efetivos por categoria)
  const { bens_min: bmin, bens_max: bmax } = ins;
  const bensConf = ins.bens_origem === "CONFIRMADO";
  const [conLo, conHi] = locador ? [0, 0] : [CATEGORIAS.reduce((s, c) => s + bmin[c], 0), CATEGORIAS.reduce((s, c) => s + bmax[c], 0)];
  const incLo = estLo + conLo, incHi = estHi + conHi, incC = Math.sqrt(incLo * incHi);
  const confInc = ins.area_confianca === "ALTA" && padrao !== "NAO_DISPONIVEL" && cubOrigem === "TABELA_UF" ? "ALTA"
    : ins.area_confianca === "BAIXA" ? "BAIXA" : "MEDIA";
  const linhas = [];

  const add = (cobertura, lo, hi, conf, justificativa, observacao = "") => {
    if (hi < lo) [lo, hi] = [hi, lo];
    if (arred(hi) === arred(lo) && conf !== "ALTA") { hi = lo * 1.5; observacao = `${observacao} Piso aplicado.`.trim(); }
    const sug = Math.sqrt(lo * hi);
    const [mLo, mHi] = sel.margem_por_confianca[conf];
    if (cobertura === "INCENDIO_RAIO_EXPLOSAO_FUMACA")
      observacao = `${observacao} Valores abaixo da sugestão aumentam o risco de rateio: a indenização cai na proporção em que o valor segurado fica abaixo do valor em risco.`.trim();
    linhas.push({
      cobertura, valor_sugerido: arred(sug), faixa_valor_min: arred(sug * (1 - mLo)), faixa_valor_max: arred(sug * (1 + mHi)),
      passo_seletor: sug < sel.passo.limite ? sel.passo.abaixo : sel.passo.acima, confianca_estimativa: conf,
      estimativa_min: arred(lo), estimativa_max: arred(hi), justificativa, observacao, plano_minimo: CFG.catalogo[cobertura],
    });
  };

  add("INCENDIO_RAIO_EXPLOSAO_FUMACA", incLo, incHi, confInc,
    "Cobertura básica: deve repor a reconstrução e o conteúdo; valor abaixo disso gera rateio na indenização.",
    (inquilino ? "Imóvel alugado: beneficiário do imóvel é o locador e do conteúdo é o locatário. " : "") +
    (vinc === "PROPRIO_FINANCIADO" ? "Financiado: o seguro habitacional (DFI) já cobre danos físicos ao imóvel; confirmar para evitar sobreposição." : ""));
  add("QUEDA_AERONAVE", incLo, incHi, confInc,
    "Evento raro, mas de destruição total: a referência é o mesmo valor em risco da cobertura básica.");

  for (const [cob, just] of [
    ["DANOS_POR_AGUA", "Vazamentos e rompimentos danificam acabamentos e bens, raramente o imóvel inteiro."],
    ["VENDAVAL_GRANIZO", "Casas expõem telhado e esquadrias; em apartamento o dano se concentra em janelas e varanda."],
    ["IMPACTO_VEICULOS_TERRESTRES", "Dano típico em muro, portão e fachada; menor exposição em apartamento."],
  ]) {
    const p = pc.percentual_incendio[cob], [loP, hiP] = p[tipo];
    add(cob, Math.max(incC * loP, p.piso), Math.max(incC * hiP, p.piso), "BAIXA", just,
      "Percentual sem base própria nos dados; validar com os limites do produto." +
      (cob === "VENDAVAL_GRANIZO" ? " Enriquecimento possível: histórico de desastres por município (S2iD)." : ""));
  }

  const piso = pc.piso_bens;
  const elLo = Math.max(bmin.eletrodomestico + bmin.eletronico, piso);
  const elHi = Math.max(bmax.eletrodomestico + bmax.eletronico, elLo);
  add("DANOS_ELETRICOS", elLo, Math.min(elHi, incHi), bensConf ? "ALTA" : "MEDIA",
    "Danos elétricos atingem equipamentos ligados à rede: a faixa segue o valor desses bens.");

  const [pr0, pr1] = pc.pequenos_reparos;
  add("INSTALACOES_PEQUENOS_REPAROS", pr0, pr1, "BAIXA", "Cobertura listada como fixa no guia final; reparos de pequeno valor.",
    "Ausente do catalogo_coberturas_fixas_planos.csv; confirmar nomenclatura e limite com a organização.");

  const pesos = pc.roubo_peso_categoria;
  let rbLo, rbHi, rbConf;
  if (locador) [rbLo, rbHi, rbConf] = [piso, piso * 2, "BAIXA"];
  else {
    rbLo = Math.max(CATEGORIAS.reduce((s, c) => s + bmin[c] * (pesos[c] ?? 0), 0), piso);
    rbHi = Math.max(CATEGORIAS.reduce((s, c) => s + bmax[c] * (pesos[c] ?? 0), 0), rbLo);
    rbConf = bensConf ? "ALTA" : "MEDIA";
  }
  add("ROUBO_FURTO_ARROMBAMENTO", rbLo, rbHi, rbConf,
    "Roubo atinge principalmente bens portáteis e de valor; móveis raramente são levados.");

  let [vLo, vHi] = pc.vidros_base[tipo];
  const vid = ins.gasto_vidracaria_24m, fg = pc.vidros_fator_gasto;
  if (vid > 0) [vLo, vHi] = [Math.max(vLo, fg[0] * vid), Math.max(vHi, fg[1] * vid)];
  add("QUEBRA_DE_VIDROS", vLo, vHi, vid > 0 ? "MEDIA" : "BAIXA",
    "Vidros, espelhos e box; gasto recente com vidraçaria indica valor relevante instalado.");

  const rc = pc.rc_familiar, dep = ins.dependentes, pet = ins.pet ? 1 : 0;
  add("RESPONSABILIDADE_CIVIL_FAMILIAR",
    Math.min(rc.base[0] + dep * rc.por_dependente[0] + pet * rc.pet[0], rc.teto),
    Math.min(rc.base[1] + dep * rc.por_dependente[1] + pet * rc.pet[1], rc.teto), "BAIXA",
    "Cobre danos causados a terceiros pela família; dependentes e pet aumentam a exposição (necessidade, não risco do cliente).");

  const meses = pc.aluguel_meses;
  let ref, m, cAl;
  if (inquilino && ins.aluguel_pago > 0) [ref, m, cAl] = [ins.aluguel_pago, meses.INQUILINO, "ALTA"];
  else if (locador && ins.aluguel_recebido > 0) [ref, m, cAl] = [ins.aluguel_recebido, meses.PROPRIO_ALUGADO_TERCEIROS, "ALTA"];
  else {
    m = inquilino ? meses.INQUILINO : locador ? meses.PROPRIO_ALUGADO_TERCEIROS : meses.MORADOR_PROPRIETARIO;
    ref = ins.area * pc.aluguel_m2_referencia; // aluguel equivalente estimado
    cAl = "BAIXA";
  }
  add("PERDA_PAGAMENTO_ALUGUEL", ref * m[0], ref * m[1], cAl,
    { INQUILINO: "Paga o aluguel enquanto o imóvel fica inabitável após sinistro.",
      PROPRIO_ALUGADO_TERCEIROS: "Repõe o aluguel que o proprietário deixa de receber após sinistro." }[vinc]
      ?? "Paga moradia provisória enquanto o imóvel próprio é reparado.");

  const p = pc.percentual_incendio.DESPESAS_EMERGENCIAIS;
  const deHi = Math.min(Math.max(incC * p[tipo][1], p.piso), p.teto);
  const deLo = Math.min(Math.max(incC * p[tipo][0], p.piso), deHi === p.teto ? deHi / 2 : deHi);
  add("DESPESAS_EMERGENCIAIS", deLo, deHi, "BAIXA", "Despesas imediatas após sinistro (contenção, guarda de bens, mudança).",
    "Percentual sem base própria nos dados; validar com os limites do produto.");
  return linhas;
}
