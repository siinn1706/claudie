// Interface language for the window. The code writes Portuguese; this file
// swaps every visible text node and the title / placeholder / aria-label / alt
// attributes for the chosen language, using the dictionary the main process
// loads from i18n/parts (keys are the Portuguese text, {0}, {1}… stand for
// values that change). A MutationObserver keeps up with whatever the app adds
// later, and remembers each node's Portuguese so the language can change live.
// What Claude and the person write (messages, code, the input) is left alone.
// window.t("…") translates a string for canvas text and notifications.

(() => {
  const { idioma: inicial = "pt", dicionario = {} } = window.vivo?.i18n?.() || {};
  let idioma = inicial;

  // inverso: translated text → Portuguese, for text the app copies out of a
  // node that was already translated (menus built from option labels…).
  const exatos = new Map(), inverso = new Map(), padroes = [], modelos = new Map();
  const escapa = (s) => s.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  for (const [pt, tr] of Object.entries(dicionario)) {
    if (!/\{\d+\}/.test(pt)) {
      exatos.set(pt, tr);
      for (const v of Object.values(tr)) if (v && v !== pt && !inverso.has(v)) inverso.set(v, pt);
      continue;
    }
    // A key that is mostly a value ("{0}h", "{0} de {1}") would match far too
    // much text, so there the values must be numbers.
    const curto = /^\{\d+\}/.test(pt) && pt.replace(/\{\d+\}/g, "").replace(/[^\p{L}]/gu, "").length <= 6;
    const ordem = [];
    modelos.set(pt, tr);
    const re = new RegExp("^" + escapa(pt).replace(/\{(\d+)\}/g, (_, i) => (ordem.push(+i), curto ? "(\\d[\\d.,]*)" : "(.+?)")) + "$", "su");
    padroes.push({ re, ordem, tr });
  }
  const preenche = (s, valores) => s.replace(/\{(\d+)\}/g, (_, i) => valores[i] ?? "");

  function traduz(s) {
    if (idioma === "pt" || !s) return s;
    const [, antes, meio, depois] = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    if (!meio || !/\p{L}/u.test(meio)) return s;
    if (meio.includes("\n")) return antes + meio.split("\n").map(traduz).join("\n") + depois; // a title built from several lines
    const chave = meio.replace(/\s+/g, " ");
    const exato = exatos.get(chave)?.[idioma];
    if (exato != null) return antes + exato + depois;
    if (chave.length < 400) for (const p of padroes) {
      const m = p.re.exec(chave);
      if (!m || !p.tr[idioma]) continue;
      const valores = [];
      p.ordem.forEach((i, k) => (valores[i] = exatos.get(m[k + 1].replace(/\s+/g, " "))?.[idioma] ?? m[k + 1])); // a value that is itself a key ("Permitido · {0}" + a tool label) is translated too
      return antes + preenche(p.tr[idioma], valores) + depois;
    }
    return s;
  }

  function paraPt(s) {
    const [, antes, meio, depois] = /^(\s*)([\s\S]*?)(\s*)$/.exec(s || "");
    const pt = inverso.get(meio.replace(/\s+/g, " "));
    return pt ? antes + pt + depois : s;
  }

  // ---- the DOM ------------------------------------------------------------------------
  const ATRIBUTOS = ["title", "placeholder", "aria-label", "alt", "data-dica"];
  // User data (session titles, folder and project names, snippets) must show as typed; the placeholders "Sem pasta" and "Sem título" are UI labels.
  const DADOS = ".item > span, .item > small, .item .proj, #pastaNome, .boas-pasta span, .grupo.pasta > span";
  const TEXTOS = new WeakMap(), ATRS = new WeakMap(); // node → { pt, escrito }
  const deixa = (el) => !!el.closest("pre, code, textarea, script, style, [contenteditable], [data-sem-traducao]")
    || (!!el.closest(DADOS) && !["Sem pasta", "Sem título"].includes(el.textContent.trim()))
    || (!!el.closest(".msg.eu, .msg .corpo, .raciocinio") && !el.closest("button, summary"));

  function lembra(mapa, chave, atual) {
    let r = mapa.get(chave);
    if (!r || atual !== r.escrito) { r = { pt: paraPt(atual) }; mapa.set(chave, r); } // the app wrote new text
    r.escrito = traduz(r.pt);
    return r.escrito;
  }
  function texto(n) {
    const pai = n.parentElement;
    if (!pai || deixa(pai)) return;
    const v = lembra(TEXTOS, n, n.nodeValue);
    if (n.nodeValue !== v) n.nodeValue = v;
  }
  function atributo(el, nome) {
    if (!el.hasAttribute(nome) || el.closest("pre, code")) return;
    let m = ATRS.get(el);
    if (!m) ATRS.set(el, (m = new Map()));
    const v = lembra(m, nome, el.getAttribute(nome));
    if (el.getAttribute(nome) !== v) el.setAttribute(nome, v);
  }
  function percorre(raiz) {
    if (raiz.nodeType === Node.TEXT_NODE) return texto(raiz);
    if (raiz.nodeType !== Node.ELEMENT_NODE) return;
    for (const a of ATRIBUTOS) atributo(raiz, a);
    for (const el of raiz.querySelectorAll(ATRIBUTOS.map((a) => `[${a}]`).join(","))) for (const a of ATRIBUTOS) atributo(el, a);
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) texto(n);
  }

  new MutationObserver((mudancas) => {
    for (const m of mudancas) {
      if (m.type === "characterData") texto(m.target);
      else if (m.type === "attributes") atributo(m.target, m.attributeName);
      else m.addedNodes.forEach(percorre);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS });

  const LANG = { pt: "pt-BR", en: "en", vi: "vi" };
  function aplica() {
    document.documentElement.lang = LANG[idioma] || "pt-BR";
    percorre(document.body);
    dispatchEvent(new CustomEvent("idioma", { detail: idioma }));
  }

  // t("texto pronto") translates a finished string; t("{0} às {1}", a, b) fills a key with values.
  window.t = (pt, ...valores) => {
    if (!valores.length) return traduz(pt);
    return preenche((idioma !== "pt" && modelos.get(pt)?.[idioma]) || pt, valores);
  };
  window.i18n = {
    idioma: () => idioma,
    // Locale for dates and numbers.
    local: () => LANG[idioma] || "pt-BR",
    muda(novo) { if (novo && novo !== idioma) { idioma = novo; aplica(); } },
  };
  if (document.body) aplica(); else addEventListener("DOMContentLoaded", aplica, { once: true });
})();
