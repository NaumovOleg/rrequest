import jwt from "jsonwebtoken";

export function signSession(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: "30d" });
}

export function verifySession(token: string, secret: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, secret) as { sub?: string };
    return payload.sub ? { userId: payload.sub } : null;
  } catch {
    return null;
  }
}
