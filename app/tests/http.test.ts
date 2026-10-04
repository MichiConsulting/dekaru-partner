import { afterEach, describe, expect, it } from 'vitest';
import { clientIp } from '../src/lib/http.ts';

function astroMit(headers: Record<string, string>, clientAddress = '9.9.9.9') {
  return {
    request: new Request('https://partner.dekaru.de/login', { headers }),
    clientAddress,
  };
}

describe('clientIp', () => {
  afterEach(() => {
    delete process.env.VERCEL;
  });

  it('vertraut hinter Vercel nur x-real-ip, nicht dem faelschbaren x-forwarded-for', () => {
    process.env.VERCEL = '1';
    const astro = astroMit({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9', 'x-real-ip': '203.0.113.9' });
    expect(clientIp(astro)).toBe('203.0.113.9');
  });

  it('ein Client, der selbst x-forwarded-for vorgibt, kann die Adresse nicht faelschen', () => {
    process.env.VERCEL = '1';
    // Ohne x-real-ip (sollte auf Vercel nie vorkommen) faellt die Funktion
    // auf clientAddress zurueck, niemals auf den Client-Header.
    const astro = astroMit({ 'x-forwarded-for': 'frei-erfunden' });
    expect(clientIp(astro)).toBe('9.9.9.9');
  });

  it('nutzt ausserhalb von Vercel clientAddress', () => {
    const astro = astroMit({ 'x-forwarded-for': '6.6.6.6' });
    expect(clientIp(astro)).toBe('9.9.9.9');
  });

  it('liefert "unbekannt", wenn clientAddress nicht verfuegbar ist', () => {
    const astro = {
      request: new Request('https://partner.dekaru.de/login'),
      get clientAddress(): string {
        throw new Error('nicht verfuegbar');
      },
    };
    expect(clientIp(astro)).toBe('unbekannt');
  });
});
