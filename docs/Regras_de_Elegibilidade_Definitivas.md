# Regras de Elegibilidade Definitivas · Seguro Residencial

Versão do time para a mentoria Brasilseg (28/10, 15h) · consolida: "Regras de Elegibilidade" (Pippo), "Inelegibilidade e encaminhamento ao especialista" (Henrique) e "Bússola: elegibilidade e regras de condução" · referência oficial: Guia dos Times final, seção 9.1

> **Em resumo:** o motor nunca recusa um cliente sozinho. A Bússola usa os dados já disponíveis, pergunta só o que pode mudar encaminhamento, enquadramento, score ou faixa, e encaminha ao atendimento humano quando uma restrição do produto é confirmada. As restrições vêm do guia final; os gatilhos, as perguntas e as ações são propostas do time.
>
> Legenda: `GUIA` regra do guia final · `TIME` proposta do time · `VALIDAR` precisa de confirmação da BB Seguros

### Três compromissos (Bússola)

1. Não perguntar de novo o que já está suficientemente resolvido.
2. Não confundir ausência de sinal com comprovação de aceitação.
3. Não transformar uma resposta isolada em escolha automática de plano.

### Quem faz o quê

- **Bússola:** interpreta dados e respostas, identifica lacunas, escolhe perguntas e executa encaminhamentos definidos por regras validadas.
- **Motor de score (Pippo):** aplica os critérios, compara Essencial, Prático e Total, dimensiona coberturas e informa quais dados ainda podem mudar o resultado.
- **Atendimento humano:** avalia condições e exceções que não devem ser decididas automaticamente. Encaminhamento não é rejeição.

## 1. Três dimensões separadas em cada caso

"Declaração" deixa de ser um estado de elegibilidade: ela é uma forma de obter informação. Cada caso passa a ter três dimensões independentes.

| Dimensão | Valores | Como usar |
|---|---|---|
| **Situação do caso** `eleg_situacao` | `SEM_RESTRICAO_IDENTIFICADA` · `PENDENTE_VERIFICACAO` · `RESTRICAO_CONFIRMADA` | É o pior resultado entre as regras E1 a E7. "Sem restrição identificada" não significa aceitação comprovada; a declaração final continua sendo exigida antes da contratação. |
| **Origem da informação** `<campo>_origem` | `OBSERVADO` (cadastro) · `DERIVADO` (regra) · `ESTIMADO` (modelo) · `DECLARADO` (cliente) · `VERIFICADO_EXTERNO` (sistema ou documento da BB) | Vale para cada campo relevante (área, tipo, uso, vínculo, material, seguro existente…). Declaração do cliente não é comprovação documental. |
| **Ação da Bússola** `bussola_acao` | `CONTINUAR` · `PERGUNTAR` · `RESULTADO_PRELIMINAR` · `ENCAMINHAR_HUMANO` · `REVISAO_APOLICE` | O que a jornada faz agora. `ENCAMINHAR_HUMANO` leva junto o destino sugerido (especialista, Seguro Empresarial ou seguro rural). |

## 2. Prioridade das perguntas: por consequência, não só por confiança

| Nível | Finalidade | Exemplos |
|---|---|---|
| **P0** | Interromper a recomendação automática e encaminhar quando uma regra validada exigir avaliação humana. Não é rejeição. | Resposta que confirma E1, E2, E4, E5 ou E6; seguro já existente no endereço (E3), que vai para revisão da apólice. |
| **P1** | Resolver informação ou contradição crítica para continuar corretamente. | Perguntas de material (E1), obra (E2), seguro do endereço (E3), qual imóvel (B1), contradição entre cadastro e resposta (B3). |
| **P2** | Melhorar materialmente a comparação por score ou as faixas. Uma pergunta de dimensionamento pode valer mais que uma de escolha de plano. | Confirmação da área estimada (pré-preenchida), uso do imóvel, vínculo quando muda coberturas (aluguel, beneficiários), bens relevantes. |
| **P3** | Refinamento opcional, dispensável quando não justificar o esforço. | Detalhes que não mudam plano nem faixa. |

**Quando parar:** quando as pendências críticas (P0/P1) estiverem resolvidas e novas respostas não trouxerem benefício suficiente. Um plano estável não basta se o dimensionamento ainda não tem base. Se a pessoa encerrar antes, mostrar só o resultado preliminar permitido.

