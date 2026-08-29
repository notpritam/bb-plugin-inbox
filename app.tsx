// bb-plugin-inbox — frontend entry.
//
// A "Needs You" inbox: nav panel + homepage section + sidebar count badge.
// Lists threads that need you, ranked error > blocked > finished, each a
// one-click jump to the thread with a dismiss button.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type Kind = "error" | "blocked" | "finished";

interface Item {
  threadId: string;
  projectId: string;
  title: string;
  kind: Kind;
  label: string;
  detail?: string;
  attentionAt: number;
  updatedAt: number;
}

interface ListResult {
  items: Item[];
  total: number;
  generatedAt: number;
}

const KIND_META: Record<
  Kind,
  { icon: IconName; className: string; order: number }
> = {
  error: { icon: "AlertCircle", className: "text-destructive", order: 0 },
  blocked: { icon: "MessageQuestion", className: "text-primary", order: 1 },
  finished: { icon: "CircleCheck", className: "text-muted-foreground", order: 2 },
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function useInbox(includeFinished: boolean) {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const mine = ++reqId.current;
    try {
      const res = await rpc.call("list", { projectId: null, includeFinished });
      if (mine === reqId.current) setData(res as ListResult);
    } catch (err) {
      if (mine === reqId.current) toast.error(errorMessage(err));
    } finally {
      if (mine === reqId.current) setLoading(false);
    }
  }, [rpc, includeFinished]);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtime("inbox", () => void load());

  const dismiss = useCallback(
    async (item: Item) => {
      try {
        await rpc.call("dismiss", {
          threadId: item.threadId,
          attentionAt: item.attentionAt,
        });
        await load();
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
    [rpc, load],
  );

  return { data, loading, dismiss, reload: load };
}

function ItemRow({
  item,
  onOpen,
  onDismiss,
}: {
  item: Item;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const meta = KIND_META[item.kind];
  return (
    <li className="group flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-muted/50">
      <Icon
        name={meta.icon}
        className={cn("mt-0.5 size-4 shrink-0", meta.className)}
        aria-hidden
      />
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
      >
        <div className="truncate text-sm font-medium text-foreground">
          {item.title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
          <span className={cn("font-medium", meta.className)}>{item.label}</span>
          {item.detail && (
            <span className="truncate">· {item.detail}</span>
          )}
          <span>· {relativeTime(item.attentionAt)}</span>
        </div>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="mt-0.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground hover:!text-foreground"
      >
        <Icon name="X" className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}

function InboxPanel() {
  const [includeFinished, setIncludeFinished] = useState(true);
  const { data, loading, dismiss } = useInbox(includeFinished);
  const nav = useBbNavigate();
  const items = data?.items ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="text-sm text-muted-foreground">
          {loading
            ? "Loading…"
            : items.length === 0
              ? "You're all caught up"
              : `${data?.total} need${data?.total === 1 ? "s" : ""} you`}
        </span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={includeFinished}
            onChange={(e) => setIncludeFinished(e.target.checked)}
          />
          Include finished
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loading ? null : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-2 py-10 text-center text-sm text-muted-foreground">
            <Icon name="CircleCheck" className="size-6" aria-hidden />
            <span>Nothing needs you right now.</span>
          </div>
        ) : (
          <ul className="flex flex-col">
            {items.map((item) => (
              <ItemRow
                key={item.threadId}
                item={item}
                onOpen={() => nav.toThread(item.threadId)}
                onDismiss={() => void dismiss(item)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Homepage section: a compact top-of-inbox view on the new-thread screen.
function HomepageInbox() {
  const { data, loading, dismiss } = useInbox(false);
  const nav = useBbNavigate();
  const items = (data?.items ?? []).slice(0, 5);
  if (loading || items.length === 0) return null;
  return (
    <div className="rounded-lg border border-border">
      <div className="border-b border-border px-3 py-2 text-sm font-medium text-foreground">
        Needs you
      </div>
      <ul className="flex flex-col p-1">
        {items.map((item) => (
          <ItemRow
            key={item.threadId}
            item={item}
            onOpen={() => nav.toThread(item.threadId)}
            onDismiss={() => void dismiss(item)}
          />
        ))}
      </ul>
    </div>
  );
}

// Sidebar accessory: a small count of outstanding items.
function InboxBadge() {
  const rpc = useRpc<typeof rpcContract>();
  const [total, setTotal] = useState(0);
  const load = useCallback(async () => {
    try {
      const res = await rpc.call("list", { projectId: null, includeFinished: true });
      setTotal((res as ListResult).total);
    } catch {
      // ignore — accessory is best-effort
    }
  }, [rpc]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime("inbox", () => void load());
  if (total <= 0) return null;
  return (
    <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
      {total > 99 ? "99+" : total}
    </span>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "inbox",
    title: "Needs You",
    icon: "AlertCircle",
    path: "inbox",
    component: InboxPanel,
    experimental_sidebarAccessory: InboxBadge,
  });
  app.slots.homepageSection({
    id: "inbox",
    title: "Needs You",
    component: HomepageInbox,
  });
});
