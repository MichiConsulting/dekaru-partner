// Konto-Menue im Kopf: details/summary funktioniert ohne JavaScript. Hier
// kommt nur dazu, dass ein Klick daneben oder Escape das Menue schliesst.
for (const menue of document.querySelectorAll<HTMLDetailsElement>('[data-konto]')) {
  document.addEventListener('click', (e) => {
    if (menue.open && !menue.contains(e.target as Node)) menue.open = false;
  });
  menue.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menue.open) {
      menue.open = false;
      menue.querySelector('summary')?.focus();
    }
  });
}
