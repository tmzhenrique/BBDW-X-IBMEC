# Cálculo das faixas de cobertura — Seguro Residencial

Para cada cliente + imóvel o motor calcula as **12 coberturas** (as 11 do `catalogo_coberturas_fixas_planos.csv` + "Instalações e Pequenos Reparos", listada como fixa no Guia dos Times final). Cada cobertura sai com:

| Campo | Significado |
|---|---|
| `estimativa_min` / `estimativa_max` | O que os dados permitem estimar (incerteza) |
| `valor_sugerido` | Centro da estimativa (média geométrica de mín e máx) — **vem pré-selecionado no seletor** |
| `faixa_valor_min` / `faixa_valor_max` | Limites do seletor = sugestão −x% / +x%, com x pela confiança (vão para o template) |
| `confianca_estimativa` | ALTA · MEDIA · BAIXA |
| `regra_calculo_utilizada`, `dados_utilizados`, `justificativa`, `informacao_a_confirmar`, `observacao` | Rastreabilidade (colunas do `template_coberturas_times.csv`) |
| `passo_seletor` | R$ 100 abaixo de R$ 10 mil; R$ 1.000 acima |
| `plano_minimo` | Plano a partir do qual a cobertura é fixa (ESSENCIAL, PRATICO, TOTAL) |

**O cliente escolhe o valor final.** O motor sugere e limita a escolha à faixa do seletor.

## 1. Insumos (sempre pelo valor efetivo)

Cada insumo vem de `valor_efetivo()`: **confirmado pelo cliente > observado no cadastro > estimado**. Se o cliente confirma ou edita, o valor passa a ser exato (mín = máx) e a confiança sobe.

| Insumo | Fonte quando não confirmado |
|---|---|
| Área (m²) e faixa | Área cadastrada ou modelo de ML (P10–P90) |
| Padrão de acabamento | Cadastro; a sugestão derivada **não** estreita a faixa até o cliente confirmar |
| Tipo (casa/apartamento) e vínculo | Derivados do endereço e dos pagamentos |
| Bens por categoria (mín/máx) | Bens cadastrados ponderados + compras 36 meses |
| Aluguel pago / recebido / equivalente | Observado nos pagamentos; senão área × R$/m² de aluguel |
| Dependentes, pet, gasto com vidraçaria | Cadastro e transações |
| CUB/m² | `dados_externos/cub_m2_uf.csv` (R8-N por UF, com fonte e data); UF ausente → média nacional |

## 2. Fórmula de cada cobertura

### Incêndio, raio, explosão e fumaça (cobertura básica)
Limite único **imóvel + conteúdo**.

```
fator_padrao  = ECONOMICO 0,75–0,90 · NORMAL 0,95–1,10 · SUPERIOR 1,20–1,50 · desconhecido 0,85–1,25
central       = área × CUB_UF × √(fator_min × fator_max)
estrutura     = central com as incertezas de área e de padrão combinadas em quadratura no log
                (independentes: não multiplica todos os extremos ao mesmo tempo)
  apartamento → só benfeitorias internas: × 10%–25% (a estrutura do prédio é do seguro obrigatório
                do condomínio, Código Civil art. 1.346)
conteúdo      = Σ bens das 4 categorias (mín, máx)   ·   imóvel alugado a terceiros → conteúdo = 0
incêndio      = estrutura + conteúdo
```
Confiança: ALTA se área e padrão conhecidos e CUB da UF; BAIXA se a área tem confiança baixa; senão MEDIA.
Observações automáticas: rateio (valor abaixo da sugestão reduz a indenização), beneficiários distintos em imóvel alugado, sobreposição com o seguro habitacional (DFI) em imóvel financiado.

### Queda de aeronave
Igual à faixa de incêndio (evento de perda total). *Premissa do time.*

### Danos por água · Vendaval e granizo · Impacto de veículos
Percentual do **valor central de incêndio**, por tipo, com piso. *Premissa do time (sem dado próprio).*

| Cobertura | Casa | Apartamento | Piso |
|---|---|---|---|
| Danos por água | 10%–20% | 10%–20% | R$ 5.000 |
| Vendaval e granizo | 10%–20% | 5%–10% | R$ 3.000 |
| Impacto de veículos | 5%–10% | 2%–5% | R$ 3.000 |

### Danos elétricos
```
faixa = bens eletrodomésticos + eletrônicos (mín, máx)   ·   piso R$ 3.000   ·   máx ≤ incêndio máx
```

