import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

type Thread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number];
const reason = z.enum(["done", "unneeded"]);
const ids = z.array(z.string().min(1)).min(1).max(100);
const row = z.object({
  id: z.string(), title: z.string(), projectId: z.string(), projectName: z.string(),
  updatedAt: z.number(), archivedAt: z.number().nullable(), status: z.string(),
  blocked: z.string().nullable(), reason: reason.nullable(),
});
export type CleanerRow = z.infer<typeof row>;
const preview = z.object({ token: z.string(), items: z.array(row), reason });
export type CleanerPreview = z.infer<typeof preview>;
export const cleanerRpc = {
  cleanerList: {
    input: z.object({ archived: z.boolean().default(false), query: z.string().max(200).default(""),
      projectId: z.string().nullable().default(null), olderThanDays: z.number().int().min(0).max(3650).default(0),
      offset: z.number().int().min(0).default(0) }),
    output: z.object({ items: z.array(row), total: z.number(), projects: z.array(z.object({ id: z.string(), name: z.string() })) }),
  },
  cleanerPreview: { input: z.object({ threadIds: ids, reason }), output: preview },
  cleanerArchive: { input: z.object({ token: z.string() }), output: z.object({ archivedIds: z.array(z.string()), errors: z.array(z.string()) }) },
  cleanerRestore: { input: z.object({ threadIds: ids }), output: z.object({ restoredIds: z.array(z.string()), errors: z.array(z.string()) }) },
};

export function blockedReason(t: Thread): string | null {
  if (!["idle", "error"].includes(t.status) || !["idle", "error"].includes(t.runtime.displayStatus)) return "Still running or queued";
  if (t.hasPendingInteraction) return "Waiting for your answer";
  if (t.pinnedAt !== null) return "Pinned — unpin to archive";
  if (t.queuedWork !== "none") return "Has queued messages";
  if (Object.values(t.activity).some(n => n > 0)) return "Has active background work";
  return null;
}

// Match BB's cascading lifecycle, including hidden forks and explicit owners.
export function archiveFamily(root: string, threads: Thread[]): Thread[] {
  const found = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of threads) {
      if (!found.has(t.id) && ((t.parentThreadId && found.has(t.parentThreadId)) ||
        (t.lifecycleOwnerThreadId && found.has(t.lifecycleOwnerThreadId)) ||
        (t.visibility === "hidden" && t.sourceThreadId && found.has(t.sourceThreadId)))) {
        found.add(t.id); changed = true;
      }
    }
  }
  return threads.filter(t => found.has(t.id));
}

