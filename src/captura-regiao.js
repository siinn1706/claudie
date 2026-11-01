// Drag a rectangle over the dimmed screen: release sends it (CSS pixels of this
// window), Esc or a right click cancels. The picture itself is cropped in main.
const base = document.getElementById("base"), caixa = document.getElementById("caixa"), medida = document.getElementById("medida"), dica = document.getElementById("dica");
let ini = null, fim = false;

const retangulo = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
function desenha(r) {
  caixa.style.cssText = `display:block;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:transparent;box-shadow:0 0 0 1px rgba(0,0,0,.5), 0 0 0 100vmax rgba(0,0,0,.45)`;
  medida.style.display = "block"; medida.textContent = `${Math.round(r.w * devicePixelRatio)} × ${Math.round(r.h * devicePixelRatio)}`;
  medida.style.left = Math.min(r.x, innerWidth - 110) + "px"; medida.style.top = (r.y > 30 ? r.y - 28 : r.y + r.h + 6) + "px";
}
const cancela = () => { if (fim) return; fim = true; captura.cancelar(); };

addEventListener("pointerdown", (e) => {
  if (e.button === 2) return cancela();
  if (e.button !== 0 || fim) return;
  ini = { x: e.clientX, y: e.clientY }; base.style.display = "none"; dica.style.display = "none";
  document.documentElement.setPointerCapture?.(e.pointerId);
});
addEventListener("pointermove", (e) => { if (ini && !fim) desenha(retangulo(ini, { x: e.clientX, y: e.clientY })); });
addEventListener("pointerup", (e) => {
  if (!ini || fim || e.button !== 0) return;
  const r = retangulo(ini, { x: e.clientX, y: e.clientY }); ini = null; fim = true;
  captura.rect(r);
});
addEventListener("contextmenu", (e) => { e.preventDefault(); cancela(); });
addEventListener("keydown", (e) => { if (e.key === "Escape") cancela(); });
