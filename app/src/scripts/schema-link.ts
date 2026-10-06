// Knopf "Link zum Nachschicken kopieren" auf /erstgespraech. Kopiert den Link
// zur oeffentlichen Fassung /schema mit der gerade gewaehlten Branche und,
// falls gewaehlt, Farbgruppe, Farbpalette und vorgemerkten Modulen.
//
// Die Zwischenablage geht nur ueber HTTPS und nur, wenn der Browser es
// erlaubt. Klappt das nicht, erscheint der Link markiert in einem Feld zum
// Selbstkopieren. Wie schema.ts importiert auch dieses Skript nichts aus lib/.

const teilen = document.querySelector<HTMLElement>('[data-teilen]');
const schema = document.querySelector<HTMLElement>('[data-schema]');

if (teilen && schema) {
  const knopf = teilen.querySelector<HTMLButtonElement>('[data-link-kopieren]');
  const status = teilen.querySelector<HTMLElement>('[data-link-status]');
  const feld = teilen.querySelector<HTMLElement>('[data-link-feld]');
  const text = teilen.querySelector<HTMLInputElement>('[data-link-text]');

  const link = (): string => {
    const url = new URL('/schema', location.origin);
    url.searchParams.set('branche', schema.dataset.branche ?? '');
    // Offene Farbgruppe und gewaehlte Palette nur, wenn vorhanden.
    if (schema.dataset.gruppe) url.searchParams.set('gruppe', schema.dataset.gruppe);
    if (schema.dataset.palette) url.searchParams.set('palette', schema.dataset.palette);
    // Vorgemerkte Software-Module, falls welche.
    if (schema.dataset.merkliste) url.searchParams.set('module', schema.dataset.merkliste);
    return url.href;
  };

  function zeigeFeld(wert: string): void {
    if (!text || !feld) return;
    text.value = wert;
    feld.classList.add('ist-offen');
    text.focus();
    text.select();
  }

  knopf?.addEventListener('click', async () => {
    const wert = link();
    if (text) text.value = wert;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('keine Zwischenablage');
      await navigator.clipboard.writeText(wert);
      feld?.classList.remove('ist-offen');
      if (status) status.textContent = 'Link kopiert.';
    } catch {
      zeigeFeld(wert);
      if (status) status.textContent = 'Kopieren ging nicht. Der Link ist markiert, bitte selbst kopieren.';
    }
  });
}
