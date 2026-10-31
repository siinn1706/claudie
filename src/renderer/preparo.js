// When the app opens: is Claude Code installed, and is anyone signed in?
// Missing pieces get a card the person can't wave away: Claude Code is
// installed right there, then they sign in with their Claude account (or the
// Anthropic Console) or paste an API key. Once all is ready the card closes.

async function preparaClaude() {
  let s = await vivo.claudeChecar().catch(() => null);
  if (!s || (s.instalado && s.logado !== false)) return;
  const fundo = document.createElement("div");
  fundo.className = "prep-fundo";
  fundo.innerHTML = `<section class="prep" role="dialog" aria-modal="true" aria-labelledby="prepTitulo">
    <h2 id="prepTitulo">Preparar o Claude Code</h2>
    <p class="prep-sub">O Claudie roda sobre o Claude Code. Faltam só estes passos.</p>
    <ol>
      <li class="prep-passo" data-p="instalar"><i class="prep-ic"></i><div><b>Instalar o Claude Code</b><small></small><pre class="prep-log" hidden></pre><button class="btn" data-a="instalar" hidden>Tentar de novo</button></div></li>
      <li class="prep-passo" data-p="entrar"><i class="prep-ic"></i><div><b>Entrar</b><small></small>
        <div class="prep-opcoes" hidden><button class="btn forte" data-a="claude">Entrar com a conta Claude</button><button class="btn" data-a="console">Anthropic Console</button><button class="btn" data-a="chave">Usar uma chave de API</button></div>
        <div class="prep-link" hidden><button class="btn forte" data-a="abrir">Abrir a página de login</button><div class="prep-linha"><input class="prep-codigo" placeholder="Cole aqui o código, se a página mostrar um" spellcheck="false" autocomplete="off" /><button class="btn" data-a="codigo">Enviar</button></div><button class="btn leve" data-a="voltar">Escolher outro jeito</button></div>
        <div class="prep-chave" hidden><div class="prep-linha"><input type="password" class="prep-api" placeholder="Cole a chave da API (sk-ant-…)" spellcheck="false" autocomplete="off" /><button class="btn forte" data-a="salvaChave">Salvar</button></div><button class="btn leve" data-a="voltar">Escolher outro jeito</button></div>
      </div></li>
    </ol>
  </section>`;
  document.body.append(fundo);
  const q = (sel) => fundo.querySelector(sel), passo = (p) => q(`[data-p="${p}"]`);
  const marca = (p, estado, texto) => { const el = passo(p); el.dataset.estado = estado; el.querySelector("small").textContent = texto || ""; };
  const mostra = (sel) => ["opcoes", "link", "chave"].forEach((k) => (q(".prep-" + k).hidden = sel !== k));
  const log = q(".prep-log");
  let url = "", espera = 0;
  const paraEspera = () => { clearInterval(espera); espera = 0; };

  const fim = () => {
    paraEspera(); vivo.claudeEntrarCancela();
    marca("entrar", "ok", s.email ? t("Conectado como {0}", s.email) : s.metodo === "chave" ? "Chave de API salva" : "Conectado");
    setTimeout(() => { fundo.classList.add("saindo"); setTimeout(() => fundo.remove(), 250); }, 900);
  };
  const confere = async () => {
    s = (await vivo.claudeChecar().catch(() => null)) || s;
    if (s.logado !== false) fim();
  };
  const pedeEntrada = () => { marca("entrar", "agora", "Escolha como entrar."); mostra("opcoes"); };

  async function instala() {
    marca("instalar", "rodando", "Baixando e instalando com o instalador oficial…");
    q("[data-a='instalar']").hidden = true; log.hidden = false; log.textContent = "";
    const r = await vivo.claudeInstalar().catch((e) => ({ ok: false, erro: String(e) }));
    if (!r.ok) {
      marca("instalar", "erro", "Não deu para instalar. Veja o log, tente de novo ou instale em code.claude.com/docs/en/setup.");
      q("[data-a='instalar']").hidden = false; return;
    }
    log.hidden = true;
    s = (await vivo.claudeChecar().catch(() => null)) || { instalado: true, logado: false };
    marca("instalar", "ok", s.versao ? t("Claude Code {0} instalado", s.versao) : "Instalado");
    if (s.logado !== false) fim(); else pedeEntrada();
  }
  async function entra(daConsole) {
    url = ""; q(".prep-link [data-a='abrir']").disabled = true;
    marca("entrar", "rodando", "Abrindo o navegador para você entrar…"); mostra("link");
    const r = await vivo.claudeEntrar({ console: daConsole });
    if (r?.erro) { marca("entrar", "erro", r.erro); mostra("opcoes"); return; }
    paraEspera(); espera = setInterval(confere, 3000);
  }

  aoEvento((ev) => {
    if (ev.tipo !== "claude_setup" || !fundo.isConnected) return;
    if (ev.fonte === "instalar" && ev.linha) { log.textContent += ev.linha + "\n"; log.scrollTop = log.scrollHeight; }
    if (ev.fonte === "entrar") {
      const u = ev.linha?.match(/https?:\/\/\S+/)?.[0];
      if (u) { url = u; q(".prep-link [data-a='abrir']").disabled = false; marca("entrar", "rodando", "Termine o login no navegador. Se a página mostrar um código, cole abaixo."); }
      if (ev.fim) confere();
    }
  });
  fundo.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "instalar") instala();
    else if (a === "claude" || a === "console") entra(a === "console");
    else if (a === "abrir" && url) vivo.link(url);
    else if (a === "codigo") { const c = q(".prep-codigo"); if (await vivo.claudeCodigo(c.value)) { c.value = ""; marca("entrar", "rodando", "Código enviado, conferindo…"); } }
    else if (a === "chave") { mostra("chave"); q(".prep-api").focus(); }
    else if (a === "salvaChave") {
      const c = q(".prep-api"), v = c.value.trim(); if (!v) return;
      const r = await vivo.contaSalvar({ entrar: "chave", chave: v }); c.value = "";
      if (r?.erro) marca("entrar", "erro", r.erro); else confere();
    } else if (a === "voltar") { paraEspera(); vivo.claudeEntrarCancela(); pedeEntrada(); }
  });
  fundo.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.target.matches(".prep-codigo")) q("[data-a='codigo']").click();
    if (e.target.matches(".prep-api")) q("[data-a='salvaChave']").click();
  });

  if (!s.instalado) { marca("entrar", "", ""); instala(); }
  else { marca("instalar", "ok", s.versao ? t("Claude Code {0} instalado", s.versao) : "Instalado"); pedeEntrada(); }
}
