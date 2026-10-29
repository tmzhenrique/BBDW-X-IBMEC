# Faixas de cobertura — Seguro Residencial

Calcula, para cada cliente + imóvel, a **faixa em reais recomendada para as 12 coberturas** do produto: um **valor sugerido** (pré-selecionado no seletor do cliente) e os **limites mínimo e máximo** que o cliente pode escolher. O cliente decide o valor final; o motor recomenda.

As fórmulas de cada cobertura, com exemplo calculado, estão em **[`docs/CALCULOS_COBERTURAS.md`](docs/CALCULOS_COBERTURAS.md)**.

## Como se encaixa no MVP

```
planilha única ──► pacote de ESTIMATIVAS (área por ML, bens, padrão, vínculo…) ──► ESTE PACOTE ──► seletor do cliente
                                                                                     ▲
                         respostas do cliente (conf_area_m2, conf_valor_bens_…) ─────┘  recalcula na hora
```

Este pacote **não reestima nada**: lê as colunas `est_`/`der_` que o pacote de estimativas já gravou na planilha única, ou recebe os valores direto.

## Instalação

```bash
pip install -r requirements.txt
python testes/teste_rapido.py     # 16 testes
python exemplos/exemplo_uso.py
```

## Uso

```python
from motor_coberturas import CalculadoraCoberturas
calc = CalculadoraCoberturas()

# 1) um perfil da planilha única (já com as estimativas) — opcionalmente com respostas do cliente
cobs = calc.calcular_caso(perfil)
cobs = calc.calcular_caso(perfil, {"conf_area_m2": 180, "conf_padrao_construtivo": "NORMAL"})

# 2) direto pelos valores (sem planilha)
cobs = calc.calcular_insumos(uf="PR", tipo="CASA", area=180, padrao="NORMAL", vinculo="PROPRIO_QUITADO",
                             bens={"movel": 15000, "eletrodomestico": 10000, "eletronico": 6000, "item_lazer": 1000},
                             dependentes=2, pet=True)

# 3) a planilha inteira (para os templates)
df_cob = calc.calcular_planilha(planilha_enriquecida)

# só as coberturas do plano recomendado + adicionais
calc.filtrar_plano(cobs, "PRATICO", adicionais=["RESPONSABILIDADE_CIVIL_FAMILIAR"])
```

Linha de comando: `python -m motor_coberturas --planilha <consolidado_com_estimativas.csv> --saida coberturas.csv`

### `calcular_insumos`: parâmetros

| Parâmetro | Valores |
|---|---|
| `uf` | sigla da UF (busca o CUB/m²; UF fora da tabela usa a média nacional) |
| `tipo` | `CASA` · `APARTAMENTO` |
| `area`, `area_min`, `area_max`, `area_origem`, `area_confianca` | m²; sem mín/máx, a área é tratada como exata (confirmada) |
| `padrao` | `ECONOMICO` · `NORMAL` · `SUPERIOR` · `NAO_DISPONIVEL` |
| `vinculo` | `PROPRIO_QUITADO` · `PROPRIO_FINANCIADO` · `INQUILINO` · `PROPRIO_ALUGADO_TERCEIROS` |
| `bens`, `bens_min`, `bens_max`, `bens_origem` | dict por categoria: `movel`, `eletrodomestico`, `eletronico`, `item_lazer` (R$) |
| `aluguel_pago`, `aluguel_recebido`, `aluguel_equivalente` | R$/mês |
| `dependentes`, `pet`, `gasto_vidracaria_24m` | inteiro, booleano, R$ |

### Cada cobertura devolvida

`cobertura`, `valor_sugerido`, `faixa_valor_min`, `faixa_valor_max`, `passo_seletor`, `margem_seletor`, `estimativa_min`, `estimativa_max`, `confianca_estimativa`, `dados_utilizados`, `regra_calculo_utilizada`, `justificativa`, `informacao_a_confirmar`, `observacao`, `plano_minimo`. As 11 primeiras colunas são as do `template_coberturas_times.csv`.

## Para o seletor no MVP

- **Pré-selecionar** `valor_sugerido`; limitar o seletor a `faixa_valor_min`–`faixa_valor_max`; usar `passo_seletor`.
- **Incêndio:** se o cliente puxar abaixo da sugestão, mostrar o alerta de **rateio** (já vem em `observacao`): *"abaixo do valor estimado do seu imóvel, a indenização pode ser reduzida"*.
- **Ao confirmar/editar área, bens ou padrão**, chamar de novo: a faixa estreita e a confiança sobe.
- **Assistências** não são coberturas: acompanham o plano e não entram aqui.

## Ajustes e casos novos

- Premissas (fatores de padrão, percentuais, pisos, tetos, pesos do roubo, meses de aluguel, margens do seletor): `config/premissas.json`.
- CUB/m² por UF, com fonte e data: `dados_externos/cub_m2_uf.csv`. Nova UF → nova linha. UF ausente → média nacional, com confiança reduzida.
- Itens marcados **[premissa do time]** na regra de cálculo precisam de validação com a BB Seguros (limites oficiais não são públicos).

## Estrutura

```
coberturas_residencial/
├── motor_coberturas/
│   ├── calculadora.py    CalculadoraCoberturas: calcular_caso, calcular_insumos, calcular_planilha, filtrar_plano
│   ├── coberturas.py     fórmulas das 12 coberturas
│   └── contrato.py       leitura da planilha única + valor_efetivo (confirmado > observado > estimado)
├── config/premissas.json
├── dados_externos/cub_m2_uf.csv
├── docs/CALCULOS_COBERTURAS.md
├── exemplos/             exemplo_uso.py + perfil_exemplo.json
└── testes/teste_rapido.py
```