**Área estimada:** a confirmação pré-preenchida aparece sempre (um clique), porque a área define a importância segurada da cobertura básica de incêndio; logo, é sempre material para as faixas.

## 3. Regras de restrição: ficha de cada regra

| # | Restrição e fonte | Dados e evidência que dispensa a pergunta | Condição de abertura · prioridade | Pergunta e respostas possíveis | Ação para cada resposta | Teste · validação |
|---|---|---|---|---|---|---|
| **E1** | **Material combustível** `GUIA`. Exceção do guia: madeira pré-fabricada (ABNT/IBAMA). | Material cadastrado ALVENARIA dispensa (origem OBSERVADO). Apartamento: material presumido alvenaria (origem DERIVADO) `TIME`. | Casa sem material cadastrado · P1. | "De que material são as paredes externas?" Alvenaria/concreto (sugerida) · Mista · Madeira pré-fabricada · Madeira ou outro material inflamável · Não sei. Se "Mista": "Mais da metade é alvenaria?" | Alvenaria → CONTINUAR (DECLARADO). Madeira pré-fabricada, madeira/inflamável ou mista predominantemente combustível → P0, ENCAMINHAR_HUMANO (verificar material e exceção). Não sei → PENDENTE, RESULTADO_PRELIMINAR com ressalva; gerente verifica antes da emissão. | 62 casas recebem a pergunta · `VALIDAR` presunção para apartamento |
| **E2** | **Em construção, reforma ou reconstrução** `GUIA` | Ausência de gasto não comprova ausência de obra; por isso a declaração final também cobre obra. | Gasto com material de construção acima de R$ 5 mil em 24 meses (hipótese de triagem `TIME`) · P1. | "O imóvel está em obra ou reforma agora?" Não · Obra já concluída · Só manutenção (pintura, pequenos reparos) · Sim, em andamento · Não sei. | Não / concluída → CONTINUAR. Só manutenção → CONTINUAR com ressalva (não equiparar manutenção à restrição). Em andamento → P0, ENCAMINHAR_HUMANO (fase e previsão de término). Não sei → PENDENTE + RESULTADO_PRELIMINAR. | 19 · `VALIDAR` corte de R$ 5 mil e o que conta como reforma |
| **E3** | **Endereço que já tem seguro residencial BB** `GUIA` | O indicador é do **cliente**: não comprova seguradora, endereço nem apólice vigente, mesmo com um único imóvel. Uma consulta à base de apólices da BB (VERIFICADO_EXTERNO) dispensaria a pergunta. | `possui_seguro_residencial = SIM` · P1. | 1 imóvel: "Este endereço já tem seguro residencial BB?" 2 imóveis: "Qual dos seus imóveis já tem seguro?" (B1). Sim · Não · Não sei. | Sim → P0, REVISAO_APOLICE (nova proposta não é aberta; o cliente não é rejeitado). Não → CONTINUAR. Não sei → PENDENTE; gerente consulta a apólice. | 30 · `VALIDAR` fluxo de revisão/upgrade |
| **E4** | **Atividade rural** `GUIA`. Exceção: casa-sede de uso pessoal. | O código IBGE identifica o município, mas **não** comprova área urbana. Verificação anterior aplicável da BB dispensa. | Sempre, na declaração final · P1. | ☐ "O imóvel não é rural nem usado para atividade rural (a casa-sede de uso pessoal é aceita)." Confirmo · Não é o caso · Não sei. | Confirmo → CONTINUAR (DECLARADO). Não é o caso → P0, ENCAMINHAR_HUMANO (avaliar exceção ou seguro rural). Não sei → PENDENTE. | 138 · fonte oficial |
| **E5** | **Tombado, desapropriado ou condenado** `GUIA` | Situação cadastral REGULAR e consumo de água e energia são **sinais de uso, não laudo**: não dispensam a declaração nem dão confiança alta sozinhos. | Sempre, na declaração final · P1. | ☐ "O imóvel não é tombado, desapropriado nem condenado por órgão público." Confirmo · Não é o caso · Não sei. | Confirmo → CONTINUAR. Não é o caso → P0, ENCAMINHAR_HUMANO. Não sei → PENDENTE. | 138 · fonte oficial |
| **E6** | **Atividade comercial além de MEI aceito** `GUIA` | Endereço principal não comprova uso só residencial. | Sempre, na declaração final · P1. | ☐ "Não há atividade comercial no imóvel, exceto MEI da lista aceita." Confirmo · Há outra atividade · Não sei. | Confirmo → CONTINUAR. Outra atividade → P0, ENCAMINHAR_HUMANO com destino sugerido Seguro Empresarial. Não sei → PENDENTE. | 138 · `VALIDAR` lista de MEI |
| **E7** | **Comunidade carente ou favela** `GUIA` | Nenhum dado da base permite verificar; renda, bairro e coordenadas **nunca** são usados para inferir. | Não abre pergunta automática. | Nenhuma pergunta de classificação social sem regra e procedimento validados. | Registrado como limitação; verificação da BB pelo endereço real. | — · `VALIDAR` procedimento da BB |

