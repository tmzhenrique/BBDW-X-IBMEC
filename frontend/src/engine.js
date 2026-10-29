// Porta em JS do motor_perguntas.py (mesmas regras, mesmos nomes).
// Segue o documento "Regras de Elegibilidade Definitivas" do time (28/10/2026).
// Serve para o protótipo rodar sem backend. Quando a rota FastAPI
// /proxima-pergunta existir, trocar as chamadas daqui por fetch.

import { calcularCoberturas } from "./coberturas.js";
import { avaliar as avaliarScore } from "./score.js";

export const LIMIAR_OBRA_PERGUNTA = 5_000; // TIME, VALIDAR
const GANHO_MINIMO_REFINO = 0.1;
export const MAX_REFINO = 2;
const CUSTO_M2_ILUSTRATIVO = { ECONOMICO: 2000, NORMAL: 2800, SUPERIOR: 3800 };
const CAMPOS_COTACAO = new Set(["uso", "vinculo"]);

// Pontos a VALIDAR com a BB (documento definitivo, seção 5)
const VINCULO_CEDIDO_SITUACAO = "PENDENTE_VERIFICACAO"; // "cedido" não está na lista do guia; nem libera nem bloqueia

// E7 - comunidade carente / favela: item da declaração final, igual para todos os clientes.
// Nenhum dado nem métrica é usado para inferir (nem para escolher a quem perguntar).
// Em produção, a BB verifica pelo endereço real contra a malha de Favelas e Comunidades Urbanas do IBGE.

export const SEM = "SEM_RESTRICAO_IDENTIFICADA", PEND = "PENDENTE_VERIFICACAO", REST = "RESTRICAO_CONFIRMADA";
const GRAVIDADE = { [SEM]: 0, [PEND]: 1, [REST]: 2 };
export const NAO_SEI = "NAO_SEI";
export const CONFIRMO = "CONFIRMO", NAO_E_O_CASO = "NAO_E_O_CASO";
const REGRAS = ["e1_material", "e2_obra", "e3_seguro", "e4_rural", "e5_situacao", "e6_comercial", "e7_territorial",
  "enq_vinculo"];
const REGRAS_E = new Set(REGRAS.slice(0, 7)); // E1 a E7: definem eleg_situacao
export const DESTINO_REVISAO = "revisão da apólice";
const DUVIDA_DECLARACAO = {
  rural: "se o imóvel tem ligação com atividade rural",
  tombado: "se o imóvel é tombado, desapropriado ou condenado",
  comercial: "se há atividade comercial além de MEI aceito",
  comunidade: "se o imóvel fica em comunidade carente ou favela",
};

export const brl = (x) => "R$ " + Math.round(x).toLocaleString("pt-BR");

const C = (valor, origem, confianca, nota = "", extra = {}) => ({ valor, origem, confianca, nota, ...extra });

