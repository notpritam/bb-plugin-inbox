import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const slug = z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/);
const segment = z.string().min(1).max(512).refine(v => v !== "." && v !== ".." && !/[/\\\u0000-\u001f]/.test(v));
export const activitySchema = z.object({
  sourceId: slug, sourceName: z.string().trim().min(1).max(80),
  entityId: z.string().min(1).max(512), eventId: z.string().min(1).max(128),
  occurredAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  projectId: z.string().max(128).default(""),
  title: z.string().trim().min(1).max(240), body: z.string().max(600).default(""),
  status: z.enum(["ready", "error"]),
  target: z.object({ panel: slug, segments: z.array(segment).max(12).default([]) }).strict(),
}).strict();
export type Activity = z.infer<typeof activitySchema>;
export const activityItemSchema = z.object({
  id: z.string(), sourceName: z.string(), href: z.string(), projectId: z.string(),
  title: z.string(), kind: z.enum(["finished", "error"]), label: z.string(), detail: z.string(),
  attentionAt: z.number(), updatedAt: z.number(),
});
export type ActivityItem = z.infer<typeof activityItemSchema>;
export const activityRpc = {
  activityCapabilities: { input: z.null(), output: z.object({ version: z.literal(1) }) },
  publishActivity: { input: activitySchema, output: z.object({ accepted: z.literal(true), id: z.string(), duplicate: z.boolean() }) },
  dismissActivity: { input: z.object({ id: z.string().max(2048), attentionAt: z.number().finite() }).strict(), output: z.object({ ok: z.boolean() }) },
};

/** One durable row per source + entity. Dismissal keeps the dedup receipt. */
export function createActivities(bb: BbPluginApi, dispatch: (item: ActivityItem, current: () => boolean) => Promise<void>) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS extension_activity (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, occurred_at INTEGER NOT NULL,
      item TEXT NOT NULL, dismissed INTEGER NOT NULL DEFAULT 0)`,
  ]);
  return {
    list(projectId?: string | null, includeFinished = true): ActivityItem[] {
      return (db.prepare("SELECT item FROM extension_activity WHERE dismissed = 0").all() as { item: string }[])
        .map(row => activityItemSchema.parse(JSON.parse(row.item)))
        .filter(item => (!projectId || item.projectId === projectId) && (includeFinished || item.kind !== "finished"));
    },
    handlers: {
      activityCapabilities: () => ({ version: 1 as const }),
      async publishActivity(input: Activity) {
        const id = `activity:${input.sourceId}:${encodeURIComponent(input.entityId)}`;
        const old = db.prepare("SELECT event_id, occurred_at, item FROM extension_activity WHERE id = ?").get(id) as
          { event_id: string; occurred_at: number; item: string } | undefined;
        if (old && (old.event_id === input.eventId || old.occurred_at >= input.occurredAt)) {
          return { accepted: true as const, id, duplicate: true };
        }
        const attentionAt = Math.max(Date.now(), old ? JSON.parse(old.item).attentionAt + 1 : 0);
        const item: ActivityItem = {
          id, sourceName: input.sourceName, projectId: input.projectId,
          href: `/plugins/${input.sourceId}/${input.target.panel}${input.target.segments.map(s => `/${encodeURIComponent(s)}`).join("")}`,
          title: input.title, kind: input.status === "ready" ? "finished" : "error",
          label: `${input.sourceName} · ${input.status === "ready" ? "Ready" : "Couldn’t finish"}`,
          detail: input.body, attentionAt, updatedAt: attentionAt,
        };
        // No await between compare and write: concurrent retries share one receipt.
        // Commit before delivery so a lost RPC response cannot duplicate a ping.
        db.prepare("INSERT OR REPLACE INTO extension_activity (id,event_id,occurred_at,item,dismissed) VALUES (?,?,?,?,0)")
          .run(id, input.eventId, input.occurredAt, JSON.stringify(item));
        bb.realtime.publish("inbox", { total: -1, at: attentionAt });
        try { await dispatch(item, () => {
          const latest = db.prepare("SELECT event_id FROM extension_activity WHERE id = ? AND dismissed = 0").get(id) as { event_id: string } | undefined;
          return latest?.event_id === input.eventId;
        }); }
        catch { bb.log.warn("An extension notification could not be delivered. Its inbox item is saved."); }
        return { accepted: true as const, id, duplicate: false };
      },
      dismissActivity({ id, attentionAt }: { id: string; attentionAt: number }) {
        db.prepare("UPDATE extension_activity SET dismissed = 1 WHERE id = ? AND json_extract(item, '$.attentionAt') <= ?").run(id, attentionAt);
        bb.realtime.publish("inbox", { total: -1, at: Date.now() });
        return { ok: true };
      },
    },
  };
}
