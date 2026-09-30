// Bildpfade in den Kapiteln auf die Grafik-Route umbiegen.
//
// Die Kapitel liegen in inhalt/kapitel/ und verweisen auf Grafiken mit
// ![Text](grafiken/name.svg) oder ../grafiken/name.svg. Ausgeliefert werden
// sie ueber /grafiken/name.svg, hinter dem Login. Ausserdem bekommt jedes
// Bild loading="lazy".

const MUSTER = /(?:^|\/)grafiken\/([^/]+\.svg)$/;

function besuche(knoten, fn) {
  if (!knoten || typeof knoten !== 'object') return;
  fn(knoten);
  if (Array.isArray(knoten.children)) for (const kind of knoten.children) besuche(kind, fn);
}

export function rehypeGrafiken() {
  return (baum) => {
    besuche(baum, (knoten) => {
      if (knoten.type !== 'element' || knoten.tagName !== 'img') return;
      const src = String(knoten.properties?.src ?? '');
      const treffer = MUSTER.exec(src);
      if (treffer) knoten.properties.src = `/grafiken/${treffer[1]}`;
      knoten.properties.loading = 'lazy';
    });
  };
}
