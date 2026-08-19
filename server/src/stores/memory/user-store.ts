import { randomUUID } from "node:crypto";
import type { UserStore, User } from "../types.js";

export class MemoryUserStore implements UserStore {
  private byId = new Map<string, User>();

  async upsertByGoogle(input: { googleSub: string; email: string; refreshToken: string }): Promise<User> {
    const email = input.email.toLowerCase();
    const existing =
      [...this.byId.values()].find((u) => u.googleSub === input.googleSub) ??
      [...this.byId.values()].find((u) => u.email === email);
    if (existing) {
      const updated: User = { ...existing, email, googleSub: input.googleSub, refreshToken: input.refreshToken };
      this.byId.set(existing.id, updated);
      return updated;
    }
    const id = randomUUID();
    const user: User = { id, email, googleSub: input.googleSub, refreshToken: input.refreshToken };
    this.byId.set(id, user);
    return user;
  }

  async getById(id: string): Promise<User | undefined> {
    return this.byId.get(id);
  }

  async getByEmail(email: string): Promise<User | undefined> {
    return [...this.byId.values()].find((u) => u.email === email.toLowerCase());
  }
}