### Roubo ou furto mediante arrombamento
```
faixa = Σ bens × peso da categoria: eletrônicos 100% · lazer 100% · eletrodomésticos 50% · móveis 0%
piso R$ 3.000   ·   imóvel alugado a terceiros → R$ 3.000–6.000 (bens são do inquilino)
```
*Pesos: premissa do time (bens portáteis e de valor são os mais visados).*

### Quebra de vidros
```
base: casa R$ 3.000–8.000 · apartamento R$ 2.000–5.000
com gasto de vidraçaria em 24 meses: mín = max(base, 50% do gasto), máx = max(base, 120% do gasto)
```

### Responsabilidade civil familiar
```
R$ 20.000–50.000 + R$ 5.000–15.000 por dependente + R$ 5.000–15.000 com pet   ·   teto R$ 100.000
```
*Premissa do time.* Dependentes e pet medem exposição (necessidade), não risco do cliente.

### Perda ou pagamento de aluguel
| Vínculo | Base | Meses |
|---|---|---|
| Inquilino | aluguel pago (observado ou informado) | 6–12 |
| Aluga para terceiros | aluguel recebido (crédito recorrente) | 6–12 |
| Proprietário morador | aluguel equivalente (área × R$/m²) | 3–6 |

### Despesas emergenciais
5%–10% do valor central de incêndio, entre R$ 2.000 e R$ 30.000. *Premissa do time.*

### Instalações e pequenos reparos
R$ 1.000–3.000 fixo. *Premissa do time; ausente do CSV de catálogo (confirmar nomenclatura).*

## 3. Do cálculo ao seletor

```
1. estimativa_min, estimativa_max  ← fórmula da cobertura
   (se o piso prevalece nos dois extremos e o valor não é confirmado: máx = 1,5 × mín)
2. valor_sugerido = √(estimativa_min × estimativa_max)        (valor exato se confirmado)
3. faixa do seletor = sugestão × (1 − m)  a  sugestão × (1 + m)
      m = 15% (ALTA) · 25% (MEDIA) · 40% (BAIXA)
4. arredondamento: centenas abaixo de R$ 10 mil, milhares acima
```

## 4. Exemplo calculado

Casa em Curitiba/PR, 180 m² confirmados, padrão NORMAL, própria quitada, bens confirmados (móveis R$ 15 mil, eletrodomésticos R$ 10 mil, eletrônicos R$ 6 mil, lazer R$ 1 mil), 2 dependentes e pet:

| Cobertura | Sugestão | Seletor | Confiança |
|---|---|---|---|
| Incêndio | R$ 536.000 | 456.000 – 616.000 | ALTA |
| Queda de aeronave | R$ 536.000 | 456.000 – 616.000 | ALTA |
| Danos por água | R$ 76.000 | 45.000 – 106.000 | BAIXA |
| Vendaval e granizo | R$ 76.000 | 45.000 – 106.000 | BAIXA |
| Impacto de veículos | R$ 38.000 | 23.000 – 53.000 | BAIXA |
| Danos elétricos | R$ 16.000 | 14.000 – 18.000 | ALTA |
| Pequenos reparos | R$ 1.700 | 1.000 – 2.400 | BAIXA |
| Roubo/furto | R$ 12.000 | 10.000 – 14.000 | ALTA |
| Quebra de vidros | R$ 4.900 | 2.900 – 6.900 | BAIXA |
| RC familiar | R$ 58.000 | 35.000 – 81.000 | BAIXA |
| Perda/pagamento de aluguel | R$ 14.000 | 8.600 – 20.000 | BAIXA |
| Despesas emergenciais | R$ 21.000 | 13.000 – 30.000 | BAIXA |

Incêndio: 180 m² × R$ 2.739/m² (CUB R8-N PR, set/2026) × fator NORMAL (0,95–1,10) ≈ R$ 468–542 mil de reconstrução + R$ 32 mil de bens.

## 5. Onde ajustar

Todas as premissas (fatores de padrão, percentuais, pisos, tetos, pesos do roubo, meses de aluguel, margens do seletor) estão em `config/premissas.json`. O CUB por UF está em `dados_externos/cub_m2_uf.csv`. Quando a BB validar um limite, mude o arquivo, não o código.

**Pendências de validação com a BB Seguros:** limites oficiais de importância segurada por cobertura; percentuais de água, vendaval, impacto e despesas; RC familiar; pequenos reparos; CUB oficial de GO (hoje média das demais UFs).
