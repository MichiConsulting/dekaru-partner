// Abmelden: Sitzung loeschen, Cookie entfernen. Nur per POST mit CSRF-Token.
import type { APIRoute } from 'astro';
import { COOKIE_NAME, beendeSitzung } from '../lib/auth.ts';

export const POST: APIRoute = async ({ locals, cookies, redirect }) => {
  if (locals.sitzungId) await beendeSitzung(locals.db, locals.sitzungId);
  cookies.delete(COOKIE_NAME, { path: '/' });
  return redirect('/login', 303);
};

export const GET: APIRoute = ({ redirect }) => redirect('/', 303);
