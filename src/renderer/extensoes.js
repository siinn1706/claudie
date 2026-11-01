// The Plugins, Skills and Connectors tabs of Personalizar, and the pieces the
// Details panel shares with them (the log view and the live output of a
// connector sign-in). Everything the CLI, a marketplace or a skill file says is
// third-party text: it is escaped before it reaches innerHTML, and log text
// goes in with textContent.
//
// Each tab keeps its state in module variables and a render token: an answer
// that arrives after the person moved to another tab is dropped.

(() => {
  const MCP_NOME = /^[\w.-]{1,64}$/;
  const mcpNomeOk = (n) => typeof n === "string" && MCP_NOME.test(n) && !n.startsWith("-");
  const ESCOPOS = [["user", "todos os projetos"], ["project", "compartilhado no projeto"], ["local", "só neste projeto"]];
  const erroDe = (e) => ({ erro: String(e?.message || e) });

  // ---- shared: log view and sign-in output ------------------------------------------------
  window.extLogView = (pre, linhas) => {
    pre.textContent = linhas?.length ? linhas.join("\n") : window.t("Nada registrado ainda.");
    pre.scrollTop = pre.scrollHeight;
  };
  // the sign-in being run (one at a time): painel.js and the Connectors tab draw from it
  const login = { nome: "", linhas: [], fim: false, codigo: null, terminal: false };
  window.extLogin = login;
  window.extLoginInicia = (nome) => { Object.assign(login, { nome, linhas: [], fim: false, codigo: null, terminal: false }); };
  aoEvento((ev) => {
    if (ev.tipo !== "mcp_login" || ev.nome !== login.nome) return;
    if (ev.fim) {
      login.fim = true; login.codigo = ev.codigo;
      dispatchEvent(new CustomEvent("extlogin"));
      return;
    }
    login.linhas.push(ev.linha);
    if (login.linhas.length > 200) login.linhas.shift();
    for (const pre of document.querySelectorAll(".ext-log[data-login]")) if (pre.dataset.login === ev.nome) window.extLogView(pre, login.linhas);
  });
  window.extRotuloLogin = () => window.t(login.fim ? (login.codigo === 0 ? "Conectado." : "O login não terminou.") : "Siga as instruções no navegador que abriu…");
  const rotuloLogin = () => login.fim ? (login.codigo === 0 ? "Conectado." : "O login não terminou.") : "Siga as instruções no navegador que abriu…";

  // ---- state ----------------------------------------------------------------------------
  const tok = { plugins: 0, skills: 0, conectores: 0 };
  let ctx = null; // { aba, corpo, nota, meu }
  const ativa = (c) => ctx === c && abaP === c.aba && tok[c.aba] === c.meu && c.corpo.isConnected;

  const P = { dados: null, erro: "", carregando: false, msg: null, ocupado: false, confirma: "", escopo: "user", busca: "", fonte: "", fonteConfirma: "" };
  const S = { dados: null, erro: "", carregando: false, msg: null, confirma: "", form: null, ocupado: false };
  const C = { catalogo: null, semClaude: false, painel: null, erro: "", carregando: false, msg: null, ocupado: "", adicionados: new Set(), logsAbertos: new Set(), logTxt: new Map() };

  const btn = (acao, txt, dados = {}, cls = "", off = false) =>
    `<button class="btn ${cls}" data-ext="${acao}" ${Object.entries(dados).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ")}${off ? " disabled" : ""}>${txt}</button>`;
  const aviso = (m) => !m ? "" : `<p class="ext-msg ${m.erro ? "erro" : "ok"}">${esc(m.erro || m.ok)}${m.terminal ? ` ${window.t("Termine no terminal: abra o Claude Code e rode o comando de plugin lá.")}` : ""}</p>`;
  const semClaudeHtml = (titulo) => `<h3>${titulo}</h3><p class="pz-vazio">${window.t("Instale o Claude Code neste computador para gerenciar isso (o app usa o comando claude).")}</p>`;
  const escopoSel = (valor, k) => `<select data-ext-campo="${k}">${ESCOPOS.map(([v, n]) => `<option value="${v}"${valor === v ? " selected" : ""}>${n}</option>`).join("")}</select>`;
  const carregandoHtml = (txt) => `<p class="pz-vazio">${txt}</p>`;

  // ---- Plugins ---------------------------------------------------------------------------
  const ESCOPO_PLUGIN = ["user", "project", "local"];
  const geriveis = (p) => ESCOPO_PLUGIN.includes(p.escopo);

  function htmlPlugins() {
    if (P.dados?.semClaude) return semClaudeHtml("Plugins");
    const d = P.dados;
    let h = `<h3>Plugins</h3><p class="pz-desc">Plugins trazem comandos, skills e conectores. Eles vêm de marketplaces e rodam código de terceiros: confie na fonte antes de instalar.</p>${aviso(P.msg)}`;
    if (P.erro) h += `<p class="ext-msg erro">${esc(P.erro)}</p>`;
    if (!d) return h + (P.carregando ? carregandoHtml("Carregando…") : "");
    const off = P.ocupado;
    // marketplaces
    h += `<h3 class="pz-sub">Marketplaces</h3>`;
    h += d.mercados.length ? d.mercados.map((m) => `<div class="ext-linha"><span><b data-sem-traducao>${esc(m.nome)}</b><small data-sem-traducao>${esc(m.fonte)}</small></span>
      ${btn("mercado-atualiza", "Atualizar", { nome: m.nome }, "", off)}
      ${P.confirma === "m:" + m.nome ? btn("mercado-remove", "Confirmar remoção", { nome: m.nome }, "perigo", off) : btn("mercado-remove", "Remover", { nome: m.nome }, "", off)}</div>
      ${P.confirma === "m:" + m.nome ? `<p class="ext-msg erro">${window.t("Remover um marketplace desinstala os plugins que vieram dele.")}</p>` : ""}`).join("")
      : `<p class="pz-vazio">Nenhum marketplace adicionado.</p>`;
    h += `<div class="ext-form"><input type="text" data-ext-campo="fonte" value="${esc(P.fonte)}" placeholder="usuario/repositorio, https://… ou uma pasta" spellcheck="false" autocomplete="off">${escopoSel(P.escopo, "escopo")}
      ${btn("mercado-add", "Adicionar", {}, "forte", off || !P.fonte.trim())}${d.mercados.length ? btn("mercado-atualiza", "Atualizar todos", { nome: "" }, "", off) : ""}</div>`;
    if (P.fonteConfirma) h += `<p class="ext-msg">${window.t("Adicionar o marketplace {0} em «{1}»? Os plugins dele rodam código de terceiros.", `“${esc(P.fonteConfirma)}”`, esc(window.t((ESCOPOS.find(([v]) => v === P.escopo) || ESCOPOS[0])[1])))}</p>
      <div class="ext-form">${btn("mercado-add-ok", "Confirmar", {}, "forte", off)}${btn("mercado-add-cancela", "Cancelar", {}, "", off)}</div>`;
    // installed
    h += `<h3 class="pz-sub">Instalados <small>${d.instalados.length}</small></h3>`;
    h += d.instalados.length ? d.instalados.map((p) => {
      const g = geriveis(p), conf = P.confirma === "p:" + p.id + ":" + p.escopo;
      return `<div class="ext-linha"><span><b data-sem-traducao>${esc(p.id)}</b><small>${p.versao ? `<span data-sem-traducao>v${esc(p.versao)}</span> · ` : ""}${esc(window.t(p.escopo === "synced" ? "sincronizado do claude.ai" : (ESCOPOS.find(([v]) => v === p.escopo) || [0, p.escopo])[1]))} · ${p.ativo ? window.t("ativo") : window.t("desativado")}</small></span>
        ${g ? btn(p.ativo ? "plugin-desativar" : "plugin-ativar", p.ativo ? "Desativar" : "Ativar", { id: p.id, escopo: p.escopo }, "", off)
          + btn("plugin-atualizar", "Atualizar", { id: p.id, escopo: p.escopo }, "", off)
          + btn("plugin-desinstalar", conf ? "Confirmar remoção" : "Desinstalar", { id: p.id, escopo: p.escopo }, conf ? "perigo" : "", off) : ""}</div>`;
    }).join("") : `<p class="pz-vazio">Nenhum plugin instalado.</p>`;
    // available
    const jaTem = new Set(d.instalados.map((p) => p.id));
    const q = P.busca.trim().toLowerCase();
    const achados = d.disponiveis.filter((p) => !jaTem.has(p.id) && (!q || `${p.nome} ${p.descricao} ${p.mercado}`.toLowerCase().includes(q)));
    const MAX = 40;
    h += `<h3 class="pz-sub">Disponíveis <small>${d.disponiveis.length}</small></h3>
      <div class="ext-form"><input type="text" class="pz-busca" data-ext-campo="busca" value="${esc(P.busca)}" placeholder="Buscar plugins" spellcheck="false" autocomplete="off">${escopoSel(P.escopo, "escopo")}</div>`;
    h += achados.slice(0, MAX).map((p) => `<div class="ext-linha"><span><b data-sem-traducao>${esc(p.nome)}</b> <em class="ext-tag" data-sem-traducao>${esc(p.mercado)}</em><small data-sem-traducao>${esc(p.descricao)}</small></span>
      ${btn("plugin-instalar", "Instalar", { id: p.id, escopo: P.escopo }, "forte", off)}</div>`).join("");
    if (achados.length > MAX) h += `<p class="pz-vazio">${window.t("Mostrando {0} de {1}. Use a busca para achar o resto.", MAX, achados.length)}</p>`;
    else if (!achados.length) h += `<p class="pz-vazio">Nenhum plugin encontrado.</p>`;
    return h;
  }

  async function carregaPlugins(c, forca) {
    if (!P.dados || forca) P.carregando = true;
    redesenha(c);
    const r = await vivo.pluginsLista().catch(erroDe);
    if (!ativa(c)) return;
    P.carregando = false;
    if (r.erro) { P.erro = r.erro; } else { P.erro = ""; P.dados = r; }
    redesenha(c);
  }
  async function executaPlugin(c, chamada, okMsg) {
    P.ocupado = true; P.msg = null; P.confirma = ""; P.fonteConfirma = ""; redesenha(c);
    const r = await chamada().catch(erroDe);
    P.ocupado = false;
    if (r.erro) P.msg = { erro: r.erro, terminal: r.terminal };
    else { P.msg = { ok: r.mensagem || okMsg }; }
    if (!ativa(c)) return;
    redesenha(c);
    if (!r.erro) carregaPlugins(c, false);
  }

  // ---- Skills ----------------------------------------------------------------------------
  function htmlSkills() {
    if (S.dados?.semClaude) return semClaudeHtml("Skills");
    let h = `<h3>Skills</h3><p class="pz-desc">Uma skill é uma pasta com um arquivo SKILL.md que ensina o Claude a fazer algo do seu jeito. Ligar e desligar skills não é possível aqui: apague a que não quer mais.</p>${aviso(S.msg)}`;
    h += `<div class="pz-acoes">${btn("skill-nova", "Nova skill", {}, "forte")}${btn("skills-pasta", "Abrir pasta das suas skills", { origem: "user" })}${btn("skills-pasta", "Abrir pasta das skills do projeto", { origem: "projeto" })}</div>`;
    if (S.form) {
      const f = S.form;
      h += `<div class="ext-form coluna"><input type="text" data-ext-campo="nome" value="${esc(f.nome)}" placeholder="nome-da-skill" maxlength="64" spellcheck="false" autocomplete="off">
        <input type="text" data-ext-campo="descricao" value="${esc(f.descricao)}" placeholder="Quando o Claude deve usar esta skill (uma linha)" maxlength="500" spellcheck="false" autocomplete="off">
        <select data-ext-campo="escopo"><option value="user"${f.escopo === "user" ? " selected" : ""}>Para todos os projetos</option><option value="projeto"${f.escopo === "projeto" ? " selected" : ""}>Só para este projeto</option></select>
        <div class="ext-form">${btn("skill-cria", "Criar", {}, "forte", S.ocupado)}${btn("skill-cancela", "Cancelar")}</div></div>`;
    }
    if (S.erro) h += `<p class="ext-msg erro">${esc(S.erro)}</p>`;
    if (!S.dados) return h + (S.carregando ? carregandoHtml("Carregando…") : "");
    h += S.dados.skills.length ? S.dados.skills.map((s) => {
      const chave = `${s.origem}:${s.pasta}`;
      return `<div class="ext-linha"><span><b data-sem-traducao>${esc(s.pasta)}</b> <em class="ext-tag">${window.t(s.origem === "user" ? "suas" : "do projeto")}</em><small data-sem-traducao>${esc(s.descricao)}</small></span>
        ${btn("skill-abre", "Abrir", { origem: s.origem, pasta: s.pasta })}
        ${btn("skill-apaga", S.confirma === chave ? "Confirmar remoção" : "Apagar", { origem: s.origem, pasta: s.pasta }, S.confirma === chave ? "perigo" : "")}</div>`;
    }).join("") : `<p class="pz-vazio">Nenhuma skill sua ainda.</p>`;
    if (S.dados.comandosPlugin?.length) h += `<details class="pz-lista"><summary>${window.t("Comandos e skills de plugins")} (${S.dados.comandosPlugin.length})</summary>
      ${S.dados.comandosPlugin.map((c) => `<div class="ext-linha"><span><b data-sem-traducao>/${esc(c.nome)}</b><small data-sem-traducao>${esc(c.descricao)}</small></span></div>`).join("")}</details>`;
    return h;
  }
  async function carregaSkills(c) {
    if (!S.dados) S.carregando = true;
    redesenha(c);
    const r = await vivo.skillsLista().catch(erroDe);
    if (!ativa(c)) return;
    S.carregando = false;
    if (r.erro) S.erro = r.erro; else { S.erro = ""; S.dados = r; }
    redesenha(c);
  }

  // ---- Connectors ------------------------------------------------------------------------
  const MCP_ESTADO = { connected: "conectado", failed: "falhou", "needs-auth": "precisa de login", pending: "conectando", disabled: "desligado" };
  function cartao(x) {
    const add = x.jaAdicionado || C.adicionados.has(x.id), ocupado = C.ocupado === x.id;
    const entrando = login.nome === x.id && !login.fim;
    let acoes = "";
    if (add) {
      acoes = `<span class="ext-tag ok">${window.t("Adicionado")}</span>`;
      if (x.auth === "oauth") acoes += btn("catalogo-entrar", "Entrar", { id: x.id }, "", entrando || !!C.ocupado);
    } else acoes = btn("catalogo-add", "Adicionar", { id: x.id }, "forte", !!C.ocupado);
    const logTxt = login.nome === x.id ? `<p class="ext-msg">${window.t(rotuloLogin())}</p><pre class="ext-log" data-login="${esc(x.id)}"></pre>${login.fim && login.codigo !== 0 && C.painel?.terminalExterno ? `<div class="ext-form">${btn("catalogo-terminal", "Abrir no terminal", { id: x.id })}</div>` : ""}` : "";
    return `<div class="ext-card"><div class="ext-card-topo"><b data-sem-traducao>${esc(x.nome)}</b><em class="ext-tag">${esc(window.t(x.categoria))}</em></div>
      <p>${esc(window.t(x.descricao))}</p><div class="ext-card-acoes">${ocupado ? "…" : acoes}</div>${logTxt}</div>`;
  }
  function linhaConector(x) {
    const nome = x.nome, podeLogs = !x.embutido && mcpNomeOk(nome) && x.escopo !== "claudeai", aberto = C.logsAbertos.has(nome);
    const entrando = login.nome === nome && !login.fim;
    return `<div class="ext-linha vertical"><div class="ext-linha-topo"><span><i class="ext-dot ${esc(x.estado)}"></i><b data-sem-traducao>${esc(nome)}</b> <em class="ext-tag">${esc(window.t(MCP_ESTADO[x.estado] || x.estado))}</em></span>
      ${x.estado === "needs-auth" && podeLogs ? btn("catalogo-entrar", "Entrar", { id: nome }, "", entrando || !!C.ocupado) + btn("catalogo-reconectar", "Reconectar", { id: nome, escopo: x.escopo }) : ""}
      ${podeLogs ? btn("logs", aberto ? "Esconder logs" : "Logs", { nome }) : ""}</div>
      ${x.erro && x.estado === "failed" ? `<p class="ext-msg erro" data-sem-traducao>${esc(x.erro)}</p>` : ""}
      ${aberto ? `<pre class="ext-log" data-logs="${esc(nome)}"></pre><div class="ext-form">${btn("logs-atualiza", "Atualizar", { nome })}${btn("logs-limpa", "Limpar", { nome })}</div>` : ""}</div>`;
  }
  function htmlConectores() {
    if (C.semClaude) return semClaudeHtml("Conectores");
    let h = `<h3>Conectores</h3><p class="pz-desc">Conectores dão ao Claude acesso a outros serviços. Adicionar não envia nenhuma credencial: o login é feito pelo próprio Claude Code.</p>${aviso(C.msg)}`;
    if (C.erro) h += `<p class="ext-msg erro">${esc(C.erro)}</p>`;
    h += `<h3 class="pz-sub">Catálogo</h3>`;
    h += C.catalogo ? `<div class="ext-grade">${C.catalogo.map(cartao).join("")}</div>` : carregandoHtml("Carregando…");
    const con = C.painel?.conectores;
    h += `<h3 class="pz-sub">Conectores desta conversa</h3>`;
    h += con ? (con.length ? con.map(linhaConector).join("") : `<p class="pz-vazio">Nenhum conector configurado.</p>`) : carregandoHtml("Carregando…");
    return h;
  }
  async function carregaConectores(c) {
    C.carregando = true; redesenha(c);
    const cat = vivo.conectoresCatalogo().catch(erroDe), pn = vivo.painel().catch(erroDe);
    cat.then((r) => {
      if (!ativa(c)) return;
      if (r.erro) C.erro = r.erro; else { C.erro = ""; C.semClaude = !!r.semClaude; C.catalogo = r.itens; }
      redesenha(c);
    });
    pn.then((r) => {
      if (!ativa(c)) return;
      C.painel = r.erro && !r.conectores ? { conectores: [] } : r;
      redesenha(c);
      for (const nome of C.logsAbertos) preencheLogs(c, nome);
    });
    await Promise.all([cat, pn]);
  }
  async function preencheLogs(c, nome) {
    const r = await vivo.mcpLogs(nome).catch(erroDe);
    if (!ativa(c)) return;
    C.logTxt.set(nome, r.linhas || []);
    const pre = [...c.corpo.querySelectorAll(".ext-log[data-logs]")].find((p) => p.dataset.logs === nome);
    if (pre) window.extLogView(pre, r.linhas || []);
  }

  // ---- drawing and events ---------------------------------------------------------------
  const HTML = { plugins: htmlPlugins, skills: htmlSkills, conectores: htmlConectores };
  function redesenha(c) {
    if (!ativa(c)) return;
    // keep a field's focus and caret while the list is redrawn under it
    const ae = document.activeElement, campo = ae && c.corpo.contains(ae) ? ae.dataset?.extCampo : null, ini = campo ? ae.selectionStart : 0, fim = campo ? ae.selectionEnd : 0, rolagem = c.corpo.scrollTop;
    c.corpo.innerHTML = HTML[c.aba]();
    c.corpo.scrollTop = rolagem;
    if (campo) { const n = c.corpo.querySelector(`[data-ext-campo="${campo}"]`); if (n) { n.focus(); try { n.setSelectionRange(ini, fim); } catch {} } }
    for (const pre of c.corpo.querySelectorAll(".ext-log[data-login]")) window.extLogView(pre, login.linhas);
    for (const pre of c.corpo.querySelectorAll(".ext-log[data-logs]")) window.extLogView(pre, C.logTxt.get(pre.dataset.logs) || []);
  }

  const CAMPOS = {
    plugins: (k, v) => { if (k === "busca" || k === "fonte" || k === "escopo") P[k] = v; return k !== "fonte"; },
    skills: (k, v) => { if (S.form) S.form[k] = v; return false; },
    conectores: () => false,
  };
  const ACOES = {
    "mercado-add": (c) => { P.fonteConfirma = P.fonte.trim(); redesenha(c); },
    "mercado-add-cancela": (c) => { P.fonteConfirma = ""; redesenha(c); },
    "mercado-add-ok": (c) => { const fonte = P.fonteConfirma; executaPlugin(c, () => vivo.mercadoAcao({ acao: "add", fonte, escopo: P.escopo }), "Marketplace adicionado.").then(() => { if (!P.msg?.erro) P.fonte = ""; }); },
    "mercado-atualiza": (c, d) => executaPlugin(c, () => vivo.mercadoAcao({ acao: "update", nome: d.nome }), "Marketplace atualizado."),
    "mercado-remove": (c, d) => { if (P.confirma !== "m:" + d.nome) { P.confirma = "m:" + d.nome; redesenha(c); } else executaPlugin(c, () => vivo.mercadoAcao({ acao: "remove", nome: d.nome }), "Marketplace removido."); },
    "plugin-instalar": (c, d) => executaPlugin(c, () => vivo.pluginAcao({ acao: "instalar", id: d.id, escopo: d.escopo }), "Plugin instalado."),
    "plugin-ativar": (c, d) => executaPlugin(c, () => vivo.pluginAcao({ acao: "ativar", id: d.id, escopo: d.escopo }), "Plugin ativado."),
    "plugin-desativar": (c, d) => executaPlugin(c, () => vivo.pluginAcao({ acao: "desativar", id: d.id, escopo: d.escopo }), "Plugin desativado."),
    "plugin-atualizar": (c, d) => executaPlugin(c, () => vivo.pluginAcao({ acao: "atualizar", id: d.id, escopo: d.escopo }), "Plugin atualizado."),
    "plugin-desinstalar": (c, d) => {
      const chave = "p:" + d.id + ":" + d.escopo;
      if (P.confirma !== chave) { P.confirma = chave; redesenha(c); } else executaPlugin(c, () => vivo.pluginAcao({ acao: "desinstalar", id: d.id, escopo: d.escopo }), "Plugin desinstalado.");
    },

    "skill-nova": (c) => { S.form = { nome: "", descricao: "", escopo: "user" }; S.msg = null; redesenha(c); c.corpo.querySelector('[data-ext-campo="nome"]')?.focus(); },
    "skill-cancela": (c) => { S.form = null; redesenha(c); },
    "skill-cria": async (c) => {
      S.ocupado = true; S.msg = null; redesenha(c);
      const r = await vivo.skillCriar({ ...S.form }).catch(erroDe);
      S.ocupado = false;
      if (r.erro) S.msg = { erro: r.erro }; else { S.msg = { ok: window.t("Skill criada: {0}", r.pasta) }; S.form = null; }
      if (!ativa(c)) return;
      redesenha(c);
      if (!r.erro) carregaSkills(c);
    },
    "skill-abre": async (c, d) => { const r = await vivo.skillAbrir({ origem: d.origem, pasta: d.pasta }).catch(erroDe); if (r.erro) c.nota(r.erro, true); },
    "skills-pasta": async (c, d) => { const r = await vivo.skillsPasta({ origem: d.origem }).catch(erroDe); if (r.erro) c.nota(r.erro, true); },
    "skill-apaga": async (c, d) => {
      const chave = `${d.origem}:${d.pasta}`;
      if (S.confirma !== chave) { S.confirma = chave; redesenha(c); return; }
      S.confirma = ""; S.msg = null;
      const r = await vivo.skillApagar({ origem: d.origem, pasta: d.pasta }).catch(erroDe);
      S.msg = r.erro ? { erro: r.erro } : { ok: window.t("Skill apagada: {0}", d.pasta) };
      if (!ativa(c)) return;
      redesenha(c);
      if (!r.erro) carregaSkills(c);
    },

    "catalogo-add": async (c, d) => {
      const x = C.catalogo?.find((e) => e.id === d.id);
      if (!x) return;
      if (x.auth === "chave") {
        // a key goes in a header the person types: the form in the Details panel does that
        fechaPersonal();
        window.mcpAbreForm?.({ transporte: x.transporte, url: x.url, nome: x.id, cabecalhos: "Authorization: Bearer " });
        return;
      }
      C.ocupado = x.id; C.msg = null; redesenha(c);
      const r = await vivo.mcpAdicionar({ nome: x.id, transporte: x.transporte, url: x.url, escopo: "user" }).catch(erroDe);
      C.ocupado = "";
      if (r.erro) C.msg = { erro: r.erro }; else { C.adicionados.add(x.id); C.msg = { ok: window.t("{0} adicionado. Clique em Entrar para fazer o login.", x.nome) }; }
      redesenha(c);
    },
    "catalogo-entrar": async (c, d) => {
      window.extLoginInicia(d.id); C.msg = null; redesenha(c);
      const r = await vivo.mcpAcao("entrar", d.id, "user").catch(erroDe);
      if (r.erro) { window.extLoginInicia(""); C.msg = { erro: r.erro }; }
      redesenha(c);
    },
    "catalogo-reconectar": async (c, d) => {
      C.msg = null;
      const r = await vivo.mcpAcao("reconectar", d.id, d.escopo).catch(erroDe);
      if (r.erro) C.msg = { erro: r.erro };
      if (!ativa(c)) return;
      carregaConectores(c);
    },
    "catalogo-terminal": async (c, d) => { const r = await vivo.mcpAcao("terminal", d.id, "user").catch(erroDe); if (r.erro) c.nota(r.erro, true); },
    "logs": (c, d) => {
      if (C.logsAbertos.has(d.nome)) C.logsAbertos.delete(d.nome); else C.logsAbertos.add(d.nome);
      redesenha(c);
      if (C.logsAbertos.has(d.nome)) preencheLogs(c, d.nome);
    },
    "logs-atualiza": async (c, d) => { await preencheLogs(c, d.nome); },
    "logs-limpa": async (c, d) => { await vivo.mcpLogsLimpar(d.nome).catch(() => {}); C.logTxt.delete(d.nome); await preencheLogs(c, d.nome); },
  };

  // a sign-in that ended: refresh the connectors and the list
  addEventListener("extlogin", () => {
    if (ctx && ativa(ctx) && ctx.aba === "conectores") carregaConectores(ctx);
  });

  window.desenhaExtensoes = (aba, corpo, nota) => {
    for (const k of Object.keys(tok)) tok[k]++;
    corpo.onclick = corpo.oninput = corpo.onchange = null;
    if (!HTML[aba]) { ctx = null; return false; }
    const c = ctx = { aba, corpo, nota, meu: tok[aba] };
    corpo.onclick = (ev) => {
      const b = ev.target.closest("[data-ext]");
      if (!b || b.disabled) return;
      ACOES[b.dataset.ext]?.(c, b.dataset);
    };
    const campo = (ev) => {
      const el = ev.target.closest("[data-ext-campo]");
      if (!el) return;
      if (CAMPOS[aba](el.dataset.extCampo, el.value)) redesenha(c);
      else if (aba === "plugins" && el.dataset.extCampo === "fonte") {
        // the add button follows the field without redrawing (and losing the caret)
        const b = corpo.querySelector('[data-ext="mercado-add"]');
        if (b) b.disabled = P.ocupado || !P.fonte.trim();
      }
    };
    corpo.oninput = campo; corpo.onchange = campo;
    if (aba === "plugins") carregaPlugins(c, true);
    else if (aba === "skills") carregaSkills(c);
    else carregaConectores(c);
    return true;
  };
})();
