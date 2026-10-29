import { useMemo, useState } from "react";
import { APRESENTACAO, CASOS, DESTAQUES } from "./casos.js";
import {
  CONFIRMO, DESTINO_REVISAO, NAO_E_O_CASO, NAO_SEI, PEND, REST, SEM, itensDeclaracao, regras,
  acao, brl, coberturas, copia, elegibilidade, estadoInicial, observacoes, pendencias,
  POR_ID, decisoes, fraseEstimativa,
  avaliacaoPlano, proxima, responder, responderDeclaracao, responderFaixa, simularOpcoes, sugestaoDe,
} from "./engine.js";
import { ASSISTENCIAS, COBERTURAS, ORDEM, PLANOS } from "./planos.js";
import { PREMISSAS_PRECO, precoPlano, reais } from "./preco.js";
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
  tipo: "Tipo de imóvel", padrao: "Padrão construtivo", uso: "Uso", vinculo: "Sua relação", material: "Paredes externas",
  obra: "Obra", area: "Área", bens: "Bens no imóvel", seguro_bb: "Seguro BB neste endereço",
};
const VALORES = {
  APARTAMENTO: "Apartamento", CASA: "Casa", CASA_CONDOMINIO: "Casa em condomínio",
  ALVENARIA: "Alvenaria", MADEIRA: "Madeira", MADEIRA_PREFABRICADA: "Madeira pré-fabricada", MISTA: "Mista",
  ALVENARIA_PREDOMINANTE: "Predominância de alvenaria", COMBUSTIVEL_PREDOMINANTE: "Predominância de madeira",
  NAO: "Sem obra", MANUTENCAO: "Só manutenção", EM_ANDAMENTO: "Em andamento",
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
  // "Editar" de uma estimativa na declaração abre a página de faixa daquele campo e depois volta
  const [editando, setEditando] = useState(null);
  // respostas da declaração ficam aqui para não se perderem ao ir editar uma estimativa e voltar
  const [respDeclaracao, setRespDeclaracao] = useState({});
  // plano e valores escolhidos no Resultado; vendoValor abre a página de valor (Contratar)
  const [escolha, setEscolha] = useState(null);
  const [vendoValor, setVendoValor] = useState(false);
  const [vendoEspecialista, setVendoEspecialista] = useState(false);
  const e = historico[historico.length - 1];
  // Uma jornada só, a mesma do lote: perguntas de refino (P3) entram quando valem, e o cliente pode pular.
  const passo = etapa === "fluxo" && !editando ? proxima(e) : null;
  const fim = etapa === "fluxo" && !editando && passo === null;
  const etapaAtual = etapa === "inicio" ? 0 : fim ? (vendoValor ? 4 : 3) : editando || passo?.tipo === "declaracao" ? 2 : 1;

  const sairDoValor = () => { setEscolha(null); setVendoValor(false); setVendoEspecialista(false); };
  const limpar = () => { setEtapa("inicio"); setEditando(null); setRespDeclaracao({}); sairDoValor(); };
  const trocarCaso = (id) => {
    setCasoId(id);
    setHistorico([estadoInicial(CASOS.find((c) => c.imovel_id === id))]);
    limpar();
  };
  const avancar = (novo) => { setHistorico((h) => [...h, novo]); sairDoValor(); };
  const voltar = () => { sairDoValor(); historico.length > 1 ? setHistorico((h) => h.slice(0, -1)) : setEtapa("inicio"); };
  const reiniciar = () => { setHistorico([estadoInicial(caso)]); limpar(); };
  const salvarEdicao = (novo) => { avancar(novo); setEditando(null); };

  return (
    <div className="app">
      <header className="topo">
        <div className="topo-in">
          <Marca />
          <label className="demo">
            <span>Modo apresentação · imóvel da base de teste</span>
            <select value={casoId} onChange={(ev) => trocarCaso(ev.target.value)}>
              <optgroup label="Jornadas da apresentação">
                {APRESENTACAO.map((c) => <option key={c.imovel_id} value={c.imovel_id}>{c.nome} · {c.jornada.jornada}</option>)}
              </optgroup>
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

      <main className={`grade${vendoEspecialista ? " larga" : ""}`}>
        <section className="principal">
          {!vendoEspecialista && <Etapas atual={etapaAtual} desfecho={fim ? acao(e)[0] : null} />}
          {etapa === "inicio" && <Inicio e={e} onComecar={() => setEtapa("fluxo")} />}
          {passo?.tipo === "pergunta" && (
            <Pergunta key={e.respondidas.length + passo.p.id} e={e} passo={passo}
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
          {fim && !vendoValor && !vendoEspecialista && (
            <Resultado e={e} inicial={escolha} onVoltar={voltar} onReiniciar={reiniciar}
              onEspecialista={() => { setVendoEspecialista(true); window.scrollTo(0, 0); }}
              onContratar={(plano, valores) => { setEscolha({ plano, valores }); setVendoValor(true); window.scrollTo(0, 0); }} />
          )}
          {fim && vendoEspecialista && (
            <Especialista e={e} historico={historico} respDeclaracao={respDeclaracao}
              onVoltar={() => { setVendoEspecialista(false); window.scrollTo(0, 0); }} />
          )}
          {fim && vendoValor && <Valor e={e} escolha={escolha} onVoltar={() => { setVendoValor(false); window.scrollTo(0, 0); }} />}
        </section>
      </main>
      <footer className="rodape">
        Protótipo acadêmico do Datathon Ibmec × BB Seguros, feito pelo Time Vector. Não é um canal oficial de contratação.
      </footer>
    </div>
  );
}

// Logotipo oficial: coloque o arquivo em frontend/public/logos/bb-seguros.svg. Sem ele, aparece a assinatura em texto.
function Marca() {
  const [logo, setLogo] = useState(true);
  return (
    <div className="marca">
      {logo
        ? <img className="marca-logo" src="/logos/bb-seguros.svg" alt="BB Seguros" onError={() => setLogo(false)} />
        : <span className="marca-bb" role="img" aria-label="BB Seguros"><b>BB</b><span>Seguros</span></span>}
      <span className="marca-div" aria-hidden />
      <div className="marca-txt">
        <strong>Seguro Residencial</strong>
        <small>Protótipo · Time Vector</small>
      </div>
    </div>
  );
}

// Etapas finais conforme o desfecho: plano e valor, especialista ou revisão da apólice.
const ETAPAS = ["Seus dados", "Perguntas", "Confirmação"];
const ULTIMA = { ENCAMINHAR_HUMANO: "Especialista", REVISAO_APOLICE: "Sua apólice" };
function Etapas({ atual, desfecho }) {
  const finais = ULTIMA[desfecho] ? [ULTIMA[desfecho]] : ["Seu plano", "Valor"];
  return (
    <ol className="etapas" aria-label="Etapas da contratação">
      {[...ETAPAS, ...finais].map((t, i) => (
        <li key={t} className={i < atual ? "feita" : i === atual ? "atual" : ""} aria-current={i === atual ? "step" : undefined}>
          <span className="etapa-num" aria-hidden>{i < atual ? "✓" : i + 1}</span>
          <span className="etapa-txt">{t}</span>
        </li>
      ))}
    </ol>
  );
}

// --------------------------------------------------------------------------
// Telas
// --------------------------------------------------------------------------
function Inicio({ e, onComecar }) {
  const decisao = decisoes(e).length;
  const campos = camposVisiveis(e);
  const sabidos = campos.filter(([, c]) => c.origem !== "AUSENTE").length;
  return (
    <div className="cartao entrada">
      {e.caso.jornada && (
        <p className="jornada-demo"><b>{e.caso.jornada.jornada}</b> · {e.caso.jornada.roteiro}</p>
      )}
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

      <button className="btn primario largo" onClick={onComecar}>{decisao === 0 ? "Confirmar dados" : "Começar"}</button>
    </div>
  );
}

const Pergunta = (props) =>
  PERGUNTAS_FAIXA.has(props.passo.p.id) ? <PerguntaFaixa {...props} /> : <PerguntaOpcoes {...props} />;

function PerguntaOpcoes({ e, passo, onResponder, onPular, onVoltar }) {
  const { p, nivel } = passo;
  const opcoes = p.opcoes(e);
  const sug = sugestaoDe(p, e);
  const [sel, setSel] = useState(sug);
  const [ajuda, setAjuda] = useState(false);
  const efeitos = useMemo(() => simularOpcoes(p, e), [p, e]);

  const feitas = e.respondidas.length + (e.declaracao ? 1 : 0);
  const restantes = decisoes(e).length + (e.declaracao ? 0 : 1)
    + (nivel === 3 ? 1 : 0);
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
// O que muda num plano alternativo em relação ao recomendado.
function diferenca(ver, recomendado) {
  const nomes = (ids) => ids.map((c) => COBERTURAS[c].toLowerCase()).join(", ");
  const maior = ORDEM.indexOf(ver) > ORDEM.indexOf(recomendado);
  const dif = maior ? PLANOS[ver].coberturas.filter((c) => !PLANOS[recomendado].coberturas.includes(c))
    : PLANOS[recomendado].coberturas.filter((c) => !PLANOS[ver].coberturas.includes(c));
  return maior ? `Acrescenta ${nomes(dif)}.` : `Fica sem ${nomes(dif)}.`;
}

const qtd = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// Grupo recolhido na tela final (coberturas, assistências): o título mostra o resumo; clicar abre o conteúdo.
function Grupo({ titulo, resumo, children }) {
  const [aberto, setAberto] = useState(false);
  return (
    <section className="grupo">
      <button className="grupo-topo" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <span className="grupo-titulo">{titulo}</span>
        <span className="grupo-resumo">{resumo}</span>
        <span className="grupo-seta" aria-hidden>{aberto ? "▴" : "▾"}</span>
      </button>
      {aberto && <div className="grupo-corpo">{children}</div>}
    </section>
  );
}

// Uma cobertura: nome e valor (o sugerido, já preenchido). Em "Personalizar coberturas", mostra o ajuste
// dentro da faixa da cobertura (botões ou barra, no passo dela); em incêndio, avisa do rateio.
function CoberturaValor({ c, valor, onChange, extra, editando }) {
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
      </div>
      {editando && (
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

function Resultado({ e, inicial, onVoltar, onReiniciar, onContratar, onEspecialista }) {
  const [, motivo] = elegibilidade(e);
  const [acaoBussola, destino] = acao(e);
  // plano pelo score de aderência: o recomendado em destaque, os outros dois lado a lado abaixo
  const av = avaliacaoPlano(e);
  const recomendado = av.plano;
  const [ver, setVer] = useState(inicial?.plano ?? recomendado);
  const pend = pendencias(e);
  // valor de cada cobertura: começa no sugerido pelo cálculo e o cliente pode personalizar dentro da faixa
  const cobs = useMemo(() => coberturas(e), [e]);
  const [valores, setValores] = useState(inicial?.valores ?? {});
  const [personalizando, setPersonalizando] = useState(false);

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
          <button className="btn primario" onClick={onEspecialista}>Falar com especialista</button>
        </div>
      </div>
    );
  }

  const pl = PLANOS[ver];
  const listaCobs = cobs.filter((c) => pl.coberturas.includes(c.cobertura));
  const personalizadas = listaCobs.filter((c) => valores[c.cobertura] !== undefined && valores[c.cobertura] !== c.valor_sugerido).length;
  const rec = PLANOS[recomendado];
  return (
    <div className="cartao">
      <p className="sobretitulo">{acaoBussola === "RESULTADO_PRELIMINAR" ? "Resultado preliminar" : "Sua análise está pronta"}</p>
      <h1>O plano que mais combina com o seu imóvel</h1>
      {acaoBussola === "RESULTADO_PRELIMINAR" && (
        <div className="aviso">
          <strong>Antes de contratar, falta confirmar:</strong>
          <ul>{pend.map((p) => <li key={p}>{p}</li>)}</ul>
          <small>Um gerente verifica esses pontos antes da emissão.</small>
        </div>
      )}

      <section className="vitrine" aria-label="Planos">
        <article className={`plano-destaque ${ver === recomendado ? "sel" : ""}`}>
          <span className="selo-destaque">Mais indicado para você</span>
          <p className="plano-rotulo">Plano</p>
          <h2 className="plano-nome">{rec.nome}</h2>
          <div className="aderencia">
            <strong>{av.aderencia[recomendado]}%</strong>
            <span>de aderência ao seu perfil</span>
          </div>
          <div className="aderencia-barra" aria-hidden><div style={{ width: `${av.aderencia[recomendado]}%` }} /></div>
          {/* a 1ª justificativa do score repete a aderência, já mostrada em destaque acima */}
          <ul className="plano-porque">{av.justificativas.slice(1).map((t) => <li key={t}>{t}</li>)}</ul>
          <p className="plano-inclui">
            {qtd(rec.coberturas.length, "cobertura", "coberturas")} · {qtd(rec.assistencias.length, "pacote", "pacotes")} de assistência
          </p>
          {ver !== recomendado && (
            <button className="btn amarelo" onClick={() => setVer(recomendado)}>Ver detalhes do {rec.nome}</button>
          )}
        </article>

        <div className="plano-outros">
          {ORDEM.filter((k) => k !== recomendado).map((k) => (
            <button key={k} className={`plano-alt ${ver === k ? "sel" : ""}`} aria-pressed={ver === k} onClick={() => setVer(k)}>
              <span className="plano-alt-topo">
                <span className="plano-alt-nome">{PLANOS[k].nome}</span>
                <span className="plano-alt-pct">{av.aderencia[k]}%</span>
              </span>
              <span className="aderencia-barra fina" aria-hidden><span style={{ width: `${av.aderencia[k]}%` }} /></span>
              <span className="plano-alt-dif">{diferenca(k, recomendado)}</span>
              <span className="plano-alt-acao">{ver === k ? "Mostrando os detalhes abaixo" : "Comparar este plano"}</span>
            </button>
          ))}
        </div>
      </section>

      <h3 className="detalhe-titulo">O que o plano {pl.nome} inclui</h3>
      <Grupo titulo="Coberturas" resumo={`${listaCobs.length} incluídas`}>
        <ul className="cob-lista">
          {listaCobs.map((c) => (
            <CoberturaValor key={c.cobertura} c={c} editando={personalizando}
              extra={!PLANOS[recomendado].coberturas.includes(c.cobertura)}
              valor={valores[c.cobertura] ?? c.valor_sugerido}
              onChange={(v) => setValores((x) => ({ ...x, [c.cobertura]: v }))} />
          ))}
        </ul>
        <p className="nota">Valores sugeridos com os dados do seu imóvel.</p>
        <div className="grupo-acoes">
          {personalizadas > 0 && (
            <button className="btn texto" onClick={() => setValores({})}>Voltar aos valores sugeridos</button>
          )}
          <button className="btn secundario" aria-pressed={personalizando} onClick={() => setPersonalizando((x) => !x)}>
            {personalizando ? "Concluir personalização" : "Personalizar coberturas"}
          </button>
        </div>
      </Grupo>

      <Grupo titulo="Assistências" resumo={`${pl.assistencias.length} ${pl.assistencias.length === 1 ? "pacote" : "pacotes"}`}>
        <ul className="ass-lista">
          {pl.assistencias.map((k) => (
            <li key={k}><strong>{ASSISTENCIAS[k][0]}</strong><span>{ASSISTENCIAS[k][1]}</span></li>
          ))}
        </ul>
        <p className="nota">Assistências acompanham o plano e não são personalizáveis. Limites e quantidades conforme os manuais oficiais.</p>
      </Grupo>
      {observacoes(e).map((o) => <p key={o} className="assistencia"><strong>Atenção:</strong> {o}</p>)}

      <div className="numeros">
        <div><small>Confiança dos dados</small><strong>{confiancaGeral(e)}%</strong></div>
        <div><small>Coberturas personalizadas</small><strong>{personalizadas} de {pl.coberturas.length}</strong></div>
      </div>
      <p className="nota">Valores e pesos do score calculados com premissas do time, a validar com a BB Seguros.</p>

      <div className="acoes">
        <button className="btn secundario" onClick={onVoltar}>Voltar</button>
        <button className="btn texto" onClick={onReiniciar}>Recomeçar</button>
        <button className="btn primario" onClick={() => onContratar(ver, valores)}>
          {acaoBussola === "RESULTADO_PRELIMINAR" ? `Ver valor do ${pl.nome}` : `Contratar ${pl.nome}`}
        </button>
      </div>
    </div>
  );
}

// Página de valor: parcela e total anual estimados para o plano e os valores de cobertura escolhidos.
// O cálculo (preco.js) usa premissas do time, não a tarifa da BB Seguros.
function Valor({ e, escolha, onVoltar }) {
  const { plano, valores } = escolha;
  const pl = PLANOS[plano];
  const preliminar = acao(e)[0] === "RESULTADO_PRELIMINAR";
  const cobs = useMemo(() => coberturas(e), [e]);
  const p = useMemo(() => precoPlano(e, plano, cobs, valores), [e, plano, cobs, valores]);
  const [n, setN] = useState(p.parcelas.length);
  const [enviado, setEnviado] = useState(false);
  const parcela = p.parcelas[n - 1].valor;
  const escolhas = [...new Set([1, 3, 6, p.parcelas.length])].filter((x) => x <= p.parcelas.length);
  const sugerido = (k) => cobs.find((c) => c.cobertura === k).valor_sugerido;
  const personalizadas = p.linhas.filter((l) => l.valor !== sugerido(l.cobertura)).length;
  const valorDe = (k) => p.linhas.find((l) => l.cobertura === k)?.valor;
  const pct = (x) => `${(x * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  const mult = (x) => `×${String(x).replace(".", ",")}`;

  return (
    <div className="cartao">
      <p className="sobretitulo">{preliminar ? "Valor preliminar" : "Valor estimado do seu seguro"}</p>
      <h1>Plano {pl.nome}</h1>
      {preliminar && (
        <div className="aviso">
          <strong>O valor pode mudar depois da confirmação de:</strong>
          <ul>{pendencias(e).map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}

      <section className="preco-destaque" aria-live="polite">
        <p className="preco-rotulo">{n === 1 ? "À vista" : `Em ${n}x sem juros`}</p>
        <p className="preco-valor">{n === 1 ? "" : `${n}x de `}<strong>{reais(parcela)}</strong></p>
        <p className="preco-total">Total de {reais(p.total)} por 12 meses de proteção, com IOF</p>
        <div className="parcelas" role="radiogroup" aria-label="Número de parcelas">
          {escolhas.map((x) => (
            <button key={x} role="radio" aria-checked={n === x} className={n === x ? "sel" : ""} onClick={() => setN(x)}>
              {x === 1 ? "À vista" : `${x}x`}
            </button>
          ))}
        </div>
      </section>

      <div className="numeros">
        <div><small>Proteção do imóvel (incêndio)</small><strong>{brl(valorDe("INCENDIO_RAIO_EXPLOSAO_FUMACA"))}</strong></div>
        {valorDe("ROUBO_FURTO_ARROMBAMENTO") !== undefined
          ? <div><small>Seus bens contra roubo</small><strong>{brl(valorDe("ROUBO_FURTO_ARROMBAMENTO"))}</strong></div>
          : <div><small>Danos elétricos</small><strong>{brl(valorDe("DANOS_ELETRICOS"))}</strong></div>}
        <div>
          <small>Coberturas</small><strong>{p.linhas.length}</strong>
          {personalizadas > 0 && <small className="numeros-extra">{qtd(personalizadas, "personalizada", "personalizadas")} por você</small>}
        </div>
        <div><small>Assistências</small><strong>{qtd(p.assistencias.length, "pacote", "pacotes")}</strong></div>
      </div>

      <Grupo titulo="Como chegamos a esse valor" resumo={`${reais(p.total)} por ano`}>
        <table className="calculo">
          <thead><tr><th>Cobertura</th><th>Valor coberto</th><th>Por ano</th></tr></thead>
          <tbody>
            {p.linhas.map((l) => (
              <tr key={l.cobertura}><td>{COBERTURAS[l.cobertura]}</td><td>{brl(l.valor)}</td><td>{reais(l.premio)}</td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={2}>Soma das coberturas</td><td>{reais(p.somaCoberturas)}</td></tr>
            {p.fatores.length > 0 && (
              <tr>
                <td colSpan={2}>Ajuste do imóvel ({p.fatores.map((f) => `${f.rotulo} ${mult(f.mult)}`).join(", ")})</td>
                <td>{p.ajusteFatores < 0 ? "−" : "+"}{reais(Math.abs(p.ajusteFatores))}</td>
              </tr>
            )}
            <tr><td colSpan={2}>Assistências ({qtd(p.assistencias.length, "pacote", "pacotes")})</td><td>{reais(p.somaAssistencias)}</td></tr>
            <tr><td colSpan={2}>IOF ({pct(PREMISSAS_PRECO.iof)})</td><td>{reais(p.iof)}</td></tr>
            <tr className="calculo-total"><td colSpan={2}>Total por ano</td><td>{reais(p.total)}</td></tr>
          </tfoot>
        </table>
        <p className="nota">
          Cada cobertura custa uma taxa anual sobre o valor coberto. Parcelamento em até {PREMISSAS_PRECO.parcelas_max}x
          sem juros, com parcela mínima de {reais(PREMISSAS_PRECO.parcela_minima)}.
        </p>
      </Grupo>

      <p className="nota">
        Estimativa ilustrativa do Time Vector: taxas, fatores e custos de assistência são premissas de mercado,
        não a tarifa da BB Seguros (que não é pública). O valor final vem da cotação oficial.
      </p>

      {enviado && (
        <div className="sucesso" role="status">
          <strong>{preliminar ? "Pedido enviado a um gerente." : "Proposta pronta para pagamento."}</strong>{" "}
          {preliminar
            ? "Ele confirma as pendências e conclui a contratação com você."
            : "Neste protótipo a jornada termina aqui; o pagamento seguiria no app ou no site do BB."}
        </div>
      )}
      <div className="acoes">
        <button className="btn secundario" onClick={onVoltar}>Voltar ao plano</button>
        <button className="btn primario" disabled={enviado} onClick={() => setEnviado(true)}>
          {preliminar ? "Enviar para um gerente" : n === 1 ? `Contratar por ${reais(parcela)}` : `Contratar em ${n}x de ${reais(parcela)}`}
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Tela do Especialista (simulação): o que o atendimento recebe quando a Bússola encaminha o caso (B10).
// Mostra o que travou o fluxo, todas as regras, os dados do imóvel com origem, os sinais do cadastro
// e as respostas do cliente, para o especialista não repetir a entrevista.
// --------------------------------------------------------------------------
const ROTULO_REGRA = {
  e1_material: ["E1", "Material das paredes externas"], e2_obra: ["E2", "Obra ou reforma"],
  e3_seguro: ["E3", "Seguro BB no endereço"], e4_rural: ["E4", "Atividade rural"],
  e5_situacao: ["E5", "Tombado, desapropriado ou condenado"], e6_comercial: ["E6", "Atividade comercial"],
  e7_territorial: ["E7", "Favela ou comunidade urbana"], enq_vinculo: ["Vínculo", "Enquadramento do vínculo"],
};
// de onde vem cada regra: um campo do imóvel ou um item da declaração final
const CAMPO_REGRA = {
  e1_material: "material", e2_obra: "obra", e3_seguro: "seguro_bb", enq_vinculo: "vinculo",
  e4_rural: "rural", e5_situacao: "tombado", e6_comercial: "comercial", e7_territorial: "comunidade",
};
const SITUACAO = {
  [SEM]: { rotulo: "Sem restrição", classe: "ok" },
  [PEND]: { rotulo: "Pendente", classe: "est" },
  [REST]: { rotulo: "Restrição", classe: "falta" },
};
const RESPOSTA_DECLARACAO = Object.fromEntries(RESPOSTAS_DECLARACAO);
const DECISOES_ESPECIALISTA = ["Aceitar e liberar a contratação", "Pedir documentos ou vistoria", "Não aceitar e indicar outro produto"];

// Reconstrói, pelo histórico de estados, cada pergunta feita e a opção que o cliente escolheu.
function respostasDoCliente(historico, respDeclaracao) {
  const out = [];
  for (let i = 1; i < historico.length; i++) {
    const antes = historico[i - 1], depois = historico[i];
    if (!antes.declaracao && depois.declaracao) {
      for (const [campo, frase] of itensDeclaracao(antes))
        out.push({ chave: `declaracao-${campo}`, campo, texto: frase, declaracao: true,
          resposta: RESPOSTA_DECLARACAO[respDeclaracao[campo] ?? CONFIRMO] });
      continue;
    }
    for (const id of depois.respondidas.filter((x) => !antes.respondidas.includes(x))) {
      const p = POR_ID[id], alvo = JSON.stringify(depois.f[p.campo]);
      const op = p.opcoes(antes).find((_, k) => JSON.stringify(responder(antes, p, k, 2).f[p.campo]) === alvo);
      const mudou = JSON.stringify(antes.f[p.campo]) !== alvo;
      out.push({ chave: `${id}-${i}`, campo: p.campo, texto: p.texto(antes),
        resposta: op?.rotulo ?? (mudou ? valorTexto(p.campo, depois.f[p.campo]) : "Pulou a pergunta") });
    }
  }
  return out;
}

// O que disparou a regra: a última resposta do cliente sobre aquele ponto ou, sem resposta, o dado de origem.
function gatilho(regra, e, respostas) {
  const campo = CAMPO_REGRA[regra];
  const r = [...respostas].reverse().find((x) => x.campo === campo);
  if (r) return `${r.declaracao ? "Na declaração final" : "Na pergunta"} “${r.texto}”, o cliente respondeu: ${r.resposta}.`;
  const c = e.f[campo];
  if (!c) return "";
  return `${CAMPOS[campo]}: ${valorTexto(campo, c)} (${ORIGEM[c.origem].rotulo.toLowerCase()}${c.nota ? `: ${c.nota}` : ""}).`;
}

function sinaisDoCliente(c) {
  const sn = (x) => (x === "SIM" ? "Sim" : "Não");
  return [
    ["Este é o endereço principal", c.principal ? "Sim" : "Não"],
    ...(c.outro_endereco ? [["Outro endereço cadastrado", c.outro_endereco]] : []),
    ["Aluguel pago todo mês", c.pagamento_aluguel_recorrente === "SIM" ? `${brl(c.valor_aluguel_recorrente)}/mês` : "Não identificado"],
    ["Crédito compatível com aluguel recebido",
      c.credito_recorrente_compativel_aluguel === "SIM" ? `${brl(c.valor_medio_credito_recorrente)}/mês` : "Não identificado"],
    ["Parcela de financiamento imobiliário",
      c.parcela_financiamento_imobiliario > 0 ? `${brl(c.parcela_financiamento_imobiliario)}/mês` : "Não identificada"],
    ["Compras de material de construção (24 meses)", brl(c.gastos_material_construcao_24m)],
    ["Compras em vidraçaria (24 meses)", brl(c.gastos_vidracaria_24m)],
    ["Já tem seguro residencial BB", sn(c.possui_seguro_residencial)],
    ["Dependentes", String(c.quantidade_dependentes)],
    ["Pet informado", sn(c.possui_pet_informado)],
    ["Área no cadastro", c.area_cadastrada_m2 > 0 ? `${c.area_cadastrada_m2} m²` : "Não cadastrada"],
    ["Área estimada pelo modelo", `${Math.round(c.area_est_m2)} m² (${Math.round(c.area_est_min_m2)} a ${Math.round(c.area_est_max_m2)} m²)`],
    ["Bens estimados", `${brl(c.bens_est)} (${brl(c.bens_est_min)} a ${brl(c.bens_est_max)})`],
  ];
}

function Especialista({ e, historico, respDeclaracao, onVoltar }) {
  const c = e.caso;
  const [, destino] = acao(e);
  const r = regras(e);
  const respostas = useMemo(() => respostasDoCliente(historico, respDeclaracao), [historico, respDeclaracao]);
  const travas = Object.entries(r).filter(([, [s]]) => s === REST);
  const pend = Object.entries(r).filter(([, [s]]) => s === PEND);
  const av = avaliacaoPlano(e);
  const incendio = coberturas(e).find((x) => x.cobertura === "INCENDIO_RAIO_EXPLOSAO_FUMACA").valor_sugerido;
  const [abertoEm] = useState(() => new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }));
  const [parecer, setParecer] = useState("");
  const [decisao, setDecisao] = useState(null);

  return (
    <div className="cartao esp">
      <header className="esp-topo">
        <div>
          <p className="esp-sobre">Simulação · uso interno BB Seguros</p>
          <h1>Tela do Especialista</h1>
        </div>
        <dl className="esp-protocolo">
          <div><dt>Protocolo</dt><dd>ATD-{c.imovel_id.replace("IMO_CASO_", "")}</dd></div>
          <div><dt>Aberto em</dt><dd>{abertoEm}</dd></div>
          <div><dt>Fila</dt><dd>{destino}</dd></div>
        </dl>
      </header>

      <section className="esp-cliente">
        <strong>{c.nome}</strong>
        <span>Cliente {c.cliente_id} · Imóvel {c.imovel_id} · {c.uf}</span>
        <span>{c.endereco_txt}</span>
      </section>

      <section className="esp-trava" aria-labelledby="esp-trava-titulo">
        <h2 id="esp-trava-titulo">O que travou o fluxo</h2>
        {travas.map(([k, [, motivo, dest]]) => (
          <article key={k}>
            <span className="esp-regra">{ROTULO_REGRA[k][0]}</span>
            <div>
              <strong>{ROTULO_REGRA[k][1]}</strong>
              <p>{motivo[0].toUpperCase() + motivo.slice(1)}.</p>
              <p className="esp-gatilho">{gatilho(k, e, respostas)}</p>
              <small>Encaminhamento: {dest}</small>
            </div>
          </article>
        ))}
      </section>

      {pend.length > 0 && (
        <section className="esp-pend">
          <h3>Também a confirmar</h3>
          <ul>{pend.map(([k, [, m]]) => <li key={k}><b>{ROTULO_REGRA[k][0]}</b> {m}</li>)}</ul>
        </section>
      )}

      <div className="esp-grade">
        <section className="esp-bloco">
          <h3>Dados do imóvel</h3>
          <table className="esp-tabela">
            <thead><tr><th>Campo</th><th>Valor</th><th>Origem</th></tr></thead>
            <tbody>
              {Object.entries(e.f).map(([k, x]) => (
                <tr key={k}>
                  <td>{CAMPOS[k] ?? k}</td>
                  <td><strong>{valorTexto(k, x)}</strong>{x.nota && <small>{x.nota}</small>}</td>
                  <td><span className={`chip ${ORIGEM[x.origem].classe}`}>{ORIGEM[x.origem].rotulo}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="esp-bloco">
          <h3>Sinais nos dados do cliente</h3>
          <table className="esp-tabela">
            <tbody>
              {sinaisDoCliente(c).map(([rot, val]) => <tr key={rot}><td>{rot}</td><td><strong>{val}</strong></td></tr>)}
            </tbody>
          </table>
        </section>

        <section className="esp-bloco">
          <h3>Regras de elegibilidade</h3>
          <table className="esp-tabela">
            <tbody>
              {Object.entries(r).map(([k, [s, m]]) => (
                <tr key={k}>
                  <td><b>{ROTULO_REGRA[k][0]}</b> {ROTULO_REGRA[k][1]}{m && <small>{m}</small>}</td>
                  <td><span className={`chip ${SITUACAO[s].classe}`}>{SITUACAO[s].rotulo}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="esp-bloco">
          <h3>Respostas do cliente</h3>
          {respostas.length === 0
            ? <p className="nota">O cliente não respondeu perguntas: o caso travou só com os dados.</p>
            : (
              <ol className="esp-respostas">
                {respostas.map((x) => <li key={x.chave}><span>{x.texto}</span><strong>{x.resposta}</strong></li>)}
              </ol>
            )}
        </section>

        <section className="esp-bloco">
          <h3>Se o caso for aceito</h3>
          <table className="esp-tabela">
            <tbody>
              <tr><td>Plano indicado pelo score</td><td><strong>{PLANOS[av.plano].nome} ({av.aderencia[av.plano]}% de aderência)</strong></td></tr>
              <tr><td>Proteção do imóvel sugerida (incêndio)</td><td><strong>{brl(incendio)}</strong></td></tr>
              <tr><td>Confiança dos dados</td><td><strong>{confiancaGeral(e)}%</strong></td></tr>
            </tbody>
          </table>
        </section>
      </div>

      <section className="esp-bloco esp-parecer">
        <h3>Parecer do especialista</h3>
        <textarea rows={3} value={parecer} onChange={(ev) => setParecer(ev.target.value)} aria-label="Parecer do especialista"
          placeholder="Ex.: obra só na área externa, término previsto em 30 dias; aceitar após vistoria." />
        <div className="esp-decisoes">
          {DECISOES_ESPECIALISTA.map((d, i) => (
            <button key={d} className={`btn ${i === 0 ? "primario" : "secundario"}`} onClick={() => setDecisao(d)}>{d}</button>
          ))}
        </div>
        {decisao && (
          <div className="sucesso" role="status">
            <strong>Parecer registrado (simulação):</strong> {decisao}{parecer.trim() && ` · “${parecer.trim()}”`}
          </div>
        )}
      </section>

      <div className="acoes">
        <button className="btn secundario" onClick={onVoltar}>Voltar à tela do cliente</button>
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