**Resposta "não sei" ou recusa (B8):** nunca vira zero nem "não". Mantém a pendência, oferece alternativa simples ou encaminha conforme a importância, sem insistir em loop.

### Enquadramento (não restringe, mas vai para a saída)

| Campo | Regra | Cuidados (revisão da Bússola) |
|---|---|---|
| **Tipo** `GUIA` | Casa, casa em condomínio ou apartamento, derivado do complemento e das flags (100% consistentes). Sinais coerentes dispensam a pergunta (B2). | Apartamento identificado não confirma moradia nem vínculo. Usar o tipo para elevar risco de furto só com evidência própria (ponto para o score). |
| **Uso** `GUIA` | Residencial, misto com MEI aceito ou lazer/veraneio. Endereço não principal (31 casos de teste) abre a pergunta "Como este imóvel é usado hoje?" (P2). | "Desocupado" **não** é restrição até a BB confirmar `VALIDAR`; entra como informação para o score. Não criar exclusões por suposição. |
| **Vínculo** `GUIA` | Próprio, financiado, alugado ou sob gestão. Derivado dos pagamentos (origem DERIVADO). Em imóvel alugado: beneficiários distintos para imóvel (locador) e conteúdo (locatário). | Pagamentos sugerem, mas não comprovam. Ausência de aluguel ou financiamento não prova imóvel quitado. Confirmar quando o vínculo mudar coberturas (aluguel, beneficiários). "Cedido" `VALIDAR`. |
| **Vigência** `GUIA` | 1 a 5 anos para correntista, 1 ano para não correntista. É parâmetro de contratação, não de aceitação. | Perguntar sobre ser correntista só quando a escolha da vigência for necessária na etapa. |
| **Dados mínimos** `GUIA` | Identificação, localização, tipo, uso, vínculo e condições de elegibilidade. | Campo derivado preenchido não é informação confirmada para qualquer fim. Separar completude do perfil de prontidão para cotação. |

## 4. Regras de funcionamento da Bússola (B1 a B10)

São controles da camada de conversa e integração, não novas cláusulas de exclusão.

| Regra | Quando entra e qual ação tomar |
|---|---|
| **B1 · Imóvel correto** | Com vários imóveis ou resposta ambígua, esclarecer só a associação necessária. Não transferir seguro, aluguel ou bens entre imóveis automaticamente. |
| **B2 · Dado suficiente** | Se dados coerentes já resolvem o objetivo, dispensar a pergunta e registrar a origem. Resolver o tipo não resolve uso, moradia e vínculo. |
| **B3 · Contradição relevante** | Pedir esclarecimento só se cadastro e resposta divergirem em algo que afete a decisão (ex.: área cadastrada divergente dos sinais). Guardar histórico e contexto da correção. |
| **B4 · Esforço justificado** | Campo ausente ou incerto só vira pergunta se a resposta puder mudar enquadramento, encaminhamento, score ou uma faixa material. |
| **B5 · Estimativa insuficiente** | Se o modelo não gerar uma referência útil ou o caso estiver fora do contexto validado (área com confiança BAIXA, sinais fora da faixa de treino), usar alternativa defensável, oferecer faixa ou perguntar. Nunca declarar o cliente inelegível por falha do modelo. |
| **B6 · Bem e uso** | Confirmar presença e uso de bem relevante quando necessário. Aceitação do imóvel não implica aceitação de todo equipamento, inclusive profissional. |
| **B7 · Limite insuficiente** | Se a necessidade estimada superar o contratável, conferir os dados decisivos; persistindo, mostrar a lacuna ou encaminhar. Não inventar limite. `VALIDAR` limites de IS do produto. |
| **B8 · Não sei e recusa** | Não converter em zero ou "não". Oferecer alternativa simples, manter pendência ou encaminhar conforme a importância. Não insistir em loop. |
| **B9 · Reavaliação dependente** | Corrigir uso, vínculo, bens, área ou outra informação recalcula todas as decisões afetadas, incluindo elegibilidade, faixas e score. Nunca manter uma recomendação antiga depois de mudar seus fundamentos. |
| **B10 · Encaminhamento completo** | P0 validado suspende a recomendação automática. O gerente recebe motivo, regra, dados com origem e confiança, respostas dadas e dúvidas restantes, para não repetir a entrevista. |

