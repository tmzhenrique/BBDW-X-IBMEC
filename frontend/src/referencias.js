// Preços de referência dos bens, usados para:
//   - traduzir um valor em itens do dia a dia ("≈ 2 geladeiras e 1 TV");
//   - a calculadora "Ajuda para calcular" (quantidade de cada item -> valor estimado).
// VALORES APROXIMADOS E ILUSTRATIVOS, só para ajudar o cliente a dimensionar a faixa:
// trocar por preços com fonte e data (ex.: pesquisa de varejo) antes de usar com cliente real.
export const PRECOS = {
  tv: 2500, notebook: 3500, celular: 2000, videogame: 3000,
  geladeira: 3500, fogao: 1500, maquina_lavar: 2500, micro_ondas: 700, ar_condicionado: 2500,
  sofa: 2500, cama_casal: 2000, guarda_roupa: 1500, mesa_cadeiras: 1500,
  bicicleta: 1500,
};

// Itens da calculadora, agrupados como as categorias de bens do motor de estimativas.
export const CALCULADORA = [
  { grupo: "Eletrônicos", itens: [
    { id: "tv", nome: "Televisão" }, { id: "notebook", nome: "Notebook ou computador" },
    { id: "celular", nome: "Celular" }, { id: "videogame", nome: "Videogame" },
  ] },
  { grupo: "Eletrodomésticos", itens: [
    { id: "geladeira", nome: "Geladeira" }, { id: "fogao", nome: "Fogão" },
    { id: "maquina_lavar", nome: "Máquina de lavar" }, { id: "micro_ondas", nome: "Micro-ondas" },
    { id: "ar_condicionado", nome: "Ar-condicionado" },
  ] },
  { grupo: "Móveis", itens: [
    { id: "sofa", nome: "Sofá" }, { id: "cama_casal", nome: "Cama de casal com colchão" },
    { id: "guarda_roupa", nome: "Guarda-roupa" }, { id: "mesa_cadeiras", nome: "Mesa com cadeiras" },
  ] },
  { grupo: "Lazer", itens: [{ id: "bicicleta", nome: "Bicicleta" }] },
];

// Total da calculadora: quantidades x preço de referência + um valor livre para "outros itens".
export const totalCalculadora = (qtd, outros = 0) =>
  Object.entries(qtd).reduce((t, [id, n]) => t + (PRECOS[id] ?? 0) * n, 0) + outros;

// Itens usados na equivalência. A ordem define a composição: itens mais conhecidos primeiro.
const ITENS_REFERENCIA = [
  { artigo: "uma", um: "geladeira", varios: "geladeiras", preco: PRECOS.geladeira },
  { artigo: "uma", um: "TV de 50 polegadas", varios: "TVs de 50 polegadas", preco: PRECOS.tv },
  { artigo: "um", um: "sofá", varios: "sofás", preco: PRECOS.sofa },
  { artigo: "um", um: "notebook", varios: "notebooks", preco: PRECOS.notebook },
  { artigo: "um", um: "celular", varios: "celulares", preco: PRECOS.celular },
];

// Monta uma cesta variada de itens cujo total não passa do valor: uma volta por vez na lista,
// pegando um de cada item que ainda cabe, até nenhum caber mais.
export function equivalencia(valor) {
  const menor = Math.min(...ITENS_REFERENCIA.map((i) => i.preco));
  if (valor < menor) return `menos que ${artigo(ITENS_REFERENCIA.find((i) => i.preco === menor))}`;
  const qtd = ITENS_REFERENCIA.map(() => 0);
  let resto = valor, pegou = true;
  while (pegou) {
    pegou = false;
    ITENS_REFERENCIA.forEach((item, i) => {
      if (resto >= item.preco) { qtd[i] += 1; resto -= item.preco; pegou = true; }
    });
  }
  const partes = ITENS_REFERENCIA.map((item, i) => [item, qtd[i]]).filter(([, n]) => n > 0)
    .map(([item, n]) => (n === 1 ? artigo(item) : `${n} ${item.varios}`));
  return partes.length > 1 ? `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)}` : partes[0];
}

const artigo = (item) => `${item.artigo} ${item.um}`;
