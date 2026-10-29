// Casos REAIS da base comum de teste (138 imóveis), gerados por
//   python exportar_casos_front.py --base <pasta_teste> --treino <pasta_dev>
// A base não tem nome de cliente: exibimos o cliente_id.
import dados from "./casos.json";

const casos = dados.map((c) => ({ ...c, nome: `cliente ${c.cliente_id}`, resumo: c.destaque || c.imovel_id }));

export const DESTAQUES = casos.filter((c) => c.destaque);
export const CASOS = [...DESTAQUES, ...casos.filter((c) => !c.destaque)];