// --------------------------------------------------------------------------
// Estado inicial: só dados, nenhuma pergunta
// --------------------------------------------------------------------------
export function estadoInicial(caso) {
  const apto = caso.possui_termo_apartamento === "SIM";
  const principal = caso.principal;
  const paga = caso.pagamento_aluguel_recorrente === "SIM";
  const recebe = caso.credito_recorrente_compativel_aluguel === "SIM";
  const financia = caso.parcela_financiamento_imobiliario > 0;
  const f = {};

  const casaCond = !apto && caso.possui_termo_condominio === "SIM";
  f.tipo = C(apto ? "APARTAMENTO" : casaCond ? "CASA_CONDOMINIO" : "CASA", "DERIVADO", "alta", "complemento e termos do endereço");

  const mat = caso.material_parede_externa_cadastrado;
  if (mat !== "NAO_DISPONIVEL") f.material = C(mat, "OBSERVADO", "alta", "cadastro");
  else if (apto) f.material = C("ALVENARIA", "DERIVADO", "media", "apartamento: presumido alvenaria (VALIDAR)");
  else f.material = C(null, "AUSENTE", "nenhuma", "material não cadastrado");

  // Ausência de gasto não comprova ausência de obra: por isso a declaração final também cobre obra.
  const g = caso.gastos_material_construcao_24m;
  if (g > LIMIAR_OBRA_PERGUNTA) f.obra = C(null, "AUSENTE", "nenhuma", `${brl(g)} em material de construção em 24 meses`);
  else f.obra = C("NAO", "DERIVADO", "media", g === 0 ? "sem compra de material de construção" : `compras pequenas (${brl(g)})`);

  if (principal && caso.outros_principais === 0) f.uso = C("HABITUAL", "DERIVADO", "media", "endereço compatível com o principal");
  else if (principal) f.uso = C(null, "AUSENTE", "nenhuma", "mais de um endereço compatível com o principal");
  else if (recebe)
    f.uso = C("ALUGADO_TERCEIROS", "DERIVADO", "baixa",
      `crédito recorrente compatível com aluguel (~${brl(caso.valor_medio_credito_recorrente)}/mês)`);
  else f.uso = C(null, "AUSENTE", "nenhuma", "endereço diferente do principal");

  // Pagamentos sugerem, mas não comprovam. Ausência de aluguel ou financiamento não prova imóvel quitado.
  if (financia)
    f.vinculo = C("PROPRIETARIO_FINANCIADO", "DERIVADO", "alta",
      `parcela de financiamento de ${brl(caso.parcela_financiamento_imobiliario)}`);
  else if (paga && principal) f.vinculo = C("INQUILINO", "DERIVADO", "media", "aluguel recorrente e endereço principal");
  else if (paga) f.vinculo = C("INQUILINO", "DERIVADO", "baixa", "paga aluguel, mas este não é o endereço principal");
  else if (recebe && !principal) f.vinculo = C("LOCADOR", "DERIVADO", "baixa", "recebe crédito compatível com aluguel");
  else f.vinculo = C(null, "AUSENTE", "nenhuma", "sem sinal de aluguel nem de financiamento");

  if (caso.area_cadastrada_m2 > 0) {
    const a = caso.area_cadastrada_m2;
    f.area = C(a, "OBSERVADO", "alta", caso.origem_area, { faixa: [a, a] });
  } else {
    // estimativa do pacote estimativas/ (modelo de ML), exportada junto com o caso
    const [lo, mid, hi] = [caso.area_est_min_m2, caso.area_est_m2, caso.area_est_max_m2];
    const fora = caso.area_fora_dominio ? `; sinais fora da faixa de treino (${caso.area_fora_dominio})` : "";
    f.area = C(mid, "ESTIMADO", String(caso.area_est_confianca).toLowerCase(),
      "modelo de ML (IPTU, energia, água, condomínio, tipo e cidade); faixa P10-P90" + fora, { faixa: [lo, hi] });
  }

  const pad = caso.padrao_construtivo_cadastrado;
  f.padrao = pad !== "NAO_DISPONIVEL" ? C(pad, "OBSERVADO", "alta", "cadastro") : C(null, "AUSENTE", "nenhuma", "padrão não cadastrado; não é perguntado ao cliente (decisão do time)");

  if (caso.bens_est_max > 0)
    f.bens = C(caso.bens_est, "ESTIMADO", "media",
      "bens cadastrados ponderados + compras de 36 meses, por categoria (renda não usada)",
      { faixa: [caso.bens_est_min, caso.bens_est_max] });
  else f.bens = C(0, "DERIVADO", "media", "sem bens cadastrados nem compras recentes", { faixa: [0, 0] });

  // O indicador é do cliente: não comprova seguradora, endereço nem apólice vigente.
  f.seguro_bb = caso.possui_seguro_residencial === "SIM"
    ? C(null, "AUSENTE", "nenhuma", "cliente tem seguro residencial BB em algum endereço")
    : C("NAO", "DERIVADO", "alta", "cliente sem seguro residencial BB");

  const e = { caso, f, respondidas: [], declaracao: null, refinos: 0, revisao: 0 };
  // One Click Buy: nenhuma pergunta de decisão desde o início (fora as estimativas de área e bens).
  // Decidido aqui e guardado: depois das respostas, todo caso ficaria sem perguntas.
  e.one_click = !candidatas(e).some((c) => c.nivel <= 2 && !ESTIMATIVAS.includes(c.p.id));
  return e;
}

// --------------------------------------------------------------------------
// Regras de restrição E1 a E7 (guia final 9.1; gatilhos e ações = proposta do time)
// --------------------------------------------------------------------------
// [situação, motivo, destino] de cada regra. O destino só existe quando a restrição é confirmada.
export function regras(e) {
  const f = e.f, d = e.declaracao ?? {};
  const r = Object.fromEntries(REGRAS.map((k) => [k, [SEM, "", ""]]));

  const mat = f.material.valor;
  if (["MADEIRA", "MADEIRA_PREFABRICADA", "COMBUSTIVEL_PREDOMINANTE"].includes(mat))
    r.e1_material = [REST, "material combustível declarado: verificar material e exceção de madeira pré-fabricada ABNT/IBAMA", "especialista"];
  else if ([null, "MISTA", NAO_SEI].includes(mat)) r.e1_material = [PEND, "material das paredes externas a confirmar", ""];

  const obra = f.obra.valor;
  if (obra === "EM_ANDAMENTO")
    r.e2_obra = [REST, "imóvel em construção, reforma ou reconstrução: verificar fase e previsão de término", "especialista"];
  else if ([null, NAO_SEI].includes(obra)) r.e2_obra = [PEND, "situação de obra a confirmar", ""];

  const seguro = f.seguro_bb.valor;
  if (seguro === "SIM") r.e3_seguro = [REST, "endereço já tem seguro residencial BB: vedada nova proposta", DESTINO_REVISAO];
  else if ([null, NAO_SEI].includes(seguro)) r.e3_seguro = [PEND, "seguro BB do endereço a confirmar", ""];

  for (const [regra, item, motivo, destino] of [
    ["e4_rural", "rural", "imóvel ligado a atividade rural: avaliar exceção da casa-sede ou seguro rural", "especialista ou seguro rural"],
    ["e5_situacao", "tombado", "imóvel tombado, desapropriado ou condenado", "especialista"],
    ["e6_comercial", "comercial", "atividade comercial além de MEI aceito", "Seguro Empresarial"],
    ["e7_territorial", "comunidade", "imóvel em comunidade carente ou favela", "especialista"],
  ]) {
    if (d[item] === NAO_E_O_CASO) r[regra] = [REST, motivo, destino];
    else if (d[item] === NAO_SEI) r[regra] = [PEND, `${DUVIDA_DECLARACAO[item]}: cliente não soube responder`, ""];
  }

  if (f.vinculo.valor === "CEDIDO")
    r.enq_vinculo = [VINCULO_CEDIDO_SITUACAO, "vínculo cedido: validar aceitação com a BB",
      VINCULO_CEDIDO_SITUACAO === REST ? "especialista" : ""];
  return r;
}

