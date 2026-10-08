import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export const COOKIE_NAME = 'ajh_session';

export function signSession(user) {
  return jwt.sign({ sub: String(user.id), email: user.email, tv: user.token_version ?? 1 }, config.secret, {
    expiresIn: `${config.sessionTtlDays}d`,
  });
}

export function verifySession(token) {
  try {
    return jwt.verify(token, config.secret);
  } catch {
    return null;
  }
}

/**
 * Cookie attributes for this request.
 *
 * SameSite=Lax is the safe default, but browsers do not send a Lax cookie when the app
 * is embedded in a third-party frame — a preview pane, for example. In that situation
 * the session would be issued and then never sent back, which reads as "Not
 * authenticated". When the app is configured to allow embedding and the request
 * arrived over HTTPS, the cookie is marked SameSite=None; Secure so it works inside the
 * frame as well. The Authorization token remains the primary mechanism either way.
 */
function cookieOptions(res) {
  const req = res.req;
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const isHttps = Boolean(req?.secure) || forwardedProto === 'https' || config.secureCookies;
  const embedded = config.embed.allowAll || config.embed.origins.length > 0;
  const explicit = String(process.env.COOKIE_SAMESITE || '').toLowerCase();

  let sameSite = explicit || 'lax';
  if (!explicit && embedded && isHttps) sameSite = 'none';
  // Browsers reject SameSite=None unless the cookie is also marked Secure.
  const secure = sameSite === 'none' ? true : config.secureCookies || isHttps;

  return { httpOnly: true, sameSite, secure, path: '/' };
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    ...cookieOptions(res),
    maxAge: config.sessionTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res) {
  const { httpOnly, sameSite, secure, path } = cookieOptions(res);
  res.clearCookie(COOKIE_NAME, { httpOnly, sameSite, secure, path });
}

/**
 * Every session credential the request carried, most authoritative first.
 *
 * A request can legitimately arrive with both a cookie and a bearer token (the client
 * always sends the token when it has one). They can disagree: the cookie may be a
 * leftover signed with an older secret — after a database or secret change, for
 * instance — while the token is perfectly valid. Checking only the first one found
 * meant a dead cookie could override a good token and lock the user out.
 */
export function sessionCandidates(req) {
  const candidates = [];
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) candidates.push({ token: header.slice(7), source: 'header' });
  const cookie = req.cookies?.[COOKIE_NAME];
  if (cookie) candidates.push({ token: cookie, source: 'cookie' });
  return candidates;
}

/** The first credential that actually verifies, or null. */
export function resolveSession(req) {
  for (const candidate of sessionCandidates(req)) {
    const payload = verifySession(candidate.token);
    if (payload) return { ...candidate, payload };
  }
  return null;
}

/**
 * Kept for callers that just want a token string. Prefer `resolveSession`, which
 * validates rather than assuming the cookie is the better credential.
 */
export function readSessionToken(req) {
  return resolveSession(req)?.token
    ?? req.cookies?.[COOKIE_NAME]
    ?? (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
}
