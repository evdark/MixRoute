import type { Db } from "./db.js";
import { randomId, sha256 } from "./crypto.js";
import type { CanonicalMessage } from "./types.js";

/**
 * Context Engine — the Router is the source of truth for conversations.
 * Conversations are never bound to a provider: the same conversation may be
 * served by different upstreams across messages and the context stays whole.
 */

function hashSequence(messages: CanonicalMessage[]): string {
  return sha256(JSON.stringify(messages.map((m) => ({ role: m.role, content: m.content }))));
}

function countMessages(db: Db, conversationId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?")
    .get(conversationId) as { c: number };
  return row.c;
}

function recomputeHistoryHash(db: Db, conversationId: string): void {
  const all = loadMessages(db, conversationId);
  db.prepare("UPDATE conversations SET history_hash = ?, updated_at = ? WHERE id = ?").run(
    all.length ? hashSequence(all) : null,
    Date.now(),
    conversationId
  );
}

export function loadMessages(db: Db, conversationId: string): CanonicalMessage[] {
  const rows = db
    .prepare("SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY position ASC")
    .all(conversationId) as { role: string; content: string }[];
  return rows.map((r) => JSON.parse(r.content) as CanonicalMessage);
}

export function appendMessages(db: Db, conversationId: string, messages: CanonicalMessage[]): void {
  if (!messages.length) return;
  const insert = db.prepare(
    "INSERT INTO messages (conversation_id, position, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  const start = countMessages(db, conversationId);
  const tx = db.transaction(() => {
    messages.forEach((m, i) => {
      insert.run(conversationId, start + i, m.role, JSON.stringify(m), Date.now());
    });
  });
  tx();
  recomputeHistoryHash(db, conversationId);
}

/**
 * Resolve (or create) the conversation for an incoming request.
 *
 * Matching strategy:
 * 1. explicit `conversation_id` sent by the client wins;
 * 2. otherwise the client's message prefix (everything but the new message)
 *    is hashed and matched against stored conversations — this is what makes
 *    stateless OpenAI-compatible clients (Cursor, OpenCode, ...) keep one
 *    continuous conversation even when providers change between turns.
 */
export interface ResolvedConversation {
  id: string;
  isNew: boolean;
  /** Canonical messages to send upstream — stored context merged with incoming. */
  messages: CanonicalMessage[];
}

function matchesPrefix(incoming: CanonicalMessage[], stored: CanonicalMessage[]): boolean {
  if (stored.length > incoming.length) return false;
  return (
    JSON.stringify(incoming.slice(0, stored.length).map((m) => ({ role: m.role, content: m.content }))) ===
    JSON.stringify(stored.map((m) => ({ role: m.role, content: m.content })))
  );
}

export function resolveConversation(
  db: Db,
  opts: { model: string; messages: CanonicalMessage[]; explicitId?: string }
): ResolvedConversation {
  const now = Date.now();

  if (opts.explicitId) {
    const existing = db
      .prepare("SELECT id FROM conversations WHERE id = ?")
      .get(opts.explicitId) as { id: string } | undefined;
    if (existing) {
      const stored = loadMessages(db, existing.id);
      let effective = opts.messages;
      if (stored.length && !matchesPrefix(opts.messages, stored)) {
        // client sent only the new messages -> rebuild full context from storage
        effective = [...stored, ...opts.messages];
      }
      appendMessages(db, existing.id, effective.slice(stored.length));
      return { id: existing.id, isNew: false, messages: effective };
    }
    db.prepare(
      "INSERT INTO conversations (id, model, history_hash, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)"
    ).run(opts.explicitId, opts.model, now, now);
    appendMessages(db, opts.explicitId, opts.messages);
    return { id: opts.explicitId, isNew: true, messages: opts.messages };
  }

  const prefix = opts.messages.slice(0, -1);
  if (prefix.length > 0) {
    const hash = hashSequence(prefix);
    const match = db
      .prepare(
        "SELECT id FROM conversations WHERE history_hash = ? ORDER BY updated_at DESC LIMIT 1"
      )
      .get(hash) as { id: string } | undefined;
    if (match) {
      appendMessages(db, match.id, opts.messages.slice(countMessages(db, match.id)));
      return { id: match.id, isNew: false, messages: opts.messages };
    }
  }

  const id = randomId(8);
  db.prepare(
    "INSERT INTO conversations (id, model, history_hash, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)"
  ).run(id, opts.model, now, now);
  appendMessages(db, id, opts.messages);
  return { id, isNew: true, messages: opts.messages };
}

export function appendAssistantMessage(db: Db, conversationId: string, content: string): void {
  appendMessages(db, conversationId, [
    { role: "assistant", content } as CanonicalMessage,
  ]);
}
