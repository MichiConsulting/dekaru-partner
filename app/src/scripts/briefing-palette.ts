// Briefing-Bogen, Feld Farbpalette: zeigt nur die Paletten der gewaehlten
// Branche. Ist beim Wechsel der Branche eine Palette einer anderen Branche
// markiert, springt die Wahl auf "Noch offen". Ohne Branche stehen alle da.

const feld = document.querySelector<HTMLElement>('[data-briefing-palette]');
const branche = document.querySelector<HTMLSelectElement>('select[name="branche"]');

if (feld && branche) {
  const gruppen = [...feld.querySelectorAll<HTMLElement>('[data-palette-gruppe]')];
  const offen = feld.querySelector<HTMLInputElement>('input[value="offen"]');

  const abgleichen = (zuruecksetzen: boolean): void => {
    const wahl = branche.value;
    for (const g of gruppen) {
      g.hidden = wahl !== '' && g.dataset.paletteGruppe !== wahl;
      if (zuruecksetzen && g.hidden && g.querySelector<HTMLInputElement>('input:checked') && offen) offen.checked = true;
    }
  };
  branche.addEventListener('change', () => abgleichen(true));
  // Beim Laden nichts aendern: eine unpassende Wahl meldet der Server beim Einreichen.
  abgleichen(false);
}
