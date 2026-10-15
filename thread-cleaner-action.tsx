import { useEffect, useSyncExternalStore } from "react";
import {
  experimental_THREAD_ACTION_GROUPS,
  useRpc,
  type PluginThreadActionRegistration,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import type { CleanerPreview } from "./cleaner";
import { ArchiveReview } from "./cleaner-view";

type ReviewState = { preview: CleanerPreview | null; loading: boolean };
const empty: ReviewState = { preview: null, loading: false };
let state = empty;
let generation = 0;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function update(next: ReviewState) {
  state = next;
  for (const listener of listeners) listener();
}
function close() { ++generation; update(empty); }
function useReview() { return useSyncExternalStore(subscribe, () => state, () => empty); }
function useDoneAction() {
  const rpc = useRpc<typeof rpcContract>();
  const review = useReview();
  return {
    busy: review.loading || review.preview !== null,
    async request(threadId: string) {
      if (state.loading || state.preview) return;
      const current = ++generation;
      update({ preview: null, loading: true });
      try {
        const preview = await rpc.call("cleanerPreview", { threadIds: [threadId], reason: "done" });
        if (generation === current) update({ preview, loading: false });
      } catch (error) {
        if (generation === current) {
          update(empty);
          toast.error(error instanceof Error ? error.message : String(error));
        }
      }
    },
  };
}

export const markThreadDoneAction: PluginThreadActionRegistration<ReturnType<typeof useDoneAction>> = {
  id: "mark-done",
  title: "Mark done & archive",
  icon: "CircleCheck",
  group: experimental_THREAD_ACTION_GROUPS.lifecycle,
  order: 0,
  useData: useDoneAction,
  item({ thread, data }) {
    if (thread.archivedAt !== null) return null;
    const blocked = thread.pinnedAt !== null ? "Unpin this thread first" :
      !["idle", "error"].includes(thread.status) ? "Wait for this thread to stop running" : null;
    return {
      label: "Mark done & archive",
      detail: blocked ?? "Needs You",
      icon: "CircleCheck",
      disabled: data.busy || blocked !== null,
      run: () => data.request(thread.id),
    };
  },
};

export function ThreadDoneOverlay() {
  const review = useReview();
  useEffect(() => () => close(), []);
  return <ArchiveReview preview={review.preview} close={close} complete={() => {}} />;
}
