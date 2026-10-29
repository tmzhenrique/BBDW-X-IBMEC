import { useMemo, useState } from "react";
import { CASOS, DESTAQUES } from "./casos.js";
import {
  CONFIRMO, DESTINO_REVISAO, NAO_E_O_CASO, NAO_SEI, REST,
  acao, brl, coberturas, copia, elegibilidade, estadoInicial, observacoes, pendencias,
  POR_ID, decisoes, fraseEstimativa,
  avaliacaoPlano, proxima, responder, responderDeclaracao, responderFaixa, simularOpcoes, sugestaoDe,
} from "./engine.js";
import { COBERTURAS, ORDEM, PLANOS } from "./planos.js";
import { CALCULADORA, PRECOS, equivalencia, totalCalculadora } from "./referencias.js";

// Perguntas respondidas com faixa livre (controle de mínimo e máximo) em vez de opções prontas.
// Configuração de cada pergunta com faixa livre: passo do controle, teto mínimo da escala,
// como mostrar o valor, onde fica a unidade, se há equivalência em itens do dia a dia
// e se há a calculadora "Ajuda para calcular" (quantidade de itens -> valor).
const FAIXA_CONFIG = {
  bens: {
    passo: 500, tetoMinimo: 10_000, arredTeto: 5_000, fmt: brl, prefixo: "R$", sufixo: "", nome: "dos bens",
    equivalencia: true, calculadora: true,
    ajuda: "Esse valor é a base para a proteção dos seus bens contra roubo, incêndio e danos elétricos.",
  },
  area: {
    passo: 5, tetoMinimo: 100, arredTeto: 50, fmt: (x) => `${x} m²`, prefixo: "", sufixo: "m²", nome: "da área",
    equivalencia: false,
    ajuda: "A área define o custo de reconstruir o imóvel, que é a base da cobertura de incêndio.",
  },
};
const PERGUNTAS_FAIXA = new Set(Object.keys(FAIXA_CONFIG));

// --------------------------------------------------------------------------
// Rótulos de exibição
// --------------------------------------------------------------------------
const CAMPOS = {
  tipo: "Tipo de imóvel", uso: "Uso", vinculo: "Sua relação", material: "Paredes externas",
  obra: "Obra", area: "Área", bens: "Bens no imóvel", seguro_bb: "Seguro BB neste endereço",
};
const VALORES = {
  APARTAMENTO: "Apartamento", CASA: "Casa", CASA_CONDOMINIO: "Casa em condomínio",
  ALVENARIA: "Alvenaria", MADEIRA: "Madeira", MADEIRA_PREFABRICADA: "Madeira pré-fabricada", MISTA: "Mista",
  ALVENARIA_PREDOMINANTE: "Predominância de alvenaria", COMBUSTIVEL_PREDOMINANTE: "Predominância de madeira",
  NAO: "Sem obra", CONCLUIDA: "Obra concluída", MANUTENCAO: "Só manutenção", EM_ANDAMENTO: "Em andamento",
  [NAO_SEI]: "Não sabe",
  HABITUAL: "Moradia", TEMPORADA: "Temporada", ALUGADO_TERCEIROS: "Alugado a terceiros", DESOCUPADO: "Desocupado",
  PROPRIETARIO_QUITADO: "Proprietário (quitado)", PROPRIETARIO_FINANCIADO: "Proprietário (financiado)",
  INQUILINO: "Inquilino", LOCADOR: "Proprietário que aluga", SOB_GESTAO: "Sob gestão", CEDIDO: "Cedido",
  ECONOMICO: "Simples", NORMAL: "Médio", SUPERIOR: "Alto padrão",
};
const ORIGEM = {
  OBSERVADO: { rotulo: "Nos dados", classe: "ok" },
  VERIFICADO_EXTERNO: { rotulo: "Verificado", classe: "ok" },
  DECLARADO: { rotulo: "Você informou", classe: "ok" },
  DERIVADO: { rotulo: "Deduzido", classe: "est" },
  ESTIMADO: { rotulo: "Estimado", classe: "est" },
  AUSENTE: { rotulo: "A confirmar", classe: "falta" },
};
// P0 não é pergunta: é o encaminhamento quando uma resposta confirma uma restrição.
const NIVEL = {
  1: { rotulo: "Necessária para seguir", interno: "P1", porque: "Precisamos disso para saber se a contratação pode seguir direto ou com um atendimento especializado." },
  2: { rotulo: "Ajuda a definir sua proteção", interno: "P2", porque: "Sua resposta muda as coberturas certas ou o valor de proteção do seu imóvel." },
  3: { rotulo: "Opcional · ajusta o valor", interno: "P3", porque: "Deixa a faixa de valor das coberturas mais precisa. Pode pular." },
};
const RESPOSTAS_DECLARACAO = [[CONFIRMO, "Confirmo"], [NAO_E_O_CASO, "Não é o caso"], [NAO_SEI, "Não sei"]];

