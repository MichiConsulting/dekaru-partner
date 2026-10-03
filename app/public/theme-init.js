// Hell oder dunkel, noch bevor die Seite gezeichnet wird, damit beim Laden
// nichts aufblitzt. Liegt als eigene Datei in public/, weil die
// Content-Security-Policy (script-src 'self') keine Inline-Skripte erlaubt.
//
// Gespeichert wird nur eine ausdrueckliche Wahl ("light" oder "dark") unter
// dem Schluessel "dekaru-theme". Ohne Wahl bleibt data-theme leer und
// global.css folgt der Systemeinstellung ueber prefers-color-scheme.
(function () {
  var html = document.documentElement;
  html.classList.add('modus-bereit');
  var wahl = null;
  try {
    wahl = localStorage.getItem('dekaru-theme');
  } catch (fehler) {
    wahl = null;
  }
  if (wahl === 'light' || wahl === 'dark') html.setAttribute('data-theme', wahl);
})();