export function createCleaner(bb: BbPluginApi) {
  const plans = new Map<string, { expires: number; roots: string[]; fingerprint: string; reason: z.infer<typeof reason> }>();
  const prefix = "cleaner:";
  async function all(archived: boolean) {
    const result: Thread[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await bb.sdk.threads.list({ archived, includeHidden: true, limit: 500, offset });
      result.push(...page.filter(t => t.deletedAt === null && (t.archivedAt !== null) === archived));
      if (page.length < 500) return result;
    }
  }
  async function projectNames() {
    return (await bb.sdk.projects.list({ includePersonal: true })).map(p => ({ id: p.id, name: p.name }));
  }
  async function rows(threads: Thread[], projects: { id: string; name: string }[]) {
    return Promise.all(threads.map(async t => {
      const saved = await bb.storage.kv.get<{ reason: string }>(prefix + t.id);
      return { id: t.id, title: t.title ?? t.titleFallback ?? "Untitled thread", projectId: t.projectId,
        projectName: projects.find(p => p.id === t.projectId)?.name ?? t.projectId,
        updatedAt: t.updatedAt, archivedAt: t.archivedAt, status: t.runtime.displayStatus,
        blocked: blockedReason(t), reason: saved?.reason === "done" || saved?.reason === "unneeded" ? saved.reason : null } satisfies CleanerRow;
    }));
  }
  function targets(roots: string[], threads: Thread[]) {
    for (const id of roots) if (!threads.some(t => t.id === id && t.visibility === "visible")) throw new Error("A selected thread changed. Refresh and select it again.");
    const affected = [...new Map(roots.flatMap(id => archiveFamily(id, threads)).map(t => [t.id, t])).values()];
    for (const t of affected) {
      const blocked = blockedReason(t);
      if (blocked) throw new Error(`${t.title ?? t.id}: ${blocked}. Its parent cannot be archived either.`);
    }
    return affected;
  }
  function fingerprint(threads: Thread[]) {
    return JSON.stringify(threads.map(t => [t.id, t.updatedAt, t.parentThreadId, t.lifecycleOwnerThreadId, t.sourceThreadId]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  }
  return {
    async cleanerList(input: z.infer<typeof cleanerRpc.cleanerList.input>) {
      const [threads, projects] = await Promise.all([all(input.archived), projectNames()]);
      const query = input.query.trim().toLowerCase();
      const filtered = threads.filter(t => t.visibility === "visible" &&
        (!input.projectId || t.projectId === input.projectId) &&
        (!input.olderThanDays || t.updatedAt <= Date.now() - input.olderThanDays * 86400000) &&
        (!query || `${t.title ?? ""} ${t.titleFallback ?? ""} ${t.id}`.toLowerCase().includes(query)))
        .sort((a, b) => input.archived ? (b.archivedAt ?? 0) - (a.archivedAt ?? 0) : a.updatedAt - b.updatedAt);
      const items = await rows(filtered.slice(input.offset, input.offset + 100), projects);
      if (!input.archived) for (const item of items) {
        if (!item.blocked && archiveFamily(item.id, threads).some(t => blockedReason(t))) item.blocked = "A child thread still needs keeping";
      }
      return { items, total: filtered.length, projects };
    },
    async cleanerPreview(input: z.infer<typeof cleanerRpc.cleanerPreview.input>) {
      const threads = await all(false);
      const affected = targets(input.threadIds, threads);
      const now = Date.now();
      for (const [key, plan] of plans) if (plan.expires < now) plans.delete(key);
      if (plans.size >= 100) plans.delete(plans.keys().next().value!);
      const token = randomUUID();
      plans.set(token, { expires: now + 300000, roots: [...new Set(input.threadIds)], fingerprint: fingerprint(affected), reason: input.reason });
      return { token, items: await rows(affected, await projectNames()), reason: input.reason };
    },
    async cleanerArchive({ token }: { token: string }) {
      const plan = plans.get(token);
      plans.delete(token);
      if (!plan || plan.expires < Date.now()) throw new Error("Preview expired. Review your selection again.");
      const affected = targets(plan.roots, await all(false));
      if (fingerprint(affected) !== plan.fingerprint) throw new Error("Threads changed since the preview. Review your selection again.");
      const archivedIds = new Set<string>(), errors: string[] = [];
      // Larger families first to avoid archiving an already-archived child twice.
      const roots = [...plan.roots].sort((a, b) => archiveFamily(b, affected).length - archiveFamily(a, affected).length);
      for (const id of roots) {
        if (archivedIds.has(id)) continue;
        try {
          // Check again immediately before each host operation, including descendants.
          const fresh = targets([id], await all(false));
          if (fresh.some(t => !affected.some(old => old.id === t.id && old.updatedAt === t.updatedAt))) throw new Error("Thread changed; review it again");
          const result = await bb.sdk.threads.archive({ threadId: id });
          const batchId = randomUUID();
          for (const archivedId of result.archivedThreadIds) {
            archivedIds.add(archivedId);
            await bb.storage.kv.set(prefix + archivedId, { reason: plan.reason, at: Date.now(), batchId, ...(archivedId === id ? { familyIds: result.archivedThreadIds } : {}) });
          }
        } catch (error) { errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      bb.realtime.publish("inbox", { at: Date.now() });
      return { archivedIds: [...archivedIds], errors };
    },
    async cleanerRestore({ threadIds }: { threadIds: string[] }) {
      const restoredIds: string[] = [], errors: string[] = [];
      const restoreIds = new Set(threadIds);
      for (const id of threadIds) {
        const saved = await bb.storage.kv.get<{ batchId?: string; familyIds?: string[] }>(prefix + id);
        if (saved?.batchId && Array.isArray(saved.familyIds)) for (const childId of saved.familyIds) {
          const child = await bb.storage.kv.get<{ batchId?: string }>(prefix + childId);
          if (child?.batchId === saved.batchId) restoreIds.add(childId);
        }
      }
      for (const threadId of restoreIds) {
        try {
          const thread = await bb.sdk.threads.get({ threadId });
          if (thread.deletedAt !== null) throw new Error("Thread was deleted");
          if (thread.archivedAt !== null) await bb.sdk.threads.unarchive({ threadId });
          restoredIds.push(threadId);
          await bb.storage.kv.delete(prefix + threadId);
        } catch (error) { errors.push(`${threadId}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      bb.realtime.publish("inbox", { at: Date.now() });
      return { restoredIds, errors };
    },
  };
}
