# Datathon Ibmec × BB Seguros: histórico do que já foi discutido

Recuperado do chat "Solução datathon BB Seguros" no claude.ai (26 e 27/10/2026).

## Contexto

- **Evento:** Datathon "Proteção Inteligente", uma parceria do Ibmec com a BB Seguros (BBDW). O tema é Seguro Residencial.
- **Time:** **Vector**, de vetor. Outros nomes que foram sugeridos e descartados: Prêmio Justo, Sinistro Zero, Risco Calculado, Apólice Preditiva.
- **Prazo de entrega:** até as **10h de 29/10**.
- **Material recebido:** `Seguro_Residencial_DadosSinteticos.zip` (original em Downloads; hoje a base usada é a unificada em `dados/consolidado/01_Tabelas_Finais/`, e os templates e o catálogo ficam em `dados/referencia/`), que contém:
  - `DatathonBBDW-GuiaDosTimes.pdf`: 16 páginas escaneadas.
  - `Seguro_Residencial_Desenvolvimento.zip`: base de desenvolvimento, com 2.200 clientes e 2.578 imóveis.
  - `Seguro_Residencial_Teste_Comum.zip`: base comum de teste, com 138 imóveis.
  - Arquivos em cada base: `clientes`, `enderecos_imoveis`, `sinais_imobiliarios`, `bens_compras`, `territorio`, `dicionario_dados`, `catalogo_coberturas_fixas_planos`, `template_resultado_times`, `template_coberturas_times` e `LEIA-ME.md`.

## O que precisa ser entregue

1. **`template_resultado_times.csv`:** uma linha por combinação cliente-imóvel, com:
   - elegibilidade e motivo da inelegibilidade;
   - tipo, uso e vínculo sugeridos;
   - plano recomendado e coberturas;
   - confiança geral e justificativa;
   - perguntas de confirmação e fontes públicas.
2. **`template_coberturas_times.csv`:** para cada caso, **todas as coberturas fixas** do plano recomendado e as adicionais que se aplicarem. Cada cobertura precisa ter:
   - faixa mínima e máxima em R$;
   - confiança, dados usados e regra de cálculo;
   - justificativa e o que ainda falta confirmar.
3. A base comum de teste precisa ser processada **inteira, em lote**, sem depender de alguém respondendo o formulário.

**Fluxo esperado pelo guia:** sinais → sugestão inicial → confiança → confirmação → recomendação. O guia também pede para "reduzir e priorizar perguntas".

**Canais que o guia menciona:** One Click Buy, atendimento assistido e agente autônomo.

**Critério de avaliação citado:** "Adequação da proteção" vale **20%** da nota. Também contam explicabilidade e qualidade da jornada.

## Planos (fixos, com nomes do catálogo)

| Plano | Coberturas fixas |
|---|---|
| **ESSENCIAL** (6) | INCENDIO_RAIO_EXPLOSAO_FUMACA, DANOS_POR_AGUA, VENDAVAL_GRANIZO, IMPACTO_VEICULOS_TERRESTRES, QUEDA_AERONAVE, DANOS_ELETRICOS |
| **PRATICO** (8) | Essencial + ROUBO_FURTO_ARROMBAMENTO, QUEBRA_DE_VIDROS |
| **TOTAL** (11) | Prático + RESPONSABILIDADE_CIVIL_FAMILIAR, PERDA_PAGAMENTO_ALUGUEL, DESPESAS_EMERGENCIAIS |

**Assistências:**
- Essencial: Casa em Apuros.
- Prático: conserto de eletrodomésticos, ar e TV.
- Total: Casa Segura (tela de proteção e fechadura).

## Decisões já tomadas

- **Não é para criar plano personalizado.** Cada cliente tem que ser *encaixado* em Essencial, Prático ou Total. O Henrique reforçou isso explicitamente. O que varia de cliente para cliente é:
  - a faixa de valor de cada cobertura;
  - a justificativa;
  - as alternativas, por exemplo: "no Prático você ficaria sem RC familiar".
- **O encaixe funciona em degraus.** Todo cliente elegível começa no Essencial e só sobe se a base justificar:
  - **→ Prático:** bens relevantes no imóvel (móveis, eletrônicos, eletrodomésticos) ou gasto com vidraçaria.
  - **→ Total:** imóvel alugado para terceiros (por causa da perda de aluguel), ou bens relevantes junto com dependentes ou pet (por causa da RC familiar e da tela de proteção).
  - **Correção (28/10):** "perda ou pagamento de aluguel" só é acionada quando o imóvel fica inabitável por evento coberto ou é interditado pela Defesa Civil. Reembolsa o aluguel não recebido (locador), a moradia temporária (proprietário) ou o aluguel devido e a moradia temporária (inquilino). Não cobre imóvel desocupado nem inadimplência. A regra do locador foi mantida no plano provisório, com a justificativa corrigida; a necessidade de moradia temporária fica para o motor de score.
- **A solução é um motor com dois modos:**
  - **Lote:** só com os dados, gera sugestão, confiança e as perguntas que *faria*, que vão para a coluna `perguntas_confirmacao`.
  - **Interativo:** é o formulário adaptativo. Faz uma pergunta por vez e recalcula tudo depois de cada resposta.
- **Stack sugerida:** FastAPI no motor, com uma rota `/proxima-pergunta`, e React no formulário.
- **Ordem de trabalho:** primeiro o motor em lote e os templates preenchidos, que são obrigatórios. O formulário vem depois.

## Lógica das perguntas adaptativas (`motor_perguntas.py`)

