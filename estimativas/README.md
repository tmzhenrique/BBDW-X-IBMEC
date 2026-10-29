# Estimativas — Seguro Residencial

Pacote com **todas as estimativas de dados e métricas** do motor, prontas para o MVP:

| Estimativa | Método | Sai com |
|---|---|---|
| **Área do imóvel (m²)** | Modelo de ML: ensemble (Gradient Boosting + HistGradientBoosting + Ridge) em log(área), com estimadores físicos de R$/m² (IPTU, energia, condomínio) | valor, faixa P10–P90, confiança, alerta fora do domínio, área divergente do cadastro |
| **Bens por categoria** (móveis, eletrodomésticos, eletrônicos, lazer) | Regra: bens cadastrados ponderados pela probabilidade de estarem no imóvel + compras dos últimos 36 meses. **Sem renda** | sugerido, mín, máx por categoria e total |
| **Padrão de acabamento** (onde falta) | IPTU/m² relativo à mediana da cidade (sinal fraco: 63% de acerto) | sugestão com confiança BAIXA |
| **Tipo, uso e vínculo** | Regras sobre termos do endereço, pagamentos e endereço principal | sugestão + origem DERIVADO |
| **Aluguel equivalente** | Área × R$/m² de aluguel dos inquilinos da base (P25–P75) | sugerido, mín, máx |
| **Faixas das 12 coberturas** | Incêndio = reconstrução (área × CUB/m² da UF × fator do padrão) + conteúdo; demais por dados próprios ou premissas explícitas | valor sugerido, faixa do seletor, confiança, regra de cálculo, justificativa, o que confirmar |

Cada valor vem com **origem** (`CONFIRMADO` > `OBSERVADO` > `ESTIMADO`/`DERIVADO`) e **confiança**. Quando o cliente confirma ou edita um valor, tudo é recalculado com o valor confirmado.

## Instalação

```bash
pip install -r requirements.txt
python testes/teste_rapido.py      # 12 testes de sanidade e robustez
python exemplos/exemplo_uso.py     # exemplo comentado
```

Versões usadas no desenvolvimento: Python 3.13 · pandas 3.0 · numpy 2.5 · scikit-learn 1.9 · joblib 1.6.

## Uso no MVP

```python
from motor_estimativas import Estimador

est = Estimador()                         # carrega o modelo treinado (artefatos/) e as premissas (config/)

# 1) um caso: perfil = uma linha da planilha única (dict)
r = est.estimar_caso(perfil)
r["estimativas"]["area_m2"]               # {'valor': 185, 'min': 148, 'max': 232, 'origem': 'ESTIMADO', 'confianca': 'MEDIA'}
r["sugestoes_confirmacao"]                # perguntas pré-preenchidas (o que ainda não foi confirmado)
r["coberturas"]                           # 12 coberturas: valor_sugerido, faixa_valor_min/max, confiança, regra...

# 2) o cliente confirma ou edita → mesma chamada, com as respostas em colunas conf_
r = est.estimar_caso(perfil, {"conf_area_m2": 180, "conf_padrao_construtivo": "NORMAL"})

# 3) a planilha inteira (lote / templates)
perfis, coberturas = est.estimar_planilha(df)
```

Linha de comando:

```bash
python -m motor_estimativas lote --planilha <consolidado.csv> --saida saidas/
python -m motor_estimativas treinar --planilhas <dev_consolidado.csv> <teste_consolidado.csv>
```

### Saída de `estimar_caso`

| Chave | Conteúdo |
|---|---|
| `estimativas` | Para cada campo: `valor`, `min`, `max`, `origem`, `confianca`. Campos: `area_m2`, `padrao_construtivo`, `tipo_imovel`, `uso_imovel`, `tipo_vinculo`, `valor_bens_movel`, `valor_bens_eletrodomestico`, `valor_bens_eletronico`, `valor_bens_item_lazer`, `aluguel_equivalente_mensal`, `quantidade_dependentes`, `possui_pet` |
| `detalhes` | Área por IPTU, energia e condomínio; alerta fora do domínio; área cadastrada divergente; total de bens |
| `sugestoes_confirmacao` | Lista com `campo`, `prioridade` (P2/P3), `valor_sugerido`, `min`/`max` ou `opcoes`, `origem`, `confianca`, `pergunta` (texto pronto) |
| `coberturas` | Uma linha por cobertura com as colunas do `template_coberturas_times.csv` + `valor_sugerido`, `margem_seletor`, `passo_seletor`, `estimativa_min/max`, `plano_minimo` |

