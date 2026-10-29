# Score de aderência dos planos

O plano recomendado (Essencial, Prático ou Total) sai de `score_planos.py`, com as premissas deste arquivo `premissas_score.json`. O código foi adaptado do motor de score do time (`motor_score/motor/score.py`, contrato proposta-0.2).

## Como funciona

1. **Necessidade de 0 a 1** para cada cobertura opcional (roubo, vidros, responsabilidade civil, aluguel e despesas emergenciais). Ela vem de evidências do perfil:
   - valor dos bens portáteis;
   - gasto com vidraçaria;
   - dependentes e pet;
   - vínculo e uso do imóvel;
   - financiamento;
   - valor em risco.
2. **Score por utilidade marginal.** O Essencial vale 50 pontos. Cada cobertura opcional do plano soma ou subtrai 50 × (necessidade − 0,5). Por isso, um plano maior não ganha só por ter mais coberturas.
3. **Necessidade crítica** é a que chega a 0,8 ou mais. Ela tem dois efeitos:
   - pesa 4 vezes mais no score e na porcentagem;
   - obriga o plano mínimo que tem aquela cobertura.

   Os planos continuam fixos: em vez de juntar uma cobertura avulsa, o motor sobe de plano.
4. **Empate:** quando a diferença é de até 3 pontos, ganha o plano mais simples, e a justificativa avisa.
5. **Aderência em %** é a parte das necessidades do cliente que o plano atende sem incluir o que ele não precisa. Ela coloca os planos na mesma ordem do score.

## O que mudou em relação ao motor original

| Mudança | Motivo |
|---|---|
| O bônus "vive do aluguel" foi desativado | Ele usava renda informada ou presumida, e o guia proíbe atributos pessoais como atalho para escolher o plano |
| Imóvel desocupado não tem necessidade de aluguel | A cobertura de perda ou pagamento de aluguel não vale para imóvel desocupado |
| Necessidade crítica pesa mais e define um plano mínimo | O original só sugeria uma cobertura adicional avulsa, mas os planos são fixos |
| A aderência passou a ser em % | O original devolvia só pontos, de −75 a 175 |
| Elegibilidade, lacunas e estados do motor original **não** são usados | O `motor_perguntas.py` (Bússola) já faz essa parte, alinhado ao documento de regras definitivas |

## A validar com a BB Seguros

Todos os pesos e limiares são premissas do time:
- as faixas de bens portáteis;
- os valores de necessidade;
- o corte de necessidade crítica (0,8);
- o peso da necessidade crítica (4);
- o limite de empate (3 pontos).

Na base de teste comum, o resultado é 79 Total, 43 Essencial e 16 Prático. Com corte de 0,9, seriam 72 Total. Sem plano mínimo, seriam 52.
