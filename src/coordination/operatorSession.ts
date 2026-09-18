import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "malgyeol_operator";
const SESSION_SECONDS = 8 * 60 * 60;
interface SessionOptions {
  now?: () => number;
  maxSessions?: number;
}
interface CookieOptions {
  secure?: boolean;
}

/** Server-owned session state. Restart intentionally requires a fresh operator login. */
export class OperatorSessions {
  private readonly sessions = new Map<string, number>();
  private readonly now: () => number;
  private readonly maxSessions: number;
  private readonly operatorDigest: Buffer | undefined;

  constructor(operatorToken: string | undefined, options: SessionOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxSessions = options.maxSessions ?? 128;
    if (
      !Number.isSafeInteger(this.maxSessions) ||
      this.maxSessions < 1 ||
      this.maxSessions > 10000
    ) {
      throw new Error("INVALID_SESSION_LIMIT");
    }
    this.operatorDigest =
      operatorToken &&
      operatorToken.length >= 32 &&
      operatorToken.length <= 4096
        ? this.digest(operatorToken)
        : undefined;
  }

  private digest(value: string): Buffer {
    return createHash("sha256").update(value, "utf8").digest();
  }

  private validCode(value: unknown): boolean {
    if (
      !this.operatorDigest ||
      typeof value !== "string" ||
      value.length < 32 ||
      value.length > 4096
    )
      return false;
    return timingSafeEqual(this.operatorDigest, this.digest(value));
  }

  bearerAuthorized(header: string | undefined): boolean {
    if (!header?.startsWith("Bearer ")) return false;
    return this.validCode(header.slice(7));
  }

  private prune(): void {
    const at = this.now();
    for (const [id, expiresAt] of this.sessions) {
      if (expiresAt <= at) this.sessions.delete(id);
    }
  }

  private cookie(
    value: string,
    maxAge: number,
    options: CookieOptions,
  ): string {
    return `${COOKIE_NAME}=${value}; Path=/api/coordination; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${options.secure ? "; Secure" : ""}`;
  }

  login(
    accessCode: unknown,
    options: CookieOptions = {},
  ): { cookie: string } | undefined {
    if (!this.validCode(accessCode)) return undefined;
    this.prune();
    while (this.sessions.size >= this.maxSessions)
      this.sessions.delete(this.sessions.keys().next().value!);
    const id = randomBytes(32).toString("base64url");
    this.sessions.set(id, this.now() + SESSION_SECONDS * 1000);
    return { cookie: this.cookie(id, SESSION_SECONDS, options) };
  }

  private sessionId(header: string | undefined): string | undefined {
    if (!header || header.length > 16384) return undefined;
    const candidates = header
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${COOKIE_NAME}=`));
    if (candidates.length !== 1) return undefined;
    const id = candidates[0].slice(COOKIE_NAME.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(id) ? id : undefined;
  }

  isValid(cookieHeader: string | undefined): boolean {
    this.prune();
    const id = this.sessionId(cookieHeader);
    return id !== undefined && this.sessions.has(id);
  }

  authenticate(
    cookieHeader: string | undefined,
    origin: string | undefined,
    expectedOrigin: string,
    method: string,
  ): boolean {
    const safeMethod = ["GET", "HEAD", "OPTIONS"].includes(
      method.toUpperCase(),
    );
    // Require a concrete same-origin Origin for cookie-authorized mutations.
    if (!safeMethod && !origin) return false;
    if (origin !== undefined && origin !== expectedOrigin) return false;
    return this.isValid(cookieHeader);
  }

  logout(
    cookieHeader: string | undefined,
    options: CookieOptions = {},
  ): string {
    const id = this.sessionId(cookieHeader);
    if (id) this.sessions.delete(id);
    return this.cookie("", 0, options);
  }
}