function valorTexto(campo, c) {
  if (c.valor === null) return "—";
  if (campo === "seguro_bb") return { SIM: "Já tem", NAO: "Não tem", [NAO_SEI]: "Não sabe" }[c.valor];
  if (campo === "area") {
    const [lo, hi] = c.faixa;
    return lo === hi ? `${Math.round(c.valor)} m²` : `${Math.round(lo)} a ${Math.round(hi)} m²`;
  }
  if (campo === "bens") {
    const [lo, hi] = c.faixa;
    return lo === hi ? brl(c.valor) : `${brl(lo)} a ${brl(hi)}`;
  }
  return VALORES[c.valor] ?? c.valor;
}

// O acabamento (padrão) não é perguntado nem mostrado: só entra no cálculo quando vem do cadastro.
const CAMPOS_OCULTOS = new Set(["padrao"]);
const camposVisiveis = (e) => Object.entries(e.f).filter(([k]) => !CAMPOS_OCULTOS.has(k));

const confiancaGeral = (e) => {
  const fs = camposVisiveis(e).map(([, c]) => c);
  return Math.round((100 * fs.filter((c) => c.confianca === "alta").length) / fs.length);
};

// --------------------------------------------------------------------------
// App
// --------------------------------------------------------------------------
export default function App() {
  const [casoId, setCasoId] = useState(CASOS[0].imovel_id);
  const caso = CASOS.find((c) => c.imovel_id === casoId);
  const [historico, setHistorico] = useState(() => [estadoInicial(caso)]);
  const [etapa, setEtapa] = useState("inicio");
  const [completo, setCompleto] = useState(false); // false = One Click Buy (sem refino)
  // "Editar" de uma estimativa na declaração abre a página de faixa daquele campo e depois volta
  const [editando, setEditando] = useState(null);
  // respostas da declaração ficam aqui para não se perderem ao ir editar uma estimativa e voltar
  const [respDeclaracao, setRespDeclaracao] = useState({});
  const e = historico[historico.length - 1];
  const passo = etapa === "fluxo" && !editando ? proxima(e, completo) : null;
  const fim = etapa === "fluxo" && !editando && passo === null;

  const limpar = () => { setEtapa("inicio"); setEditando(null); setRespDeclaracao({}); };
  const trocarCaso = (id) => {
    setCasoId(id);
    setHistorico([estadoInicial(CASOS.find((c) => c.imovel_id === id))]);
    limpar();
  };
  const avancar = (novo) => setHistorico((h) => [...h, novo]);
  const voltar = () => (historico.length > 1 ? setHistorico((h) => h.slice(0, -1)) : setEtapa("inicio"));
  const reiniciar = () => { setHistorico([estadoInicial(caso)]); limpar(); };
  const salvarEdicao = (novo) => { avancar(novo); setEditando(null); };

  return (
    <div className="app">
      <header className="topo">
        <div className="topo-in">
          <div className="marca">
            <span className="marca-icone" aria-hidden>⌂</span>
            <div>
              <strong>Seguro Residencial</strong>
              <small>Protótipo · Time Vector</small>
            </div>
          </div>
          <label className="demo">
            <span>Imóvel da base de teste</span>
            <select value={casoId} onChange={(ev) => trocarCaso(ev.target.value)}>
              <optgroup label="Um caso real para cada caminho">
                {DESTAQUES.map((c) => <option key={c.imovel_id} value={c.imovel_id}>{c.imovel_id} · {c.destaque}</option>)}
              </optgroup>
              <optgroup label={`Base de teste (${CASOS.length} imóveis)`}>
                {CASOS.filter((c) => !c.destaque).map((c) => <option key={c.imovel_id} value={c.imovel_id}>{c.imovel_id}</option>)}
              </optgroup>
            </select>
          </label>
        </div>
      </header>

      <main className="grade">
        <section className="principal">
          {etapa === "inicio" && (
            <Inicio e={e} completo={completo} setCompleto={setCompleto} onComecar={() => setEtapa("fluxo")} />
          )}
          {passo?.tipo === "pergunta" && (
            <Pergunta key={e.respondidas.length + passo.p.id} e={e} passo={passo} completo={completo}
              onResponder={(i) => avancar(responder(e, passo.p, i, passo.nivel))}
              onResponderFaixa={(lo, hi) => avancar(responderFaixa(e, passo.p, lo, hi, passo.nivel))}
              onPular={() => avancar({ ...copia(e), respondidas: [...e.respondidas, passo.p.id], refinos: e.refinos + 1 })}
              onVoltar={voltar} />
          )}
          {passo?.tipo === "declaracao" && (
            <Declaracao e={e} itens={passo.itens} estimativas={passo.estimativas}
              respostas={respDeclaracao} setRespostas={setRespDeclaracao} onEditar={setEditando}
              onConfirmar={(resp) => avancar(responderDeclaracao(e, resp))} onVoltar={voltar} />
          )}
          {editando && (
            <PerguntaFaixa key={`editar-${editando}`} e={e} passo={{ p: POR_ID[editando], nivel: 2 }} editando
              onResponderFaixa={(lo, hi) => salvarEdicao(responderFaixa(e, POR_ID[editando], lo, hi, 2))}
              onResponder={(i) => salvarEdicao(responder(e, POR_ID[editando], i, 2))}
              onVoltar={() => setEditando(null)} />
          )}
          {fim && <Resultado e={e} completo={completo} onVoltar={voltar} onReiniciar={reiniciar} />}
        </section>
        <Painel e={e} />
      </main>
    </div>
  );
}