// Situação do caso = pior resultado entre as regras E1 a E7, com os motivos desse nível.
// O enquadramento (enq_vinculo) não entra aqui: ele só afeta a ação da Bússola.
export function elegibilidade(e) {
  const r = Object.entries(regras(e)).filter(([k]) => REGRAS_E.has(k)).map(([, v]) => v);
  const pior = r.reduce((p, [s]) => (GRAVIDADE[s] > GRAVIDADE[p] ? s : p), SEM);
  return [pior, r.filter(([s]) => s === pior && s !== SEM).map(([, m]) => m).join("; ")];
}

// --------------------------------------------------------------------------
// Coberturas: faixa de valor de cada uma, com o estado atual do cliente (mesmo cálculo do pacote coberturas/)
// --------------------------------------------------------------------------
const CATEGORIAS_BENS = ["movel", "eletrodomestico", "eletronico", "item_lazer"];
// vínculo do motor -> vínculo do pacote de coberturas (sob gestão, cedido ou desconhecido: como morador proprietário)
const VINCULO_COBERTURA = { PROPRIETARIO_QUITADO: "PROPRIO_QUITADO", PROPRIETARIO_FINANCIADO: "PROPRIO_FINANCIADO",
  INQUILINO: "INQUILINO", LOCADOR: "PROPRIO_ALUGADO_TERCEIROS" };
const PLANOS_ORDEM = ["ESSENCIAL", "PRATICO", "TOTAL"];

// [mín, máx] por categoria. Estimados: os do pacote de estimativas. Faixa informada pelo cliente (total):
// distribuída entre as categorias na proporção da estimativa.
function bensPorCategoria(e) {
  const { caso } = e, f = e.f.bens;
  const por = (k) => Object.fromEntries(CATEGORIAS_BENS.map((c) => [c, caso[`bens_${c}_${k}`]]));
  if (f.origem !== "DECLARADO") return [por("min"), por("max")];
  const sug = por("sugerido"), total = CATEGORIAS_BENS.reduce((t, c) => t + sug[c], 0);
  const peso = (c) => (total ? sug[c] / total : 1 / CATEGORIAS_BENS.length);
  const [lo, hi] = f.faixa;
  return [Object.fromEntries(CATEGORIAS_BENS.map((c) => [c, lo * peso(c)])), Object.fromEntries(CATEGORIAS_BENS.map((c) => [c, hi * peso(c)]))];
}

// Valores efetivos do cliente (dados, estimativas e respostas) no formato da calculadora de coberturas.
export function insumosCoberturas(e) {
  const { f, caso } = e, area = f.area;
  const [bmin, bmax] = bensPorCategoria(e);
  return {
    uf: caso.uf, tipo: f.tipo.valor === "APARTAMENTO" ? "APARTAMENTO" : "CASA",
    area: area.valor, area_min: area.faixa[0], area_max: area.faixa[1],
    area_confianca: area.confianca.toUpperCase(),
    padrao: f.padrao.valor ?? "NAO_DISPONIVEL", // só do cadastro: o padrão não é perguntado
    vinculo: f.uso.valor === "ALUGADO_TERCEIROS" ? "PROPRIO_ALUGADO_TERCEIROS" : VINCULO_COBERTURA[f.vinculo.valor] ?? "PROPRIO_QUITADO",
    bens_min: bmin, bens_max: bmax, bens_origem: f.bens.origem === "DECLARADO" ? "CONFIRMADO" : "ESTIMADO",
    aluguel_pago: caso.valor_aluguel_recorrente, aluguel_recebido: caso.valor_medio_credito_recorrente,
    dependentes: caso.quantidade_dependentes, pet: caso.possui_pet_informado === "SIM",
    gasto_vidracaria_24m: caso.gastos_vidracaria_24m,
  };
}

