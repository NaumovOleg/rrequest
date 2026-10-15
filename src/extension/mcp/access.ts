/**
 * Session-scoped access grants for MCP. The agent must be explicitly allowed
 * to touch a resource before any tool can read its contents or change it; the
 * actual Allow/Deny decision is injected so this module stays vscode-free and
 * unit-testable (production wires it to a native modal, tests to a stub).
 *
 * Grants live only in memory: they are created on server start and dropped on
 * stop/reload, which is what makes "always ask" true across sessions.
 * `// ponytail: session-scoped; add persistence only if users ask for it.`
 */
/** What a grant is keyed on: workspaces, collections and environments. */
export type ResourceType = "workspace" | "collection" | "environment";

export type ResourceRef = { type: ResourceType; id: string; name: string };

export type Grant = { write: boolean; at: number };

export type AccessDecision = "allow" | "allow-write" | "deny";

export type PromptRequest = ResourceRef & {
  write: boolean;
  alreadyRead: boolean;
};

export type AccessPrompt = (req: PromptRequest) => Promise<AccessDecision>;

export type AccessResult =
  | { ok: true }
  | {
      ok: false;
      reason: "access_required" | "access_denied";
      hint: string;
    };

export class McpAccess {
  private readonly grants = new Map<
    string,
    { ref: ResourceRef; grant: Grant }
  >();
  // Denials are remembered for the session so a "No" isn't re-asked on every
  // subsequent call — but a fresh require() after revoke() will ask again.
  private readonly denials = new Set<string>();

  constructor(
    private readonly opts: {
      prompt: AccessPrompt;
      onChanged?: (grants: { ref: ResourceRef; grant: Grant }[]) => void;
    }
  ) {}

  private key(ref: ResourceRef): string {
    return `${ref.type}:${ref.id}`;
  }

  has(ref: ResourceRef, mode: "read" | "write"): boolean {
    const entry = this.grants.get(this.key(ref));
    if (!entry) return false;
    return mode === "read" || entry.grant.write;
  }

  async require(
    ref: ResourceRef,
    mode: "read" | "write"
  ): Promise<AccessResult> {
    if (this.has(ref, mode)) return { ok: true };
    const k = this.key(ref);
    if (this.denials.has(k)) {
      return {
        ok: false,
        reason: "access_denied",
        hint: `Access to ${ref.type} "${ref.name}" was denied earlier this session.`,
      };
    }

    const decision = await this.opts.prompt({
      ...ref,
      write: mode === "write",
      alreadyRead: this.has(ref, "read"),
    });

    if (decision === "deny") {
      this.denials.add(k);
      this.changed();
      return {
        ok: false,
        reason: "access_denied",
        hint: `The user denied access to ${ref.type} "${ref.name}". Do not retry unless they ask.`,
      };
    }

    const previous = this.grants.get(k);
    this.grants.set(k, {
      ref,
      // A write grant implies read; never downgrade an existing write grant.
      grant: {
        write: decision === "allow-write" || !!previous?.grant.write,
        at: Date.now(),
      },
    });
    this.denials.delete(k);
    this.changed();
    return { ok: true };
  }

  revoke(ref: ResourceRef): void {
    this.grants.delete(this.key(ref));
    this.denials.delete(this.key(ref));
    this.changed();
  }

  revokeAll(): void {
    this.grants.clear();
    this.denials.clear();
    this.changed();
  }

  list(): { ref: ResourceRef; grant: Grant }[] {
    return [...this.grants.values()].map((e) => ({
      ref: e.ref,
      grant: e.grant,
    }));
  }

  /** Cleared when the server stops so the next session starts unapproved. */
  clear(): void {
    if (this.grants.size === 0 && this.denials.size === 0) return;
    this.grants.clear();
    this.denials.clear();
    this.changed();
  }

  private changed(): void {
    this.opts.onChanged?.(this.list());
  }
}