### Quatro casos para validar no papel

| Caso | Comportamento esperado |
|---|---|
| Endereço "Bloco B, apto 305". | Usa o tipo apartamento sem perguntar. Uso e vínculo continuam separados. |
| Cliente informa madeira ou material inflamável. | P0: suspende a automação e encaminha. A IA não rejeita nem decide a exceção. |
| Área estimada, plano estável. | Confirmação pré-preenchida (um clique), porque a faixa de incêndio depende da área. Se o cliente não responder, segue com a estimativa e a limitação explícita. |
| Cliente não sabe o valor dos bens. | Reutiliza os bens já identificados; se preciso, pergunta categorias ou quantidades que mais pesam. Sem inventário longo. |

### Contrato entre Bússola e motor de score

| Bússola envia | Motor devolve |
|---|---|
| Cliente + imóvel alvo; fatos e respostas; origem e qualidade de cada campo; correções; "não sei" e recusas; encaminhamento acionado. | Situação da avaliação; planos com score; motivos; coberturas e faixas; lacunas (campo, regra, efeito esperado). |
| Revisão do perfil e referência da avaliação anterior. | Revisão correspondente, versão do catálogo e parâmetros. Resposta antiga do motor nunca sobrescreve perfil mais recente. |

## 5. Na tabela única e no template

**Colunas por regra** (uma linha por cliente + imóvel):

- `eleg_e1_material` … `eleg_e7_territorial`: SEM_RESTRICAO_IDENTIFICADA / PENDENTE_VERIFICACAO / RESTRICAO_CONFIRMADA
- `eleg_situacao` (pior resultado), `eleg_motivo`, `eleg_regra_acionada`
- `bussola_acao`, `bussola_destino`, `bussola_pendencias` (lista de perguntas com prioridade P0–P3)
- Para cada campo: `<campo>`, `<campo>_origem`, `<campo>_confianca`; respostas em colunas `conf_`
- `perfil_revisao` (incrementa a cada resposta, B9)

**Na base de teste** (ainda sem respostas do cliente):

- Nenhuma restrição confirmada (0 de 138).
- **83 (60%) PENDENTE_VERIFICACAO** por material de casa (62), obra (19) e/ou seguro do cliente (30).
- 55 SEM_RESTRICAO_IDENTIFICADA, todos ainda sujeitos à declaração final.

**Template** (formato a confirmar): `elegivel` = SIM para sem restrição identificada, PENDENTE para pendente de verificação e NAO para restrição confirmada, com o motivo em `motivo_inelegibilidade` e as perguntas, incluindo a declaração final, em `perguntas_confirmacao`.

> **Fechar com a BB / mentoria antes da implementação:** (1) versão oficial das regras e exceções; (2) corte de R$ 5 mil e o que conta como reforma; (3) seguro do cliente × seguro do endereço e fluxo de revisão da apólice; (4) quais declarações do cliente são aceitas; (5) definição de P0 e do que pode seguir como resultado preliminar; (6) imóvel desocupado e cedido; (7) procedimento para comunidade/favela; (8) limites de IS (B7); (9) formato de `elegivel` no template.

---

Não adicionar novas exclusões contratuais por suposição: restrições territoriais, de material, uso e vigência dependem da fonte oficial. Em caso de conflito, prevalecem as condições contratuais e as orientações da Brasilseg / BB Seguros. Contagens: base de teste comum (138 imóveis), calculadas em 28/10/2026.
