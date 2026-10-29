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

// Pacotes de assistência e serviços conforme o guia final (9.2). Limites e quantidades: manuais oficiais.
export const ASSISTENCIAS = {
  CASA_EM_APUROS: ["Casa em Apuros", "chaveiro, eletricista, encanador, desentupimento, cobertura provisória de telhado e limpeza após sinistro"],
  CASA_FUNCIONANDO: ["Casa Funcionando", "conserto de eletrodomésticos, instalação de fogão e cooktop, ar-condicionado e televisão"],
  CASA_ARRUMADA: ["Casa Arrumada", "pequenos serviços de instalação, fixação, montagem, descarte e organização"],
  CASA_LIMPA: ["Casa Limpa", "limpeza de calhas, ralos, caixa de gordura, ar-condicionado, caixa d’água e placa solar"],
  CASA_SEM_PRAGAS: ["Casa sem Pragas", "desinsetização"],
  CASA_SEGURA: ["Casa Segura", "check-up residencial, olho mágico, película de box, fechadura eletrônica e tela de proteção"],
  BENEFICIO_PREMIUM: ["Benefício Premium", "um por ano: assistente virtual, fechadura eletrônica ou decoração online"],
};
const ASS_ESSENCIAL = ["CASA_EM_APUROS"];
const ASS_PRATICO = [...ASS_ESSENCIAL, "CASA_FUNCIONANDO", "CASA_ARRUMADA", "CASA_LIMPA"];
const ASS_TOTAL = [...ASS_PRATICO, "CASA_SEM_PRAGAS", "CASA_SEGURA", "BENEFICIO_PREMIUM"];

export const PLANOS = {
  ESSENCIAL: { nome: "Essencial", coberturas: ESSENCIAL, assistencias: ASS_ESSENCIAL },
  PRATICO: { nome: "Prático", coberturas: PRATICO, assistencias: ASS_PRATICO },
  TOTAL: { nome: "Total", coberturas: TOTAL, assistencias: ASS_TOTAL },
};
export const ORDEM = ["ESSENCIAL", "PRATICO", "TOTAL"];
