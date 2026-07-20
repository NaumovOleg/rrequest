import { verifySession } from "./jwt.js";
import type { UserStore, User } from "./user-store.js";

export function requireUser(
  req: { headers: { authorization?: string } },
  deps: { config: { jwtSecret: string }; users: UserStore },
): User | null {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = verifySession(token, deps.config.jwtSecret);
  if (!session) return null;
  return deps.users.getById(session.userId) ?? null;
}