// --------------------------------------------------------------------------
// Telas
// --------------------------------------------------------------------------
function Inicio({ e, completo, setCompleto, onComecar }) {
  const decisao = decisoes(e).length;
  const campos = camposVisiveis(e);
  const sabidos = campos.filter(([, c]) => c.origem !== "AUSENTE").length;
  return (
    <div className="cartao entrada">
      <p className="sobretitulo">Olá, {e.caso.nome}</p>
      <h1>Já adiantamos {sabidos} de {campos.length} informações do seu imóvel</h1>
      <p className="endereco">{e.caso.endereco_txt}</p>
      <p className="sub">
        {decisao === 0
          ? "Só falta você confirmar uma lista curta de informações."
          : `Faltam ${decisao} ${decisao === 1 ? "pergunta rápida" : "perguntas rápidas"} e uma confirmação final.`}
      </p>

      <ul className="lista-campos">
        {campos.map(([k, c]) => <LinhaCampo key={k} campo={k} c={c} />)}
      </ul>

      <fieldset className="modo">
        <legend>Como prefere seguir?</legend>
        <label className={!completo ? "sel" : ""}>
          <input type="radio" checked={!completo} onChange={() => setCompleto(false)} />
          <span><strong>Contratação rápida</strong><small>Só o necessário para cotar</small></span>
        </label>
        <label className={completo ? "sel" : ""}>
          <input type="radio" checked={completo} onChange={() => setCompleto(true)} />
          <span><strong>Valor mais preciso</strong><small>Até 2 perguntas opcionais a mais</small></span>
        </label>
      </fieldset>

      <button className="btn primario largo" onClick={onComecar}>Começar</button>
    </div>
  );
}

const Pergunta = (props) =>
  PERGUNTAS_FAIXA.has(props.passo.p.id) ? <PerguntaFaixa {...props} /> : <PerguntaOpcoes {...props} />;