// Faixa de valor de cada cobertura (sugerido, mínimo e máximo do seletor). Com `plano`, só as do plano.
export function coberturas(e, plano = null) {
  const linhas = calcularCoberturas(insumosCoberturas(e));
  return plano ? linhas.filter((l) => PLANOS_ORDEM.indexOf(l.plano_minimo) <= PLANOS_ORDEM.indexOf(plano)) : linhas;
}

// --------------------------------------------------------------------------
// Plano: score de aderência (score.js, mesmo cálculo de score_planos.py)
// --------------------------------------------------------------------------
// Evidências do perfil para o score: vínculo e uso efetivos, dependentes, pet, vidraçaria e os valores
// sugeridos de roubo (bens portáteis) e incêndio (valor em risco). Renda e idade não entram.
export function contextoScore(e) {
  const cob = Object.fromEntries(coberturas(e).map((c) => [c.cobertura, c.valor_sugerido]));
  const { caso } = e;
  return { vinculo: insumosCoberturas(e).vinculo, uso: e.f.uso.valor, dependentes: caso.quantidade_dependentes,
    pet: caso.possui_pet_informado === "SIM", vidracaria: caso.gastos_vidracaria_24m,
    bens_portateis: cob.ROUBO_FURTO_ARROMBAMENTO, incendio_sugerido: cob.INCENDIO_RAIO_EXPLOSAO_FUMACA };
}
export const avaliacaoPlano = (e) => avaliarScore(contextoScore(e));
export const planoRecomendado = (e) => avaliacaoPlano(e).plano;

export function faixaReferencia(e) {
  const f = e.f;
  const [aLo, aHi] = f.area.faixa;
  const p = f.padrao.valor;
  const custos = Object.values(CUSTO_M2_ILUSTRATIVO);
  const [cLo, cHi] = p ? [CUSTO_M2_ILUSTRATIVO[p], CUSTO_M2_ILUSTRATIVO[p]] : [Math.min(...custos), Math.max(...custos)];
  const [bLo, bHi] = f.bens.faixa;
  return [aLo * cLo + bLo, aHi * cHi + bHi];
}

// --------------------------------------------------------------------------
// Banco de perguntas
// --------------------------------------------------------------------------
const setar = (campo, valor, nota = "resposta do cliente", extra = {}) => (e) => {
  e.f[campo] = C(valor, "DECLARADO", "alta", nota, extra);
};
// "Não sei" em campo com estimativa: mantém o valor e a origem, só registra a resposta (B8).
const manter = (campo) => (e) => {
  e.f[campo] = { ...e.f[campo], nota: e.f[campo].nota + "; cliente não soube confirmar" };
};
const varios = (...efs) => (e) => efs.forEach((x) => x(e));
const NAO_SEI_OPCAO = "Não sei";

function precisaResidencia(e) {
  const c = e.caso;
  return c.principal && c.outros_principais > 0 && e.f.uso.valor === null && !e.respondidas.includes("residencia_principal");
}

const arred = (x) => (x < 10_000 ? Math.round(x / 100) * 100 : Math.round(x / 1000) * 1000);

// Cinco faixas em volta da estimativa; a do meio contém o valor estimado.
// Quando o mínimo é zero, a faixa "menos de" some.
function faixas(lo, mid, hi) {
  const a = (lo + mid) / 2, b = (mid + hi) / 2;
  const fx = [[lo * 0.7, lo], [lo, a], [a, b], [b, hi], [hi, hi * 1.3]];
  return lo <= 0 ? fx.slice(1) : fx;
}

// Confirmação por faixa (DECLARADO com a faixa escolhida) + "Não sei" (mantém a estimativa).
const opcoesFaixa = (campo, fmt) => (e) => {
  const f = e.f[campo];
  const fx = faixas(f.faixa[0], f.valor, f.faixa[1]);
  const rot = [...(fx.length === 5 ? [`Menos de ${fmt(fx[0][1])}`] : []),
    ...fx.slice(fx.length - 4, -1).map(([x, y]) => `Entre ${fmt(x)} e ${fmt(y)}`), `Mais de ${fmt(fx.at(-1)[0])}`];
  return [...rot.map((r, i) => ({ rotulo: r, efeito: setar(campo, (fx[i][0] + fx[i][1]) / 2, undefined, { faixa: fx[i] }) })),
    { rotulo: NAO_SEI_OPCAO, efeito: manter(campo) }];
};
// Índice da faixa que contém a estimativa (pré-marcada).
const faixaEstimada = (e, campo) => (e.f[campo].faixa[0] > 0 ? 2 : 1);

