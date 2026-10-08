import { db } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { resolveSession, clearSessionCookie } from '../lib/session.js';

/** Resolves the authenticated user or throws 401. Attaches req.user. */
export function requireAuth(req, res, next) {
  const session = resolveSession(req);
  if (!session) {
    // Distinguish "no credentials at all" from "credentials that no longer verify".
    const hadCredentials = Boolean(req.cookies?.ajh_session) || Boolean(req.headers.authorization);
    // A cookie that cannot be verified is dead weight: clear it so the browser stops
    // sending it on every request.
    if (req.cookies?.ajh_session) clearSessionCookie(res);
    return next(
      hadCredentials
        ? ApiError.unauthorized('Session expired — please sign in again')
        : ApiError.unauthorized()
    );
  }
  const payload = session.payload;
  const user = db().get('SELECT id, email, name, token_version, created_at FROM users WHERE id = ?', payload.sub);
  if (!user) return next(ApiError.unauthorized());
  if ((user.token_version ?? 1) !== (payload.tv ?? 1)) {
    return next(ApiError.unauthorized('Session revoked — please sign in again'));
  }
  req.user = user;
  next();
}

/** Ensures the row being touched belongs to the authenticated user. */
export function assertOwnership(table, id, userId, label = 'Resource') {
  const row = db().get(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`, id, userId);
  if (!row) throw ApiError.notFound(`${label} not found`);
  return row;
}