function PerguntaOpcoes({ e, passo, completo, onResponder, onPular, onVoltar }) {
  const { p, nivel } = passo;
  const opcoes = p.opcoes(e);
  const sug = sugestaoDe(p, e);
  const [sel, setSel] = useState(sug);
  const [ajuda, setAjuda] = useState(false);
  const efeitos = useMemo(() => simularOpcoes(p, e), [p, e]);

  const feitas = e.respondidas.length + (e.declaracao ? 1 : 0);
  const restantes = decisoes(e).length + (e.declaracao ? 0 : 1)
    + (completo && nivel === 3 ? 1 : 0);
  const total = Math.max(feitas + restantes, feitas + 1);

  return (
    <div className="cartao">
      <Progresso atual={feitas + 1} total={total} />
      <span className={`tag nivel-${nivel}`} title={`Prioridade ${NIVEL[nivel].interno}`}>{NIVEL[nivel].rotulo}</span>
      <h2 className="pergunta">{p.texto(e)}</h2>
      <button className="link" onClick={() => setAjuda((a) => !a)}>Por que perguntamos isso?</button>
      {ajuda && <p className="ajuda">{NIVEL[nivel].porque}</p>}

      <div className="opcoes" role="radiogroup">
        {opcoes.map((op, i) => {
          const ef = efeitos[i];
          // O plano só é revelado no Resultado; aqui só avisamos para onde a resposta leva.
          let impacto = null;
          if (ef.situacao === REST)
            impacto = ef.destinos.every((d) => d === DESTINO_REVISAO)
              ? { t: "Vamos revisar a sua apólice atual", c: "info" }
              : { t: "Seguirá com atendimento especializado", c: "alerta" };
          else if (["Não sei", "Prefiro não responder"].includes(op.rotulo)) impacto = { t: "Tudo bem: seguimos e isso fica pendente", c: "info" };
          return (
            <button key={i} role="radio" aria-checked={sel === i}
              className={`opcao ${sel === i ? "sel" : ""}`} onClick={() => setSel(i)}>
              <span className="radio" aria-hidden />
              <span className="opcao-txt">
                {op.rotulo}
                {impacto && <small className={`impacto ${impacto.c}`}>{impacto.t}</small>}
              </span>
              {sug === i && <span className="selo">Sugerido pelos seus dados</span>}
            </button>
          );
        })}
      </div>

      <div className="acoes">
        <button className="btn secundario" onClick={onVoltar}>Voltar</button>
        {nivel === 3 && <button className="btn texto" onClick={onPular}>Pular</button>}
        <button className="btn primario" disabled={sel === null} onClick={() => onResponder(sel)}>Continuar</button>
      </div>
    </div>
  );
}

// Faixa livre: duas bolinhas (mínimo e máximo) que começam na faixa estimada pelos dados,
// campos para digitar os valores e, nos bens, a equivalência em itens do dia a dia.
function PerguntaFaixa({ e, passo, onResponder, onResponderFaixa, onVoltar, editando = false }) {
  const { p, nivel } = passo;
  const cfg = FAIXA_CONFIG[p.campo];
  const noPasso = (x) => Math.round(x / cfg.passo) * cfg.passo;
  const f = e.f[p.campo];
  const [lo, setLo] = useState(noPasso(f.faixa[0]));
  const [hi, setHi] = useState(Math.max(noPasso(f.faixa[1]), noPasso(f.faixa[0])));
  // escala até o dobro da estimativa, e cresce se o cliente digitar ou calcular um valor maior
  const teto = Math.ceil(Math.max(f.faixa[1] * 2, cfg.tetoMinimo, hi) / cfg.arredTeto) * cfg.arredTeto;
  const [ajuda, setAjuda] = useState(false);
  const iNaoSei = p.opcoes(e).findIndex((op) => op.rotulo === "Não sei");
  const estimada = lo === noPasso(f.faixa[0]) && hi === Math.max(noPasso(f.faixa[1]), noPasso(f.faixa[0]));

  // as bolinhas não se cruzam: mínimo nunca passa do máximo
  const mudarLo = (v) => setLo(Math.min(Math.max(0, Number(v) || 0), hi));
  const mudarHi = (v) => setHi(Math.max(Math.min(teto, Number(v) || 0), lo));
  // nos campos digitados, o valor só é corrigido ao sair do campo (senão "2" vira o mínimo no meio da digitação)
  const ajustar = () => { const [a, b] = [lo, hi].map((x) => Math.max(0, x)).sort((x, y) => x - y); setLo(a); setHi(b); return [a, b]; };
  const pct = (x) => `${(100 * Math.min(Math.max(0, x), teto)) / teto}%`;

  const feitas = e.respondidas.length + (e.declaracao ? 1 : 0);
  const restantes = decisoes(e).length + (e.declaracao ? 0 : 1);
  const total = Math.max(feitas + restantes, feitas + 1);

  return (
    <div className="cartao">
      <Progresso atual={feitas + 1} total={total} />
      <span className={`tag nivel-${nivel}`} title={`Prioridade ${NIVEL[nivel].interno}`}>{NIVEL[nivel].rotulo}</span>
      <h2 className="pergunta">{p.texto(e).replace("Qual faixa descreve melhor?", "Ajuste a faixa se precisar.")}</h2>
      <button className="link" onClick={() => setAjuda((a) => !a)}>Por que perguntamos isso?</button>
      {ajuda && <p className="ajuda">{NIVEL[nivel].porque} {cfg.ajuda}</p>}

      <div className="faixa">
        <div className="faixa-trilho" style={{ background: `linear-gradient(to right, var(--linha) ${pct(lo)}, var(--azul) ${pct(lo)}, var(--azul) ${pct(hi)}, var(--linha) ${pct(hi)})` }}>
          <input type="range" min="0" max={teto} step={cfg.passo} value={lo}
            aria-label={`Valor mínimo ${cfg.nome}`} onChange={(ev) => mudarLo(ev.target.value)} />
          <input type="range" min="0" max={teto} step={cfg.passo} value={hi}
            aria-label={`Valor máximo ${cfg.nome}`} onChange={(ev) => mudarHi(ev.target.value)} />
        </div>
        <div className="faixa-escala"><span>{cfg.fmt(0)}</span><span>{cfg.fmt(teto)}</span></div>

        <div className="faixa-valores">
          <label>
            <span>Mínimo</span>
            <span className="campo-reais">{cfg.prefixo} <input type="number" min="0" max={teto} step={cfg.passo} value={lo}
              onChange={(ev) => setLo(Number(ev.target.value) || 0)} onBlur={ajustar} /> {cfg.sufixo}</span>
            {cfg.equivalencia && <small>≈ {equivalencia(lo)}</small>}
          </label>
          <label>
            <span>Máximo</span>
            <span className="campo-reais">{cfg.prefixo} <input type="number" min="0" max={teto} step={cfg.passo} value={hi}
              onChange={(ev) => setHi(Number(ev.target.value) || 0)} onBlur={ajustar} /> {cfg.sufixo}</span>
            {cfg.equivalencia && <small>≈ {equivalencia(hi)}</small>}
          </label>
        </div>
        <p className="nota">
          {estimada ? <span className="selo">Faixa sugerida pelos seus dados</span> : <button className="link" onClick={() => {
            setLo(noPasso(f.faixa[0])); setHi(Math.max(noPasso(f.faixa[1]), noPasso(f.faixa[0])));
          }}>Voltar para a faixa sugerida</button>}
          {cfg.equivalencia && " Equivalências com preços de referência aproximados, só para ajudar a dimensionar."}
        </p>
        {cfg.calculadora && <Calculadora onUsar={(t) => { setLo(noPasso(t * 0.9)); setHi(Math.max(noPasso(t * 1.1), cfg.passo)); }} />}
      </div>

      <div className="acoes">
        <button className="btn secundario" onClick={onVoltar}>Voltar</button>
        {iNaoSei >= 0 && <button className="btn texto" onClick={() => onResponder(iNaoSei)}>Não sei</button>}
        <button className="btn primario" onClick={() => onResponderFaixa(...ajustar())}>{editando ? "Salvar e voltar" : "Continuar"}</button>
      </div>
    </div>
  );
}