### Respostas do cliente (colunas `conf_`)

| Campo pré-preenchido | Coluna de resposta |
|---|---|
| Área | `conf_area_m2` (m²) |
| Bens | `conf_valor_bens_movel`, `conf_valor_bens_eletrodomestico`, `conf_valor_bens_eletronico`, `conf_valor_bens_item_lazer` (R$) |
| Padrão | `conf_padrao_construtivo` (`ECONOMICO` · `NORMAL` · `SUPERIOR`) |
| Tipo / uso / vínculo | `conf_tipo_imovel`, `conf_uso_imovel`, `conf_tipo_vinculo` |
| Aluguel equivalente ou aluguel pago | `conf_aluguel_equivalente_mensal` (R$/mês) |
| Dependentes e pet | `conf_quantidade_dependentes`, `conf_possui_pet` |

Use `NAO_SEI` quando o cliente não souber: a estimativa continua valendo, sinalizada.

## Entrada: a planilha única

Todo o pacote lê **somente a planilha única** (uma linha por cliente + imóvel, prefixos `obs_`, `der_`, `est_`, `conf_`, `ctl_`). As colunas obrigatórias estão em `motor_estimativas/contrato.py` (`COLUNAS_OBRIGATORIAS`). O pacote **nunca altera colunas `obs_`**: escreve em `est_`, `der_`, `conf_` (vazias) e `ctl_`.

## Casos novos (cidades, UFs, imóveis)

- **Cidade que o modelo não viu:** a área é estimada com as medianas gerais, marcada em `ctl_estimativa_area_fora_dominio = municipio_nao_visto` e sai com confiança BAIXA (pedir confirmação).
- **UF sem CUB na tabela:** usa `cub_padrao_nacional_m2` de `config/premissas.json` e não dá confiança ALTA à cobertura de incêndio. Para incluir a UF, acrescente uma linha em `dados_externos/cub_m2_uf.csv` (fonte e data).
- **Valores fora da faixa de treino** (IPTU, energia, água, condomínio): marcados e com confiança BAIXA; a área fica limitada ao intervalo visto no treino.
- **Dados novos:** rode `treinar` com as planilhas únicas atualizadas. O modelo, os parâmetros e as métricas são salvos versionados em `artefatos/`.
- **Premissas:** percentuais, pisos, margens do seletor e pesos ficam em `config/premissas.json`; mude o arquivo, não o código.

Se `artefatos/modelo_area.joblib` não abrir por diferença de versão do scikit-learn, rode `treinar` (≈15 s) com as planilhas únicas de desenvolvimento e teste.

## Qualidade do modelo de área

| Avaliação | Erro mediano | MAE | R² | Faixa P10–P90 |
|---|---|---|---|---|
| Validação cruzada (1.016 imóveis, 5 partições) | 11,5% | 19,8 m² | 0,886 | — |
| Teste à parte (46 imóveis nunca vistos) | 10,4% | 19,5 m² | 0,882 | cobriu 82,6% |
| Baseline (mediana por tipo) | 27,8% | — | — | — |

Modelo final treinado com 1.062 imóveis. Detalhes em `artefatos/metricas_modelo_area.json`.

## Cuidados e limitações

- **Nenhum atributo pessoal** (renda, idade, dependentes) entra na estimativa de patrimônio (área, bens). Renda só é usada fora deste pacote, para avaliar necessidade ("vive do aluguel").
- **Estimativa não é fato:** toda estimativa tem origem e confiança e vem com pergunta pré-preenchida para confirmar.
- **Premissas do time** (marcadas `[premissa do time]` na regra de cálculo) precisam de validação com a BB Seguros, em especial os percentuais de água, vendaval, impacto, despesas, RC familiar e pequenos reparos.
- **CUB de GO** é uma aproximação (média das outras UFs); substituir pelo valor oficial do Sinduscon-GO.

## Estrutura

```
estimativas_residencial/
├── motor_estimativas/
│   ├── estimador.py      Estimador: estimar_caso, estimar_planilha, treinar
│   ├── contrato.py       planilha única + valor_efetivo (confirmado > observado > estimado)
│   ├── modelo_area.py    modelo de ML da área
│   ├── estimativas.py    bens, padrão, tipo, uso, vínculo, aluguel, sugestões
│   └── coberturas.py     faixas das 12 coberturas
├── config/premissas.json
├── dados_externos/cub_m2_uf.csv
├── artefatos/            modelo treinado, parâmetros e métricas
├── exemplos/             exemplo_uso.py + perfil_exemplo.json
└── testes/teste_rapido.py
```