const opcoesArea = opcoesFaixa("area", (x) => `${Math.round(x)} m²`);
const opcoesBens = opcoesFaixa("bens", (x) => brl(arred(x)));

function textoVinculo(e) {
  const c = e.caso;
  if (c.pagamento_aluguel_recorrente === "SIM")
    return `Identificamos um pagamento recorrente de aluguel de ~${brl(c.valor_aluguel_recorrente)}/mês. Qual é a sua relação com este imóvel?`;
  return "Qual é a sua relação com este imóvel?";
}

function textoSeguro(e) {
  const c = e.caso;
  if (c.outro_endereco) // B1: com dois imóveis, esclarecer só a associação necessária
    return "Você tem seguro residencial da BB Seguros. Qual dos seus imóveis já tem seguro?";
  return `Você tem seguro residencial da BB Seguros. Este endereço (${c.endereco_txt}) já tem seguro?`;
}

function opcoesSeguro(e) {
  const c = e.caso;
  if (c.outro_endereco)
    return [
      { rotulo: `O outro: ${c.outro_endereco}`, efeito: setar("seguro_bb", "NAO") },
      { rotulo: `Este: ${c.endereco_txt}`, efeito: setar("seguro_bb", "SIM") },
      { rotulo: "Os dois", efeito: setar("seguro_bb", "SIM") },
      { rotulo: NAO_SEI_OPCAO, efeito: setar("seguro_bb", NAO_SEI) },
    ];
  return [
    { rotulo: "Não", efeito: setar("seguro_bb", "NAO") },
    { rotulo: "Sim", efeito: setar("seguro_bb", "SIM") },
    { rotulo: NAO_SEI_OPCAO, efeito: setar("seguro_bb", NAO_SEI) },
  ];
}

// Posição da opção com esse rótulo (as listas mudam conforme as respostas anteriores).
const indice = (opcoes, rotulo) => { const i = opcoes.findIndex((o) => o.rotulo === rotulo); return i < 0 ? null : i; };

const USO_ALUGADO = "Está alugado para outra pessoa";

// Sem "Moro nele" quando o cliente acabou de dizer que mora em outro endereço.
function opcoesUso(e) {
  const moraFora = e.respondidas.includes("residencia_principal");
  return [
    ...(moraFora ? [] : [{ rotulo: "Moro nele", efeito: setar("uso", "HABITUAL") }]),
    { rotulo: "Casa de temporada / lazer", efeito: setar("uso", "TEMPORADA") },
    { rotulo: USO_ALUGADO, efeito: varios(setar("uso", "ALUGADO_TERCEIROS"), setar("vinculo", "LOCADOR")) },
    { rotulo: "Está desocupado", efeito: setar("uso", "DESOCUPADO") },
    { rotulo: NAO_SEI_OPCAO, efeito: manter("uso") },
  ];
}

// "Eu alugo este imóvel" foi trocado: servia tanto para quem paga quanto para quem recebe o aluguel.
const ROTULOS_VINCULO = {
  PROPRIETARIO_QUITADO: "É meu e já está quitado",
  PROPRIETARIO_FINANCIADO: "É meu e está financiado em outra instituição",
  INQUILINO: "Moro de aluguel (sou inquilino)",
  LOCADOR: "É meu e está alugado para outra pessoa",
  SOB_GESTAO: "Administro o imóvel (sob gestão)",
  CEDIDO: "É cedido / emprestado",
};
// "Alugado para outra pessoa" não aparece para quem acabou de dizer que mora no imóvel.
const valoresVinculo = (e) => Object.keys(ROTULOS_VINCULO).filter((v) => v !== "LOCADOR" || e.f.uso.valor !== "HABITUAL");
const opcoesVinculo = (e) => [
  ...valoresVinculo(e).map((v) => ({ rotulo: ROTULOS_VINCULO[v], efeito: setar("vinculo", v) })),
  { rotulo: NAO_SEI_OPCAO, efeito: manter("vinculo") },
];
// Só sugere o que os dados indicam: paga aluguel -> inquilino; recebe aluguel -> locador.
// Sem esses sinais não há sugestão (não ter financiamento não prova que o imóvel está quitado).
function sugestaoVinculo(e) {
  const alvo = e.caso.pagamento_aluguel_recorrente === "SIM" ? "INQUILINO" : e.f.vinculo.valor === "LOCADOR" ? "LOCADOR" : null;
  const i = valoresVinculo(e).indexOf(alvo);
  return i < 0 ? null : i;
}

