// Interface language. The code is written in Portuguese; English and
// Vietnamese come from the dictionaries in renderer/i18n/parts, keyed by the
// Portuguese text. {0}, {1}… in a key stand for values that change at runtime.
// The window asks for the whole dictionary once (sendSync "i18n") and
// translates its own text; the main process uses t() for native dialogs and
// exported files.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pasta = path.join(path.dirname(fileURLToPath(import.meta.url)), "renderer", "i18n", "parts");
export const IDIOMAS = ["pt", "en", "vi"];
export const IDIOMA_PADRAO = "en";

export const DICIONARIO = {};
for (const f of fs.readdirSync(pasta).filter((n) => n.endsWith(".json")).sort()) {
  try { Object.assign(DICIONARIO, JSON.parse(fs.readFileSync(path.join(pasta, f), "utf8"))); }
  catch (e) { console.error("[i18n]", f, e.message); }
}

const preenche = (s, valores) => s.replace(/\{(\d+)\}/g, (_, i) => valores[i] ?? "");

// t("Escolher {0}", "imagem") → "Choose image" in English.
export function criaT(idioma) {
  return (pt, ...valores) => {
    const l = idioma();
    const tr = l === "pt" ? null : DICIONARIO[pt]?.[l];
    return preenche(tr || pt, valores);
  };
}