// "Ajuda para calcular": quantidade de cada item x preço de referência -> valor estimado dos bens.
// O total vira uma faixa de 10% abaixo a 10% acima, que o cliente ainda pode ajustar.
function Calculadora({ onUsar }) {
  const [aberta, setAberta] = useState(false);
  const [qtd, setQtd] = useState({});
  const [outros, setOutros] = useState(0);
  const total = totalCalculadora(qtd, outros);
  const mudar = (id, n) => setQtd((q) => ({ ...q, [id]: Math.max(0, Math.min(99, n)) }));

  return (
    <div className="calc">
      <button className="link" aria-expanded={aberta} onClick={() => setAberta((a) => !a)}>
        {aberta ? "Fechar a ajuda para calcular" : "Ajuda para calcular: some os itens que você tem"}
      </button>
      {aberta && (
        <div className="calc-corpo">
          <p className="sub">Informe quantos itens de cada tipo ficam neste imóvel. Usamos preços médios de referência para estimar o valor.</p>
          {CALCULADORA.map(({ grupo, itens }) => (
            <fieldset key={grupo} className="calc-grupo">
              <legend>{grupo}</legend>
              {itens.map(({ id, nome }) => {
                const n = qtd[id] ?? 0;
                return (
                  <div key={id} className="calc-item">
                    <span className="calc-nome">{nome}<small>{brl(PRECOS[id])} cada</small></span>
                    <span className="calc-qtd">
                      <button aria-label={`Tirar um: ${nome}`} disabled={n === 0} onClick={() => mudar(id, n - 1)}>−</button>
                      <input type="number" min="0" max="99" value={n} aria-label={`Quantidade: ${nome}`}
                        onChange={(ev) => mudar(id, Number(ev.target.value) || 0)} />
                      <button aria-label={`Somar um: ${nome}`} onClick={() => mudar(id, n + 1)}>+</button>
                    </span>
                  </div>
                );
              })}
            </fieldset>
          ))}
          <label className="calc-item">
            <span className="calc-nome">Outros itens<small>valor total em R$</small></span>
            <input className="calc-outros" type="number" min="0" step="100" value={outros} aria-label="Valor de outros itens, em reais"
              onChange={(ev) => setOutros(Math.max(0, Number(ev.target.value) || 0))} />
          </label>
          <div className="calc-total"><span>Total estimado</span><strong>{brl(total)}</strong></div>
          <button className="btn secundario largo" disabled={total === 0}
            onClick={() => { onUsar(total); setAberta(false); }}>Usar esse valor na faixa</button>
          <p className="nota">A faixa fica entre 10% abaixo e 10% acima do total. Preços aproximados, só para ajudar.</p>
        </div>
      )}
    </div>
  );
}

