// Attention detection + ranking for the Inbox plugin.
//
// Concept borrowed from bb-plugin-attention (Shane Logsdon, MIT): snapshot every
// visible thread that wants the user and rank error > blocked > finished. We add
// dismissal (snooze) filtering and reuse the snapshot for both the panel and the
// notification dispatcher.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export type AttentionKind = "error" | "blocked" | "finished";

export interface AttentionItem {
  threadId: string;
  projectId: string;
  title: string;
  kind: AttentionKind;
  label: string;
  detail?: string;
  attentionAt: number;
  updatedAt: number;
  /** Internal delivery hint: retained/read completions are not new alerts. */
  notificationEligible?: boolean;
}

export interface Snapshot {
  items: AttentionItem[];
  total: number;
  generatedAt: number;
}

type ThreadDto = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["list"]>
>[number];
type Interaction = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["interactions"]["list"]>
>[number];

// Errors first, then a live block, then retained finished work.
const RANK: Record<AttentionKind, number> = {
  error: 0,
  blocked: 1,
  finished: 2,
};

const THREAD_PAGE_SIZE = 500;
const FINISHED_PREFIX = "finished:";
interface FinishedRecord { attentionAt: number }
export const DISMISS_PREFIX = "dismiss:";

function threadTitle(thread: ThreadDto): string {
  return thread.title ?? thread.titleFallback ?? "Untitled thread";
}

/** Human label + detail for a pending interaction, by payload shape. */
function interactionMeta(interaction: Interaction): {
  label: string;
  detail?: string;
} {
  const payload = interaction.payload;
  if (payload.kind === "user_question") {
    const prompt = payload.questions[0]?.prompt ?? "Answer a question in bb";
    return { label: "Question for you", detail: prompt };
  }
  if (payload.kind === "plugin") {
    return { label: "Awaiting your input", detail: payload.title };
  }
  if (payload.kind === "approval") {
    const subject = payload.subject;
    if (subject.kind === "plan") {
      return {
        label: "Plan ready for review",
        detail: subject.planFilePath ?? "Approve or revise the plan.",
      };
    }
    if (subject.kind === "command") {
      return { label: "Needs approval", detail: subject.command };
    }
    if (subject.kind === "file_change") {
      return {
        label: "Needs approval",
        detail: subject.writeScope ?? "Edit files",
      };
    }
    if (subject.kind === "tool_use") {
      return {
        label: "Needs approval",
        detail: subject.presentation.detail ?? subject.tool,
      };
    }
    // permission_grant
    return { label: "Needs approval", detail: subject.toolName ?? undefined };
  }
  // Generic provider/plugin interaction ({ kind: "ns/name", title, data }).
  return { label: "Awaiting your input", detail: payload.title };
}

/**
 * Classify one thread. Returns null when it does not need the user. `interactions`
 * is fetched lazily by the caller only when the thread might be blocked.
 */
export function classify(
  thread: ThreadDto,
  pending: Interaction | undefined,
): { kind: AttentionKind; label: string; detail?: string } | null {
  if (thread.status === "error" || thread.runtime.displayStatus === "error") {
    return { kind: "error", label: "Failed" };
  }
  if (pending) {
    const meta = interactionMeta(pending);
    return { kind: "blocked", label: meta.label, detail: meta.detail };
  }
  if (
    thread.status === "idle" &&
    thread.latestAttentionAt > 0
  ) {
    return { kind: "finished", label: "Turn finished" };
  }
  return null;
}

/** True when the thread may be blocked and warrants an interactions lookup. */
export function mightBeBlocked(thread: ThreadDto): boolean {
  return thread.hasPendingInteraction || thread.status === "active";
}

export interface SnapshotOptions {
  projectId?: string | null;
  /** thread id -> attentionAt already dismissed; items at/below are hidden. */
  dismissed?: Map<string, number>;
  /** Include retained finished items. Off = only error + blocked. */
  includeFinished?: boolean;
}

export async function buildSnapshot(
  bb: BbPluginApi,
  options: SnapshotOptions = {},
): Promise<Snapshot> {
  const { projectId, dismissed, includeFinished = true } = options;
  const threads: ThreadDto[] = [];
  for (let offset = 0; ; offset += THREAD_PAGE_SIZE) {
    const page = await bb.sdk.threads.list({
      projectId: projectId ?? undefined,
      archived: false,
      limit: THREAD_PAGE_SIZE,
      offset,
    });
    threads.push(...page);
    if (page.length < THREAD_PAGE_SIZE) break;
  }

  const items: AttentionItem[] = [];
  for (const thread of threads) {
    if (thread.visibility !== "visible") continue;
    if (thread.archivedAt !== null || thread.deletedAt !== null) continue;

    let pending: Interaction | undefined;
    if (
      mightBeBlocked(thread) &&
      thread.status !== "error" &&
      thread.runtime.displayStatus !== "error"
    ) {
      try {
        pending = (
          await bb.sdk.threads.interactions.list({ threadId: thread.id })
        ).find((item) => item.status === "pending");
      } catch (error) {
        bb.log.warn(
          `interactions lookup failed for ${thread.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const record = await bb.storage.kv.get<FinishedRecord>(`${FINISHED_PREFIX}${thread.id}`);
    const retained = record && Number.isFinite(record.attentionAt) && record.attentionAt > 0 ? record : undefined;
    let classified = classify(thread, pending);
    let attentionAt = thread.latestAttentionAt;
    if (classified?.kind === "finished") {
      if (retained?.attentionAt !== attentionAt) {
        await bb.storage.kv.set(`${FINISHED_PREFIX}${thread.id}`, { attentionAt } satisfies FinishedRecord);
      }
    } else if (!classified && retained) {
      // A read receipt or another running turn does not clear completed work.
      classified = { kind: "finished", label: "Turn finished" };
      attentionAt = retained.attentionAt;
    }
    if (!classified) continue;
    if (classified.kind === "finished" && !includeFinished) continue;

    // Dismissed until a newer attention moment arrives.
    const dismissedAt = dismissed?.get(thread.id);
    if (dismissedAt !== undefined && attentionAt <= dismissedAt) {
      continue;
    }

    items.push({
      threadId: thread.id,
      projectId: thread.projectId,
      title: threadTitle(thread),
      kind: classified.kind,
      label: classified.label,
      ...(classified.detail ? { detail: classified.detail } : {}),
      attentionAt,
      updatedAt: thread.updatedAt,
      notificationEligible: classified.kind !== "finished" || (
        thread.status === "idle" && attentionAt > (thread.lastReadAt ?? 0)
      ),
    });
  }

  items.sort(
    (a, b) => RANK[a.kind] - RANK[b.kind] || b.attentionAt - a.attentionAt,
  );

  return {
    items,
    total: items.length,
    generatedAt: Date.now(),
  };
}