1. **Cada campo** guarda o valor, a origem (observado, estimado, confirmado ou ausente) e a confiança. Os campos são material, obra, uso, vínculo, área, padrão e bens.
2. **A confiança decide o que acontece com o campo:**
   - alta: não pergunta;
   - média: entra na declaração única do final;
   - baixa: vira pergunta, com a resposta sugerida já marcada;
   - ausente: vira pergunta normal.
3. **O nível é a prioridade da pergunta.** O motor simula todas as respostas possíveis e vê o que muda:
   - **0, "Bloqueia":** muda a elegibilidade, por isso vem primeiro.
   - **1, "Obrigatória":** uso ou vínculo, que são exigidos para cotar.
   - **2, "Muda o plano".**
   - **3, "Ajusta o valor":** só estreita a faixa. É opcional e fica de fora no One Click Buy.
   - **Sem nível:** a pergunta não é feita.
4. **Depois de cada resposta, tudo é recalculado.** Por isso a próxima pergunta depende da resposta anterior.

**Resultados dos testes:**
- Base de desenvolvimento: média de **1,6 pergunta** de decisão por imóvel, mais a declaração. **14%** dos clientes têm zero perguntas e estão prontos para o One Click Buy.
- Base de teste: média de 1,64.
- O modelo de área, que estima a área por IPTU, condomínio, energia, água, tipo e município, teve **R² = 0,87**, com margem de cerca de ±30%.

**Perguntas e com que frequência aparecem (base de desenvolvimento):**

| Pergunta | Aparece quando | Nível | % |
|---|---|---|---|
| Material das paredes externas | casa sem material cadastrado | 0 | 45% |
| ↳ Mais da metade é alvenaria? | respondeu "mista" | 0 | — |
| Como o imóvel é usado? | endereço não é o principal | 0 | 21% |
| Está em obra? | R$ 10 mil ou mais em material de construção | 0 | 8% |
| Você mora em [endereço]? | dois endereços que parecem principais | 1 | 19% |
| Relação com o imóvel | sem sinal de aluguel ou financiamento | 1 | 53% |
| Esses bens ficam aqui? | R$ 5 mil ou mais em bens de vínculo incerto | 2 ou 3 | 16% |
| Faixa de área | sem área cadastrada | 3 | 61% |
| Acabamento | sem padrão cadastrado | 3 | 73% |
| Declaração única | sempre | — | 100% |

Duas coisas nunca são perguntadas:
- **casa ou apartamento:** sai dos termos do endereço em 100% dos casos;
- **pet e dependentes:** já vêm informados na base.

**Como rodar:**
```
python motor_perguntas.py --base <pasta_dev> --lote
python motor_perguntas.py --base <pasta_teste> --treino <pasta_dev> --lote
python motor_perguntas.py --base <pasta_dev> --interativo IMO_CLI_00005_01
python motor_perguntas.py --base <pasta_dev> --exemplos
```

## Lacunas da base (perfil da base de desenvolvimento)

- Sem área cadastrada: 61%.
- Sem material da parede: 78%.
- Sem padrão construtivo: 73%.
- Nenhum sinal de vínculo (não paga aluguel, não financia, não recebe aluguel): 40%.
- Recebe crédito compatível com aluguel: 9%.
- Endereço não é o principal: 21%.
- Gasto com material de construção: 18%.
- Bens com vínculo de baixa confiança: 21% dos bens.
- Clientes com 2 imóveis: 378.

## Cuidados e regras do guia

- **Não usar renda nem idade** como atalho para escolher o plano ou estimar patrimônio, porque o guia proíbe. Para estimar valores, usar bens, compras, IPTU e condomínio.
- Usar pet e dependentes para justificar a RC familiar é defensável, desde que isso fique explícito na justificativa e entre como item de confirmação.
- Em caso de conflito, valem as condições contratuais da BB Seguros.

## Pendências (precisam de decisão do time)

- [ ] **"Pequenos reparos":** aparece no guia como cobertura do Essencial, mas não está no `catalogo_coberturas_fixas_planos.csv`. Perguntar na mentoria.
- [ ] **Calibrar os limites provisórios:** R$ 10 mil para obra, R$ 5 mil para bens incertos e R$ 15 mil para conteúdo relevante.
- [ ] **Trocar o custo por m² ilustrativo** (R$ 2.000, R$ 2.800 e R$ 3.800) pelo CUB da UF (Sinduscon), com fonte e data.
- [ ] **Clientes com dois imóveis:** a resposta "onde você mora" deveria valer para os dois imóveis de uma vez. Ainda não foi implementado.
- [ ] **Regra de plano em degraus,** com justificativa e alternativa geradas automaticamente. Foi oferecida, mas ainda não foi feita no código.
- [ ] **Renomear os níveis no código e na apresentação** para Bloqueia, Obrigatória, Muda o plano e Ajusta o valor.
- [ ] **Gerar os dois templates finais** a partir da base de teste.

## Arquivos gerados no chat

- `motor_perguntas.py`: recuperado e salvo nesta pasta, idêntico à última versão do chat.
- `perguntas_por_caso_teste.csv`: perguntas geradas para os 138 imóveis de teste. Dá para gerar de novo com `--lote` na base de teste.
- `Vector_encaixe_planos.xlsx`: planilha com 4 abas (degraus de encaixe, coberturas por plano, assistências e pontos de atenção). Ficou no chat e não foi copiada para cá.

**Falta copiar para esta pasta:** o zip original com os dados e o guia em PDF.
