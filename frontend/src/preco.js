// Estimativa ilustrativa do valor do seguro (prêmio) e das parcelas.
// A tarifa real da BB Seguros não é pública (tabela de taxas e nota técnica atuarial da seguradora).
// Aqui o prêmio segue a estrutura usual do mercado:
//   prêmio de cada cobertura = valor da cobertura × taxa anual da cobertura
//   prêmio líquido = (soma das coberturas × fatores do imóvel) + custo das assistências do plano
//   prêmio total   = prêmio líquido + IOF de seguros de danos
// TAXAS, FATORES E CUSTOS SÃO PREMISSAS DO TIME, A VALIDAR COM A BB SEGUROS. Calibradas para que, no imóvel
// mediano da base de teste (incêndio de ~R$ 242 mil), o Total fique perto de 10x de R$ 70, próximo do
// "a partir de R$ 62" divulgado para o plano completo em reportagens.
import { PLANOS } from "./planos.js";

export const PREMISSAS_PRECO = {
  // taxa anual por mil reais de valor coberto (‰)
  taxa_por_mil: {
    INCENDIO_RAIO_EXPLOSAO_FUMACA: 0.35,
    QUEDA_AERONAVE: 0.02,
    DANOS_POR_AGUA: 1.2,
    VENDAVAL_GRANIZO: 1.0,
    IMPACTO_VEICULOS_TERRESTRES: 0.5,
    DANOS_ELETRICOS: 2.5,
    INSTALACOES_PEQUENOS_REPAROS: 5.0,
    ROUBO_FURTO_ARROMBAMENTO: 8.0,
    QUEBRA_DE_VIDROS: 4.0,
    RESPONSABILIDADE_CIVIL_FAMILIAR: 1.5,
    PERDA_PAGAMENTO_ALUGUEL: 2.5,
    DESPESAS_EMERGENCIAIS: 2.0,
  },
  // custo anual de cada pacote de assistência (R$)
  assistencia_anual: {
    CASA_EM_APUROS: 40, CASA_FUNCIONANDO: 25, CASA_ARRUMADA: 20, CASA_LIMPA: 15,
    CASA_SEM_PRAGAS: 10, CASA_SEGURA: 20, BENEFICIO_PREMIUM: 20,
  },
  // multiplicadores sobre o prêmio das coberturas; valor ausente ou "não sei" = 1 (a pendência vai ao gerente)
  fatores: {
    tipo: { APARTAMENTO: 0.85, CASA_CONDOMINIO: 0.92, CASA: 1.0 },
    material: { ALVENARIA: 1.0, ALVENARIA_PREDOMINANTE: 1.15 },
    uso: { HABITUAL: 1.0, ALUGADO_TERCEIROS: 1.05, TEMPORADA: 1.2, DESOCUPADO: 1.3 },
  },
  iof: 0.0738, // IOF de seguros de danos
  parcelas_max: 10, // sem juros
  parcela_minima: 25,
};

const ROTULO_FATOR = {
  tipo: { APARTAMENTO: "Apartamento", CASA_CONDOMINIO: "Casa em condomínio", CASA: "Casa" },
  material: { ALVENARIA: "Paredes de alvenaria", ALVENARIA_PREDOMINANTE: "Paredes mistas, maioria alvenaria" },
  uso: { HABITUAL: "Moradia", ALUGADO_TERCEIROS: "Alugado a terceiros", TEMPORADA: "Uso de temporada", DESOCUPADO: "Imóvel desocupado" },
};

const centavos = (x) => Math.round(x * 100) / 100;

// cobs: saída de coberturas(e); valores: valores personalizados pelo cliente (cobertura -> R$)
export function precoPlano(e, plano, cobs, valores = {}) {
  const P = PREMISSAS_PRECO, pl = PLANOS[plano];
  const linhas = cobs.filter((c) => pl.coberturas.includes(c.cobertura)).map((c) => {
    const valor = valores[c.cobertura] ?? c.valor_sugerido;
    const taxa = P.taxa_por_mil[c.cobertura];
    return { cobertura: c.cobertura, valor, taxa, premio: (valor * taxa) / 1000 };
  });
  const fatores = Object.keys(P.fatores)
    .map((k) => ({ campo: k, valor: e.f[k].valor, mult: P.fatores[k][e.f[k].valor] }))
    .filter((x) => x.mult !== undefined && x.mult !== 1)
    .map((x) => ({ rotulo: ROTULO_FATOR[x.campo][x.valor], mult: x.mult }));
  const fator = fatores.reduce((a, x) => a * x.mult, 1);
  const somaCoberturas = linhas.reduce((a, l) => a + l.premio, 0);
  const assistencias = pl.assistencias.map((k) => ({ id: k, custo: P.assistencia_anual[k] }));
  const somaAssistencias = assistencias.reduce((a, x) => a + x.custo, 0);
  const liquido = centavos(somaCoberturas * fator + somaAssistencias);
  const iof = centavos(liquido * P.iof);
  const total = centavos(liquido + iof);
  const maxParcelas = Math.max(1, Math.min(P.parcelas_max, Math.floor(total / P.parcela_minima)));
  const parcelas = Array.from({ length: maxParcelas }, (_, i) => ({ n: i + 1, valor: centavos(total / (i + 1)) }));
  return {
    linhas, fatores, fator, somaCoberturas: centavos(somaCoberturas), ajusteFatores: centavos(somaCoberturas * (fator - 1)),
    assistencias, somaAssistencias, liquido, iof, total, parcelas,
  };
}

export const reais = (x) => x.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