export const BANCO = [
  {
    id: "residencia_principal", campo: "uso", ordem: 0,
    gatilho: precisaResidencia,
    texto: (e) => `Você tem mais de um endereço cadastrado. Você mora em ${e.caso.endereco_txt}?`,
    opcoes: (e) => [
      { rotulo: "Sim, moro neste", efeito: setar("uso", "HABITUAL") },
      { rotulo: `Não, moro em ${e.caso.outro_endereco || "outro endereço"}`,
        efeito: (s) => { s.f.uso = C(null, "AUSENTE", "nenhuma", "cliente mora em outro endereço"); } },
    ],
  },
  {
    id: "uso", campo: "uso", ordem: 1,
    gatilho: (e) => ["nenhuma", "baixa"].includes(e.f.uso.confianca) && !precisaResidencia(e),
    texto: () => "Como este imóvel é usado hoje?",
    opcoes: opcoesUso,
    sugestao: (e) => (e.f.uso.valor === "ALUGADO_TERCEIROS" ? indice(opcoesUso(e), USO_ALUGADO) : null),
  },
  {
    id: "material", campo: "material", ordem: 2,
    gatilho: (e) => e.f.material.valor === null,
    texto: () => "De que material são feitas as paredes externas do imóvel?",
    opcoes: () => [
      { rotulo: "Alvenaria ou concreto", efeito: setar("material", "ALVENARIA") },
      { rotulo: "Mista (alvenaria e madeira)", efeito: setar("material", "MISTA") },
      { rotulo: "Madeira pré-fabricada (normas ABNT e IBAMA)", efeito: setar("material", "MADEIRA_PREFABRICADA") },
      { rotulo: "Madeira ou outro material inflamável", efeito: setar("material", "MADEIRA") },
      { rotulo: NAO_SEI_OPCAO, efeito: setar("material", NAO_SEI) },
    ],
    // sem sugestão: a pergunta só aparece quando não há dado de material
  },
  {
    id: "material_predominante", campo: "material", ordem: 3,
    gatilho: (e) => e.f.material.valor === "MISTA",
    texto: () => "Mais da metade das paredes externas é de alvenaria ou concreto?",
    opcoes: () => [
      { rotulo: "Sim", efeito: setar("material", "ALVENARIA_PREDOMINANTE") },
      { rotulo: "Não", efeito: setar("material", "COMBUSTIVEL_PREDOMINANTE") },
      { rotulo: NAO_SEI_OPCAO, efeito: setar("material", NAO_SEI) },
    ],
  },
  {
    id: "obra", campo: "obra", ordem: 4,
    gatilho: (e) => e.f.obra.valor === null,
    texto: (e) => (e.caso.gastos_material_construcao_24m > 0
      ? `Vimos ${brl(e.caso.gastos_material_construcao_24m)} em compras de material de construção nos últimos 24 meses. `
      : "") + "O imóvel está em obra ou reforma agora?",
    // "Não" e "a obra já foi concluída" respondiam a mesma coisa (sem obra agora): ficou uma opção só.
    opcoes: () => [
      { rotulo: "Não, nenhuma obra agora", efeito: setar("obra", "NAO") },
      { rotulo: "Só manutenção (pintura, pequenos reparos)", efeito: setar("obra", "MANUTENCAO") },
      { rotulo: "Sim, obra ou reforma em andamento", efeito: setar("obra", "EM_ANDAMENTO") },
      { rotulo: NAO_SEI_OPCAO, efeito: setar("obra", NAO_SEI) },
    ],
  },
  {
    id: "seguro_bb", campo: "seguro_bb", ordem: 5,
    gatilho: (e) => e.f.seguro_bb.valor === null,
    texto: textoSeguro,
    opcoes: opcoesSeguro,
  },
  {
    id: "vinculo", campo: "vinculo", ordem: 6,
    gatilho: (e) => ["nenhuma", "baixa"].includes(e.f.vinculo.confianca),
    texto: textoVinculo,
    opcoes: opcoesVinculo,
    sugestao: sugestaoVinculo,
  },
  {
    id: "bens", campo: "bens", ordem: 7,
    gatilho: (e) => e.f.bens.origem === "ESTIMADO",
    texto: (e) => `Pelos bens cadastrados e pelas compras recentes, estimamos que móveis, eletrodomésticos, eletrônicos e itens de lazer neste imóvel valham cerca de ${brl(arred(e.f.bens.valor))}. Qual faixa descreve melhor?`,
    opcoes: opcoesBens,
    sugestao: (e) => faixaEstimada(e, "bens"),
  },
  { // a área define a importância segurada de incêndio: confirmação sempre, pré-preenchida
    id: "area", campo: "area", ordem: 8,
    gatilho: (e) => e.f.area.origem === "ESTIMADO",
    texto: (e) => `Pelas contas do imóvel, estimamos cerca de ${Math.round(e.f.area.valor)} m² (provavelmente entre ${Math.round(e.f.area.faixa[0])} e ${Math.round(e.f.area.faixa[1])} m²). Qual faixa descreve melhor?`,
    opcoes: opcoesArea,
    sugestao: (e) => faixaEstimada(e, "area"),
  },
];
export const sugestaoDe = (p, e) => (p.sugestao ? p.sugestao(e) : null);
export const POR_ID = Object.fromEntries(BANCO.map((p) => [p.id, p]));

