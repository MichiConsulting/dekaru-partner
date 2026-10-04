// Rechnet die Summe live mit, sobald sich ein Feld aendert. Ohne dieses Skript
// rechnet der Server nach dem Absenden; mit ihm stimmt die Anzeige sofort.
// Es nutzt dieselbe Funktion berechne() wie der Server, es gibt also keine
// zweite Rechnung. Eigene Datei wegen der CSP (script-src 'self').

import { HOSTING_PROVISION_MONATE, auswahlAusFeldern, berechne, euro, type Ergebnis } from '../lib/preise.ts';

function zeile(links: string, rechts: string, klasse?: string): HTMLLIElement {
  const li = document.createElement('li');
  if (klasse) li.className = klasse;
  const a = document.createElement('span');
  a.textContent = links;
  const b = document.createElement('span');
  b.textContent = rechts;
  li.append(a, b);
  return li;
}

function setzeText(wurzel: Element, selektor: string, text: string): void {
  const el = wurzel.querySelector<HTMLElement>(selektor);
  if (el) el.textContent = text;
}

function zeige(wurzel: Element, selektor: string, sichtbar: boolean): void {
  const el = wurzel.querySelector<HTMLElement>(selektor);
  if (el) el.hidden = !sichtbar;
}

function schreibe(bereich: Element, e: Ergebnis): void {
  setzeText(bereich, '[data-summe]', euro(e.summeEinmalig));
  const liste = bereich.querySelector<HTMLElement>('[data-aufstellung]');
  if (liste) {
    liste.textContent = '';
    for (const z of e.zeilen) liste.appendChild(zeile(z.bezeichnung, z.betrag === null ? 'nach Absprache' : euro(z.betrag)));
  }
  const h = e.hosting;
  zeige(bereich, '[data-hosting]', Boolean(h));
  zeige(bereich, '[data-provision-hosting]', Boolean(h));
  if (h) {
    setzeText(
      bereich,
      '[data-hosting-text]',
      h.zahlweise === 'jaehrlich' ? `${h.tarif.name}, ${euro(h.jeZahlung)} im Jahr, Jahresvertrag.` : `${h.tarif.name}, ${euro(h.jeZahlung)} im Monat.`,
    );
    setzeText(bereich, '[data-hosting-hinweise]', h.hinweise.join(' '));
    setzeText(
      bereich,
      '[data-provision-hosting]',
      `Dazu Hosting: ${euro(h.provision)} auf die ersten ${HOSTING_PROVISION_MONATE} bezahlten Monate, vierteljährlich ausgezahlt. Gratismonate zählen nicht.`,
    );
  }
  setzeText(bereich, '[data-provision]', euro(e.provisionEinmalig));
  setzeText(bereich, '[data-hinweise]', e.hinweise.join(' '));
}

document.querySelectorAll<HTMLFormElement>('form.rechner-form').forEach((form) => {
  const bereich = form.querySelector('[data-summe-bereich]') ?? document.querySelector('[data-summe-bereich]');
  if (!bereich) return;
  const rechnen = () => {
    const felder: Record<string, string> = {};
    for (const [name, wert] of new FormData(form).entries()) if (typeof wert === 'string') felder[name] = wert;
    schreibe(bereich, berechne(auswahlAusFeldern(felder)));
  };
  form.addEventListener('change', rechnen);
  form.addEventListener('input', rechnen);
  document.documentElement.classList.add('js');
  rechnen();
});
