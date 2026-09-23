import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

/*
 * Authentication for the HIJ API.
 *
 * Passwords are stored as scrypt hashes and sessions are stateless signed
 * tokens, so nothing here needs a database table or survives as server memory —
 * the app can be restarted by the host at any moment without logging everyone
 * out. Both primitives come from Node's own crypto module; no new dependency.
 */

// ----------------------------------------------------------------- secret

const SECRET_ENV = 'AUTH_SECRET';

function resolveSecret(): string {
  const configured = process.env[SECRET_ENV];
  if (configured && configured.length >= 16) return configured;

  if (process.env.NODE_ENV === 'production') {
    // Refusing to boot is the honest failure. A generated secret would work
    // until the next restart and then silently invalidate every session, and a
    // hardcoded fallback would let anyone mint their own tokens.
    console.error(
      `\nFATAL: ${SECRET_ENV} belum disetel (minimal 16 karakter).\n` +
      '  Tanpa ini token sesi tidak bisa ditandatangani dengan aman.\n' +
      `  Setel ${SECRET_ENV} di panel environment hosting, lalu jalankan ulang.\n` +
      '  Contoh membuat nilai acak:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
    );
    process.exit(1);
  }

  console.warn(
    `⚠️  ${SECRET_ENV} belum disetel — memakai kunci sementara untuk pengembangan.\n` +
    '    Sesi akan hangus setiap kali server dijalankan ulang.'
  );
  return crypto.randomBytes(48).toString('hex');
}

const SECRET = resolveSecret();

// --------------------------------------------------------------- password

const SCRYPT_KEYLEN = 64;
const HASH_PREFIX = 'scrypt$';

/** Store as `scrypt$<salt hex>$<derived key hex>`. */
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN).toString('hex');
  return `${HASH_PREFIX}${salt}$${derived}`;
}

export const isHashed = (stored?: string) => typeof stored === 'string' && stored.startsWith(HASH_PREFIX);

export interface PasswordCheck {
  ok: boolean;
  /** The record still holds a plaintext password and should be re-saved hashed. */
  needsUpgrade: boolean;
}

/*
 * Existing records were seeded with plaintext passwords. Rejecting them outright
 * would lock every current user out, so a correct plaintext match is accepted
 * once and reported back so the caller can replace it with a hash.
 */
export function verifyPassword(plain: string, stored?: string): PasswordCheck {
  if (!stored || !plain) return { ok: false, needsUpgrade: false };

  if (!isHashed(stored)) {
    const a = Buffer.from(plain);
    const b = Buffer.from(String(stored));
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { ok, needsUpgrade: ok };
  }

  const [, salt, expected] = stored.split('$');
  if (!salt || !expected) return { ok: false, needsUpgrade: false };

  const derived = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN);
  const expectedBuf = Buffer.from(expected, 'hex');
  const ok = derived.length === expectedBuf.length && crypto.timingSafeEqual(derived, expectedBuf);
  return { ok, needsUpgrade: false };
}

// ------------------------------------------------------------------ token

export type ActorType = 'internal' | 'customer';

export interface TokenPayload {
  /** User id for staff, customer id for clients. */
  sub: string;
  type: ActorType;
  role?: string;
  /** Expiry, seconds since epoch. */
  exp: number;
  /** Fingerprint of the password hash at issue: a changed password ends the session. */
  pv?: string;
}

/** Short fingerprint of a stored password, carried in the token. */
export function passwordVersion(stored?: string): string {
  return crypto.createHash('sha256').update(String(stored || '')).digest('hex').slice(0, 12);
}

const TOKEN_TTL_SECONDS = 12 * 60 * 60;

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromB64url = (input: string) => Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const sign = (body: string) => b64url(crypto.createHmac('sha256', SECRET).update(body).digest());

export function issueToken(payload: Omit<TokenPayload, 'exp'>, ttlSeconds = TOKEN_TTL_SECONDS): string {
  const full: TokenPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = b64url(JSON.stringify(full));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token?: string): TokenPayload | null {
  if (!token || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(fromB64url(body).toString('utf-8')) as TokenPayload;
    if (!payload.sub || !payload.type) return null;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- middleware

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: TokenPayload;
    }
  }
}

function readToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  return undefined;
}

/**
 * Attaches req.actor when a valid token is present. Never rejects.
 *
 * The token is stateless, so the account behind it is looked up on every
 * request: a deleted or deactivated account, or one whose password changed,
 * stops working at once instead of at the token's twelve-hour expiry.
 */
export function attachActor(lookup: (type: ActorType, id: string) => any | null) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const payload = verifyToken(readToken(req));
    if (payload) {
      const record = lookup(payload.type, payload.sub);
      const alive =
        record &&
        record.status !== 'Inactive' &&
        (payload.type !== 'customer' || record.portalAccessActive !== false) &&
        (payload.pv === undefined || payload.pv === passwordVersion(record.password));
      if (alive) req.actor = payload;
    }
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.actor) {
    return res.status(401).json({ error: 'Sesi tidak valid atau sudah berakhir. Silakan masuk lagi.' });
  }
  next();
}

export function requireStaff(req: Request, res: Response, next: NextFunction) {
  if (!req.actor) {
    return res.status(401).json({ error: 'Sesi tidak valid atau sudah berakhir. Silakan masuk lagi.' });
  }
  if (req.actor.type !== 'internal') {
    return res.status(403).json({ error: 'Akses ini khusus staf HIJ.' });
  }
  next();
}

/** Staff may read anyone; a customer may only read their own id. */
export function requireSelfOrStaff(getTargetId: (req: Request) => string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.actor) {
      return res.status(401).json({ error: 'Sesi tidak valid atau sudah berakhir. Silakan masuk lagi.' });
    }
    if (req.actor.type === 'internal') return next();

    const target = String(getTargetId(req) || '').toLowerCase();
    if (target && target === String(req.actor.sub).toLowerCase()) return next();

    return res.status(403).json({ error: 'Data ini bukan milik akun Anda.' });
  };
}

// ---------------------------------------------------------------- hygiene

const SENSITIVE_KEYS = new Set(['password', 'passwordhash', 'serverkey', 'privatekey', 'apikey', 'webhooksecret']);

/*
 * One place that decides what never leaves the server. Applied to whole
 * responses rather than per-handler, because the generic CRUD routes return raw
 * table rows and would otherwise ship users.json passwords to anyone.
 */
export function stripSensitive<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripSensitive) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
      out[key] = stripSensitive(val);
    }
    return out as unknown as T;
  }
  return value;
}