// No One Click Buy as estimativas não viram tela própria: são confirmadas no fim da declaração final
// ("Confirmo" ou "Editar"; "Editar" leva à pergunta de faixa e volta). Nos demais casos, área e bens
// têm página própria, para ganhar precisão.
export const ESTIMATIVAS = ["area", "bens"];
const agrupaEstimativas = (e) => (e.one_click ? ESTIMATIVAS : []);

// Campos estimados mostrados no fim da declaração (os já editados também, para poder editar de novo).
export const estimativasDeclaracao = (e) =>
  agrupaEstimativas(e).filter((c) => e.f[c].origem === "ESTIMADO" || e.respondidas.includes(c));

export function fraseEstimativa(e, campo) {
  const [lo, hi] = e.f[campo].faixa;
  if (campo === "bens") { // faixa editada pelo cliente aparece exata; estimada, arredondada
    const fmt = e.respondidas.includes(campo) ? brl : (x) => brl(arred(x));
    return `Seus bens neste imóvel estão entre ${fmt(lo)} e ${fmt(hi)}`;
  }
  return `A área do imóvel está entre ${Math.round(lo)} e ${Math.round(hi)} m²`;
}

// Perguntas (P1/P2) que ainda viram tela própria; no One Click Buy, as estimativas ficam na declaração.
export const decisoes = (e) => candidatas(e).filter((c) => c.nivel <= 2 && !agrupaEstimativas(e).includes(c.p.id));

// --------------------------------------------------------------------------
// Priorização: simula as respostas e vê o que muda
// --------------------------------------------------------------------------
export const copia = (e) => ({ ...e, f: structuredClone(e.f), respondidas: [...e.respondidas],
  declaracao: e.declaracao && structuredClone(e.declaracao) });

// Para cada opção: o que acontece com a situação, a ação, o plano e a faixa se o cliente escolher ela.
export function simularOpcoes(p, e) {
  return p.opcoes(e).map((op) => {
    const e2 = copia(e);
    op.efeito(e2);
    const destinos = Object.values(regras(e2)).filter(([s]) => s === REST).map(([, , d]) => d);
    return { situacao: elegibilidade(e2)[0], destinos, plano: planoRecomendado(e2), faixa: faixaReferencia(e2) };
  });
}

function classificar(p, e) {
  const saidas = simularOpcoes(p, e);
  if (new Set(saidas.map((s) => s.situacao)).size > 1 || p.id === "residencia_principal") return [1, 0];
  // estimativas (área e bens) são base das faixas de cobertura: confirmação sempre (P2)
  if (CAMPOS_COTACAO.has(p.campo) || ESTIMATIVAS.includes(p.id) || new Set(saidas.map((s) => s.plano)).size > 1) return [2, 0];
  const [lo, hi] = faixaReferencia(e);
  const largura = hi - lo;
  const depois = saidas.reduce((a, s) => a + (s.faixa[1] - s.faixa[0]), 0) / saidas.length;
  const ganho = largura > 0 ? (largura - depois) / largura : 0;
  return ganho >= GANHO_MINIMO_REFINO ? [3, ganho] : [null, 0];
}

export function candidatas(e) {
  if (elegibilidade(e)[0] === REST) return [];
  const out = [];
  for (const p of BANCO) {
    if (e.respondidas.includes(p.id) || !p.gatilho(e)) continue;
    const [nivel, ganho] = classificar(p, e);
    if (nivel !== null) out.push({ nivel, ganho, p });
  }
  return out.sort((a, b) => a.nivel - b.nivel || b.ganho - a.ganho || a.p.ordem - b.p.ordem);
}

// [campo, frase]. Valores derivados de confiança média + restrições sem dado na base (E4 a E7).
export function itensDeclaracao(e) {
  const f = e.f;
  const itens = [];
  if (f.material.origem === "DERIVADO") itens.push(["material", "As paredes externas do prédio são de alvenaria ou concreto"]);
  if (f.obra.origem === "DERIVADO") itens.push(["obra", "O imóvel não está em construção, reforma ou reconstrução"]);
  if (f.uso.origem === "DERIVADO" && f.uso.valor === "HABITUAL") itens.push(["uso", "Você mora neste imóvel"]);
  if (f.vinculo.origem === "DERIVADO" && f.vinculo.confianca === "media") itens.push(["vinculo", "Você é inquilino deste imóvel"]);
  itens.push(["rural", "O imóvel não é rural nem usado para atividade rural (a casa-sede de uso pessoal é aceita)"],
    ["tombado", "O imóvel não é tombado, desapropriado nem condenado por órgão público"],
    ["comercial", "Não há atividade comercial no imóvel, exceto MEI da lista aceita"],
    ["comunidade", "O imóvel não fica em favela ou comunidade urbana"]);
  return itens;
}

