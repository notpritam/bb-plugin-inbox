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

// error first, then a live block on the user, then a finished-but-unread turn.
const RANK: Record<AttentionKind, number> = {
  error: 0,
  blocked: 1,
  finished: 2,
};

const MAX_ITEMS = 25;
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
  // provider approval
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
  return { label: "Needs approval", detail: subject.toolName ?? undefined };
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
    thread.latestAttentionAt > (thread.lastReadAt ?? 0)
  ) {
    return { kind: "finished", label: "Turn finished — reply needed" };
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
  /** Include 'finished' (unread) items. Off = only error + blocked. */
  includeFinished?: boolean;
}

export async function buildSnapshot(
  bb: BbPluginApi,
  options: SnapshotOptions = {},
): Promise<Snapshot> {
  const { projectId, dismissed, includeFinished = true } = options;
  const threads = await bb.sdk.threads.list({
    projectId: projectId ?? undefined,
    archived: false,
    limit: 500,
  });

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

    const classified = classify(thread, pending);
    if (!classified) continue;
    if (classified.kind === "finished" && !includeFinished) continue;

    // Dismissed until a newer attention moment arrives.
    const dismissedAt = dismissed?.get(thread.id);
    if (dismissedAt !== undefined && thread.latestAttentionAt <= dismissedAt) {
      continue;
    }

    items.push({
      threadId: thread.id,
      projectId: thread.projectId,
      title: threadTitle(thread),
      kind: classified.kind,
      label: classified.label,
      ...(classified.detail ? { detail: classified.detail } : {}),
      attentionAt: thread.latestAttentionAt,
      updatedAt: thread.updatedAt,
    });
  }

  items.sort(
    (a, b) => RANK[a.kind] - RANK[b.kind] || b.attentionAt - a.attentionAt,
  );

  return {
    items: items.slice(0, MAX_ITEMS),
    total: items.length,
    generatedAt: Date.now(),
  };
}