// Aba de outro plano: o que ele muda em relação ao recomendado e a aderência dele.
function comparar(ver, recomendado, av) {
  const nomes = (ids) => ids.map((c) => COBERTURAS[c].toLowerCase()).join(", ");
  const maior = ORDEM.indexOf(ver) > ORDEM.indexOf(recomendado);
  const dif = maior ? PLANOS[ver].coberturas.filter((c) => !PLANOS[recomendado].coberturas.includes(c))
    : PLANOS[recomendado].coberturas.filter((c) => !PLANOS[ver].coberturas.includes(c));
  return `O ${PLANOS[ver].nome} tem ${av.aderencia[ver]}% de aderência ao seu perfil. ` +
    (maior ? `Acrescenta ${nomes(dif)}.` : `Fica sem ${nomes(dif)}.`);
}

// Uma cobertura na tela final: só nome e valor (o sugerido, já preenchido). "Personalizar" abre o ajuste
// dentro da faixa da cobertura (botões, campo ou barra, no passo dela); em incêndio, avisa do rateio.
function CoberturaValor({ c, valor, onChange, extra }) {
  const [aberto, setAberto] = useState(false);
  const { faixa_valor_min: min, faixa_valor_max: max, passo_seletor: passo, valor_sugerido: sug } = c;
  const nome = COBERTURAS[c.cobertura];
  const ajustar = (v) => onChange(Math.min(Math.max(min, Math.round(v / passo) * passo), max));
  const pct = `${(100 * (Math.min(Math.max(valor, min), max) - min)) / (max - min || 1)}%`;
  const rateio = c.cobertura === "INCENDIO_RAIO_EXPLOSAO_FUMACA" && valor < sug;
  return (
    <li className={`cob ${extra ? "extra" : ""}`}>
      <div className="cob-linha">
        <span className="cob-nome">{nome}</span>
        <strong className="cob-total">{brl(valor)}</strong>
        <button className="link" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
          {aberto ? "Fechar" : "Personalizar"}
        </button>
      </div>
      {aberto && (
        <div className="cob-ajuste">
          <div className="cob-valor">
            <button aria-label={`Diminuir ${nome}`} disabled={valor <= min} onClick={() => ajustar(valor - passo)}>−</button>
            <input className="cob-barra" type="range" min={min} max={max} step={passo} value={valor} aria-label={`Ajustar ${nome}`}
              style={{ background: `linear-gradient(to right, var(--azul) ${pct}, var(--linha) ${pct})` }}
              onChange={(ev) => onChange(Number(ev.target.value))} />
            <button aria-label={`Aumentar ${nome}`} disabled={valor >= max} onClick={() => ajustar(valor + passo)}>+</button>
          </div>
          <div className="cob-escala">
            <span>{brl(min)}</span>
            {valor !== sug && <button className="link" onClick={() => onChange(sug)}>Voltar ao sugerido</button>}
            <span>{brl(max)}</span>
          </div>
          {rateio && <p className="impacto alerta">Abaixo do valor estimado do imóvel, a indenização pode ser reduzida (rateio).</p>}
        </div>
      )}
    </li>
  );
}

