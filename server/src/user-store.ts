import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { encrypt, decrypt } from "./domain/crypto.js";

export type User = { id: string; email: string; googleSub: string; refreshToken: string };

type Row = { id: string; email: string; google_sub: string; refresh_token: string };

export class UserStore {
  private db: Database.Database;
  constructor(dbPath: string, private encKey: string) {
    this.db = new Database(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      google_sub TEXT UNIQUE NOT NULL,
      refresh_token TEXT NOT NULL
    )`);
  }

  upsertByGoogle(input: { googleSub: string; email: string; refreshToken: string }): User {
    const enc = encrypt(input.refreshToken, this.encKey);
    const existing = this.db.prepare("SELECT * FROM users WHERE google_sub = ?").get(input.googleSub) as Row | undefined;
    if (existing) {
      this.db.prepare("UPDATE users SET email = ?, refresh_token = ? WHERE google_sub = ?").run(input.email, enc, input.googleSub);
      return { id: existing.id, email: input.email, googleSub: input.googleSub, refreshToken: input.refreshToken };
    }
    const id = randomUUID();
    this.db.prepare("INSERT INTO users (id, email, google_sub, refresh_token) VALUES (?, ?, ?, ?)").run(id, input.email, input.googleSub, enc);
    return { id, email: input.email, googleSub: input.googleSub, refreshToken: input.refreshToken };
  }

  getById(id: string): User | undefined {
    const r = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
    if (!r) return undefined;
    return { id: r.id, email: r.email, googleSub: r.google_sub, refreshToken: decrypt(r.refresh_token, this.encKey) };
  }

  getByEmail(email: string): User | undefined {
    const r = this.db.prepare("SELECT * FROM users WHERE email = ?").get(email) as Row | undefined;
    if (!r) return undefined;
    return { id: r.id, email: r.email, googleSub: r.google_sub, refreshToken: decrypt(r.refresh_token, this.encKey) };
  }
}