// { tipo: "pergunta", nivel, p } | { tipo: "declaracao", itens } | null
export function proxima(e, refino = true) {
  const cands = candidatas(e).filter((c) => !agrupaEstimativas(e).includes(c.p.id));
  const decisao = cands.filter((c) => c.nivel <= 2);
  if (decisao.length) return { tipo: "pergunta", nivel: decisao[0].nivel, p: decisao[0].p };
  if (elegibilidade(e)[0] === REST) return null;
  if (e.declaracao === null) return { tipo: "declaracao", itens: itensDeclaracao(e), estimativas: estimativasDeclaracao(e) };
  if (refino && e.refinos < MAX_REFINO) {
    const ref = cands.filter((c) => c.nivel === 3);
    if (ref.length) return { tipo: "pergunta", nivel: 3, p: ref[0].p };
  }
  return null;
}

// [bussola_acao, bussola_destino]: o que a jornada faz agora.
export function acao(e, refino = true) {
  const r = Object.values(regras(e));
  const destinos = new Set(r.filter(([s]) => s === REST).map(([, , d]) => d));
  if (destinos.size === 1 && destinos.has(DESTINO_REVISAO)) return ["REVISAO_APOLICE", DESTINO_REVISAO];
  if (destinos.size) return ["ENCAMINHAR_HUMANO", [...destinos].filter((d) => d !== DESTINO_REVISAO).sort().join(", ")];
  if (proxima(e, refino) !== null) return ["PERGUNTAR", ""];
  if (r.some(([s]) => s === PEND)) return ["RESULTADO_PRELIMINAR", ""];
  return ["CONTINUAR", ""];
}

export function responder(e, p, indice, nivel) {
  const e2 = copia(e);
  p.opcoes(e2)[indice].efeito(e2);
  e2.respondidas.push(p.id);
  e2.revisao += 1; // B9: toda resposta recalcula as decisões afetadas
  if (nivel === 3) e2.refinos += 1;
  return e2;
}

// Resposta com faixa livre (controle de mínimo e máximo): DECLARADO com a faixa que o cliente definiu.
export function responderFaixa(e, p, lo, hi, nivel) {
  const e2 = copia(e);
  setar(p.campo, (lo + hi) / 2, "faixa definida pelo cliente", { faixa: [lo, hi] })(e2);
  e2.respondidas.push(p.id);
  e2.revisao += 1;
  if (nivel === 3) e2.refinos += 1;
  return e2;
}

// respostas: campo -> CONFIRMO | NAO_E_O_CASO | NAO_SEI (ausente = CONFIRMO).
// Estimativas ainda não editadas (área, bens) são confirmadas com a faixa estimada.
export function responderDeclaracao(e, respostas = {}) {
  const e2 = copia(e);
  for (const campo of estimativasDeclaracao(e)) {
    if (e2.respondidas.includes(campo)) continue;
    Object.assign(e2.f[campo], { origem: "DECLARADO", confianca: "alta", nota: "faixa estimada confirmada na declaração" });
    e2.respondidas.push(campo);
  }
  e2.declaracao = {};
  for (const [campo] of itensDeclaracao(e)) {
    const r = respostas[campo] ?? CONFIRMO;
    if (!(campo in e2.f)) e2.declaracao[campo] = r;
    else if (r === NAO_E_O_CASO) e2.f[campo] = C(null, "AUSENTE", "nenhuma", "cliente não confirmou a declaração");
    else if (r === CONFIRMO) Object.assign(e2.f[campo], { origem: "DECLARADO", confianca: "alta", nota: "confirmado na declaração" });
    else if (campo === "material" || campo === "obra") e2.f[campo] = C(NAO_SEI, "DECLARADO", "nenhuma", "cliente não soube confirmar");
  }
  e2.revisao += 1;
  return e2;
}

// Informações que o guia pede na cotação, mas que não mudam a situação do caso.
export function observacoes(e) {
  const f = e.f;
  const obs = [];
  if (f.vinculo.valor === "INQUILINO" || f.uso.valor === "ALUGADO_TERCEIROS")
    obs.push("imóvel alugado: indicar beneficiários distintos (locador para o imóvel, locatário para o conteúdo)");
  if (f.obra.valor === "MANUTENCAO") obs.push("manutenção declarada: segue com ressalva (não equiparar manutenção a reforma)");
  if (f.uso.valor === "DESOCUPADO") obs.push("imóvel desocupado: informação para o score; restrição a VALIDAR com a BB");
  return obs;
}

// Pendências que restam (para o resultado preliminar e para o gerente).
export function pendencias(e) {
  return Object.values(regras(e)).filter(([s]) => s === PEND).map(([, m]) => m);
}