function Declaracao({ e, itens, estimativas, respostas, setRespostas, onEditar, onConfirmar, onVoltar }) {
  const marcar = (campo, r) => setRespostas((x) => ({ ...x, [campo]: r }));
  const alterou = Object.values(respostas).some((r) => r !== CONFIRMO);
  return (
    <div className="cartao">
      <span className="tag nivel-d">Confirmação final</span>
      <h2 className="pergunta">Confira se está tudo certo</h2>
      <p className="sub">Se algo não for o caso, faremos uma pergunta específica ou chamaremos um especialista. Se não souber, tudo bem: fica como pendência.</p>
      <ul className="declaracao">
        {itens.map(([campo, frase]) => {
          const atual = respostas[campo] ?? CONFIRMO;
          return (
            <li key={campo} className={atual === CONFIRMO ? "" : atual === NAO_SEI ? "duvida" : "negado"}>
              <span className="frase">{frase}</span>
              <span className="tri" role="radiogroup" aria-label={frase}>
                {RESPOSTAS_DECLARACAO.map(([r, rot]) => (
                  <button key={r} role="radio" aria-checked={atual === r}
                    className={atual === r ? "sel" : ""} onClick={() => marcar(campo, r)}>{rot}</button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>

      {estimativas.length > 0 && (
        <>
          <h3>Valores estimados para a sua proteção</h3>
          <ul className="declaracao estimativas">
            {estimativas.map((campo) => {
              const ajustado = e.respondidas.includes(campo);
              const manteve = ajustado && e.f[campo].origem === "ESTIMADO"; // "não sei" na edição
              return (
                <li key={campo}>
                  <span className="frase">
                    {fraseEstimativa(e, campo)}
                    <small>{manteve ? "Você não soube ajustar: fica a estimativa, como pendência."
                      : ajustado ? "Faixa ajustada por você." : "Estimado pelos seus dados."}</small>
                  </span>
                  <span className="tri" role="group" aria-label={fraseEstimativa(e, campo)}>
                    <span className={`tri-estado ${manteve ? "" : "sel"}`}>{ajustado && !manteve ? "Ajustado" : manteve ? "Pendente" : "Confirmo"}</span>
                    <button onClick={() => onEditar(campo)}>Editar</button>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="acoes">
        <button className="btn secundario" onClick={onVoltar}>Voltar</button>
        <button className="btn primario" onClick={() => onConfirmar(respostas)}>
          {alterou ? "Continuar" : "Está tudo certo"}
        </button>
      </div>
    </div>
  );
}

function Resultado({ e, completo, onVoltar, onReiniciar }) {
  const [, motivo] = elegibilidade(e);
  const [acaoBussola, destino] = acao(e, completo);
  // plano pelo score de aderência; as abas mostram a % de cada plano
  const av = avaliacaoPlano(e);
  const recomendado = av.plano;
  const [ver, setVer] = useState(recomendado);
  const pend = pendencias(e);
  // valor de cada cobertura: começa no sugerido pelo cálculo e o cliente pode personalizar dentro da faixa
  const cobs = useMemo(() => coberturas(e), [e]);
  const [valores, setValores] = useState({});

  // B10: o atendimento recebe motivo, dados com origem e respostas, para não repetir a entrevista.
  const repasse = <p className="nota">O atendimento recebe o motivo, os dados com origem e confiança e {e.revisao === 1 ? "a resposta" : `as ${e.revisao} respostas`} que você já deu.</p>;

  if (acaoBussola === "REVISAO_APOLICE") {
    return (
      <div className="cartao">
        <span className="tag nivel-1">Você já tem seguro aqui</span>
        <h2 className="pergunta">Este endereço já tem seguro residencial BB</h2>
        <p className="sub">Não abrimos uma nova proposta para o mesmo endereço. Podemos revisar e melhorar a sua apólice atual.</p>
        {repasse}
        <div className="acoes">
          <button className="btn secundario" onClick={onVoltar}>Revisar respostas</button>
          <button className="btn primario">Revisar minha apólice</button>
        </div>
      </div>
    );
  }
  if (acaoBussola === "ENCAMINHAR_HUMANO") {
    return (
      <div className="cartao">
        <span className="tag nivel-0">Atendimento especializado</span>
        <h2 className="pergunta">Vamos seguir com um especialista</h2>
        <p className="sub">Isso não é uma recusa. Pelas respostas, este ponto precisa de avaliação humana: {motivo}.</p>
        <p className="sub">Encaminhamento sugerido: <strong>{destino}</strong>.</p>
        {repasse}
        <div className="acoes">
          <button className="btn secundario" onClick={onVoltar}>Revisar respostas</button>
          <button className="btn primario">Falar com especialista</button>
        </div>
      </div>
    );
  }

  const pl = PLANOS[ver];
  return (
    <div className="cartao">
      <p className="sobretitulo">{acaoBussola === "RESULTADO_PRELIMINAR" ? "Resultado preliminar" : "Recomendação para você"}</p>
      <h1>Plano {PLANOS[recomendado].nome}</h1>
      {acaoBussola === "RESULTADO_PRELIMINAR" && (
        <div className="aviso">
          <strong>Antes de contratar, falta confirmar:</strong>
          <ul>{pend.map((p) => <li key={p}>{p}</li>)}</ul>
          <small>Um gerente verifica esses pontos antes da emissão.</small>
        </div>
      )}

      <div className="planos" role="tablist">
        {ORDEM.map((k) => (
          <button key={k} role="tab" aria-selected={ver === k}
            className={`plano-tab ${ver === k ? "sel" : ""}`} onClick={() => setVer(k)}>
            {PLANOS[k].nome}
            <span className="plano-pct">{av.aderencia[k]}%</span>
            {k === recomendado && <small>Recomendado</small>}
          </button>
        ))}
      </div>

      {ver === recomendado ? (
        <div className="porque">
          <h3>Por que este plano</h3>
          <ul>{av.justificativas.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      ) : (
        <div className="porque neutro">
          <p>{comparar(ver, recomendado, av)}</p>
        </div>
      )}

      <h3>Valor de cada cobertura do {pl.nome} ({pl.coberturas.length})</h3>
      <p className="sub">Valores sugeridos com os dados do seu imóvel.</p>
      <ul className="cob-lista">
        {cobs.filter((c) => pl.coberturas.includes(c.cobertura)).map((c) => (
          <CoberturaValor key={c.cobertura} c={c} extra={!PLANOS[recomendado].coberturas.includes(c.cobertura)}
            valor={valores[c.cobertura] ?? c.valor_sugerido}
            onChange={(v) => setValores((x) => ({ ...x, [c.cobertura]: v }))} />
        ))}
      </ul>
      <p className="assistencia"><strong>Assistências:</strong> {pl.assistencia}</p>
      {observacoes(e).map((o) => <p key={o} className="assistencia"><strong>Atenção:</strong> {o}</p>)}

      <div className="numeros">
        <div><small>Confiança dos dados</small><strong>{confiancaGeral(e)}%</strong></div>
        <div><small>Coberturas personalizadas</small><strong>{pl.coberturas.filter((k) => valores[k] !== undefined && valores[k] !== cobs.find((c) => c.cobertura === k)?.valor_sugerido).length} de {pl.coberturas.length}</strong></div>
      </div>
      <p className="nota">Valores calculados com premissas do time, a validar com a BB Seguros. Plano por regra provisória até o motor de score.</p>

      <div className="acoes">
        <button className="btn secundario" onClick={onVoltar}>Voltar</button>
        <button className="btn texto" onClick={onReiniciar}>Recomeçar</button>
        <button className="btn primario">{acaoBussola === "RESULTADO_PRELIMINAR" ? "Concluir com um gerente" : `Contratar ${pl.nome}`}</button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Componentes de apoio
// --------------------------------------------------------------------------
function LinhaCampo({ campo, c }) {
  const o = ORIGEM[c.origem];
  return (
    <li className="campo">
      <span className="campo-nome">{CAMPOS[campo]}</span>
      <span className="campo-valor" title={c.nota}>{valorTexto(campo, c)}</span>
      <span className={`chip ${o.classe}`}>{o.rotulo}</span>
    </li>
  );
}

function Progresso({ atual, total }) {
  return (
    <div className="progresso" aria-label={`Etapa ${atual} de ${total}`}>
      <div className="barra"><div style={{ width: `${(100 * atual) / total}%` }} /></div>
      <small>Etapa {atual} de {total}</small>
    </div>
  );
}

// Sem plano aqui: o cliente só conhece o plano no Resultado, depois da análise completa.
function Painel({ e }) {
  const conf = confiancaGeral(e);
  const campos = camposVisiveis(e).map(([, c]) => c);
  const sabidos = campos.filter((c) => c.confianca === "alta").length;
  return (
    <aside className="painel" aria-live="polite">
      <h3>Seu imóvel até agora</h3>
      <div className="painel-plano" key={sabidos}>
        <small>Informações confirmadas</small>
        <strong>{sabidos} de {campos.length}</strong>
      </div>
      <div className="medidor">
        <small>Confiança dos dados · {conf}%</small>
        <div className="barra"><div style={{ width: `${conf}%` }} /></div>
      </div>
      <ul className="lista-campos compacta">
        {camposVisiveis(e).map(([k, c]) => <LinhaCampo key={k} campo={k} c={c} />)}
      </ul>
      <p className="nota">Atualizado a cada resposta.</p>
    </aside>
  );
}
