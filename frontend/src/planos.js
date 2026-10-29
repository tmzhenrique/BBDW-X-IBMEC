export const COBERTURAS = {
  INCENDIO_RAIO_EXPLOSAO_FUMACA: "Incêndio, raio, explosão e fumaça",
  DANOS_POR_AGUA: "Danos por água",
  VENDAVAL_GRANIZO: "Vendaval e granizo",
  IMPACTO_VEICULOS_TERRESTRES: "Impacto de veículos",
  QUEDA_AERONAVE: "Queda de aeronave",
  DANOS_ELETRICOS: "Danos elétricos",
  // Fixa em todos os planos pelo guia final (9.2), mas ausente do catalogo_coberturas_fixas_planos.csv.
  INSTALACOES_PEQUENOS_REPAROS: "Instalações e pequenos reparos",
  ROUBO_FURTO_ARROMBAMENTO: "Roubo e furto qualificado",
  QUEBRA_DE_VIDROS: "Quebra de vidros",
  RESPONSABILIDADE_CIVIL_FAMILIAR: "Responsabilidade civil familiar",
  PERDA_PAGAMENTO_ALUGUEL: "Perda ou pagamento de aluguel",
  DESPESAS_EMERGENCIAIS: "Despesas emergenciais",
};

const ESSENCIAL = ["INCENDIO_RAIO_EXPLOSAO_FUMACA", "DANOS_POR_AGUA", "VENDAVAL_GRANIZO",
  "IMPACTO_VEICULOS_TERRESTRES", "QUEDA_AERONAVE", "DANOS_ELETRICOS", "INSTALACOES_PEQUENOS_REPAROS"];
const PRATICO = [...ESSENCIAL, "ROUBO_FURTO_ARROMBAMENTO", "QUEBRA_DE_VIDROS"];
const TOTAL = [...PRATICO, "RESPONSABILIDADE_CIVIL_FAMILIAR", "PERDA_PAGAMENTO_ALUGUEL", "DESPESAS_EMERGENCIAIS"];

export const PLANOS = {
  ESSENCIAL: { nome: "Essencial", coberturas: ESSENCIAL, assistencia: "Casa em Apuros" },
  // Pacotes de assistência conforme o guia final (9.2).
  PRATICO: { nome: "Prático", coberturas: PRATICO, assistencia: "Casa em Apuros, Casa Funcionando, Casa Arrumada e Casa Limpa" },
  TOTAL: { nome: "Total", coberturas: TOTAL,
    assistencia: "Tudo do Prático + Casa sem Pragas, Casa Segura e Benefício Premium (assistente virtual, fechadura eletrônica ou decoração online)" },
};
export const ORDEM = ["ESSENCIAL", "PRATICO", "TOTAL"];
