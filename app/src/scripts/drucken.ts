// Knopf "Drucken oder als PDF sichern" auf der Fassung zum Zeigen
// (/verkaufshilfen/<modul>/zeigen). Eigene Datei wegen der CSP (script-src
// 'self'). Ohne JavaScript bleibt der Knopf verborgen, Strg+P geht immer.
for (const knopf of document.querySelectorAll<HTMLButtonElement>('[data-drucken]')) {
  knopf.hidden = false;
  knopf.addEventListener('click', () => window.print());
}
