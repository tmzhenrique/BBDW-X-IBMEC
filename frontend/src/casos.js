// Casos REAIS da base comum de teste (138 imóveis), gerados por
//   python exportar_casos_front.py --base <csv_teste_consolidado>
// A base não tem nome de cliente: exibimos o cliente_id, exceto nas três jornadas da apresentação.
import dados from "./casos.json" with { type: "json" };

// Jornadas da apresentação: imóveis reais da base de teste com um nome FICTÍCIO de cliente, só para exibição.
// O nome não entra em nenhum cálculo.
export const JORNADAS = [
  { imovel_id: "IMO_CASO_00004_01", nome: "Mariana Souza", jornada: "One Click Buy",
    roteiro: "os dados bastam: uma tela só de confirmação" },
  { imovel_id: "IMO_CASO_00003_01", nome: "Carlos Pereira", jornada: "Atendimento assistido",
    roteiro: "responda que a obra está em andamento: a contratação para e vai ao especialista" },
  { imovel_id: "IMO_CASO_00025_01", nome: "Fernanda Lima", jornada: "Indicação completa (agente e lote)",
    roteiro: "perguntas, faixas de área e bens e o plano recomendado com as coberturas" },
];
const porImovel = Object.fromEntries(JORNADAS.map((j) => [j.imovel_id, j]));

const casos = dados.map((c) => ({
  ...c, nome: porImovel[c.imovel_id]?.nome ?? `cliente ${c.cliente_id}`,
  jornada: porImovel[c.imovel_id] ?? null, resumo: c.destaque || c.imovel_id,
}));

export const APRESENTACAO = JORNADAS.map((j) => casos.find((c) => c.imovel_id === j.imovel_id));
export const DESTAQUES = casos.filter((c) => c.destaque && !c.jornada);
export const CASOS = [...APRESENTACAO, ...DESTAQUES, ...casos.filter((c) => !c.destaque && !c.jornada)];
