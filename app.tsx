// bb-plugin-inbox — frontend entry.
//
// A "Needs You" inbox: nav panel + homepage section + sidebar count badge.
// Lists threads that need you, ranked error > blocked > finished, each a
// one-click jump to the thread with a dismiss button.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  definePluginApp,
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { BbNavigate } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import { Icon, type IconName } from "@/components/ui/icon";
import { INBOX_STYLES } from "./styles";
import { NeedsYouMark } from "./components/needs-you-mark";
import { SettingsView, useSetup, WelcomeSetup } from "./settings-view";

import { isActivityHref, viewingActivity } from "./destinations";

type Kind = "error" | "blocked" | "finished";

interface Item {
  threadId?: string;
  id?: string;
  href?: string;
  sourceName?: string;
  projectId: string;
  title: string;
  kind: Kind;
  label: string;
  detail?: string;
  attentionAt: number;
  updatedAt: number;
}

function itemKey(item: { id?: string; threadId?: string }): string { return item.id ?? item.threadId ?? ""; }
function openItem(nav: BbNavigate, item: { href?: string; threadId?: string }) {
  if (isActivityHref(item.href)) window.location.assign(item.href);
  else if (item.threadId) openThread(nav, item.threadId);
}

interface ListResult {
  items: Item[];
  total: number;
  generatedAt: number;
}

const KIND_ICON: Record<Kind, IconName> = {
  error: "AlertCircle",
  blocked: "MessageQuestion",
  finished: "CircleCheck",
};

function InboxStyles() {
  return <style>{INBOX_STYLES}</style>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

// Bring the opened thread's sidebar row into view. bb's sidebar has two thread
// lists and only one self-scrolls:
//   1. The search list renders each row as a listbox option with a per-thread id
//      (`bb-sidebar-thread-search-results-option-<threadId>`) and scrolls the
//      active one into view itself.
//   2. The default list is a shadcn sidebar: rows are
//      `<button data-sidebar="menu-button" aria-current="page">` when active,
//      with NO self-scroll — so navigating from this panel leaves the row
//      wherever the list was scrolled, which is the bug.
// We handle both: prefer the search list's exact per-thread id, else the default
// list's freshly-active row. We poll briefly because the row becomes active a
// beat after we navigate, and we skip the row that was active *before* the jump
// so we don't scroll to the thread we're leaving. scrollIntoView({block:"nearest"})
// is a no-op when the row is already visible, so this never fights the host.
const SIDEBAR_THREAD_LISTBOX_ID = "bb-sidebar-thread-search-results";
const ACTIVE_SIDEBAR_ROW_SELECTOR =
  '[data-sidebar="menu-button"][aria-current="page"]';

// The active default-list row. When a project row is active too, the thread row
// is the deeper one, i.e. last in document order.
function activeSidebarRow(): HTMLElement | null {
  const rows = document.querySelectorAll<HTMLElement>(
    ACTIVE_SIDEBAR_ROW_SELECTOR,
  );
  return rows.length ? rows[rows.length - 1] : null;
}

function revealThreadInSidebar(threadId: string): void {
  if (typeof document === "undefined") return;
  const optionId = `${SIDEBAR_THREAD_LISTBOX_ID}-option-${threadId}`;
  const wasActive = activeSidebarRow();
  const deadline = Date.now() + 3000;
  const tick = () => {
    const exact = document.getElementById(optionId);
    if (exact) {
      exact.scrollIntoView({ block: "nearest" });
      return;
    }
    const active = activeSidebarRow();
    if (active && active !== wasActive) {
      active.scrollIntoView({ block: "nearest" });
      return;
    }
    if (Date.now() < deadline) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Open a thread from the inbox, then bring its sidebar row into view.
function openThread(nav: BbNavigate, threadId: string): void {
  nav.toThread(threadId);
  revealThreadInSidebar(threadId);
}

function useInbox(includeFinished: boolean) {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());
  const pendingDismissals = useRef(new Set<string>());
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const mine = ++reqId.current;
    setLoading(true);
    try {
      const res = await rpc.call("list", { projectId: null, includeFinished });
      if (mine === reqId.current) {
        setData(res as ListResult);
        setError(null);
      }
    } catch (err) {
      if (mine === reqId.current) setError(errorMessage(err));
    } finally {
      if (mine === reqId.current) setLoading(false);
    }
  }, [rpc, includeFinished]);

  useEffect(() => {
    void load();
    return () => { ++reqId.current; };
  }, [load]);
  useRealtime("inbox", () => void load());

  const dismiss = useCallback(async (item: Item) => {
    if (pendingDismissals.current.has(itemKey(item))) return;
    pendingDismissals.current.add(itemKey(item));
    setDismissing(new Set(pendingDismissals.current));
    try {
      if (item.id) await rpc.call("dismissActivity", { id: item.id, attentionAt: item.attentionAt });
      else if (item.threadId) await rpc.call("dismiss", { threadId: item.threadId, attentionAt: item.attentionAt });
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      pendingDismissals.current.delete(itemKey(item));
      setDismissing(new Set(pendingDismissals.current));
    }
  }, [rpc, load]);

  return { data, loading, error, dismiss, dismissing, reload: load };
}

function ItemRow({ item, onOpen, onDismiss, dismissing }: {
  item: Item;
  onOpen: () => void;
  onDismiss: () => void;
  dismissing: boolean;
}) {
  const descriptionId = useId();
  return (
    <li className="ny-row">
      <button type="button" className="ny-open" onClick={onOpen} aria-label={`Open ${item.title}`}
        aria-describedby={`${descriptionId}${item.detail ? ` ${descriptionId}-detail` : ""}`}>
        <span className="ny-status-icon" data-kind={item.kind}>
          <Icon name={item.kind === "blocked" && item.label === "Needs approval" ? "Lock" : KIND_ICON[item.kind]} aria-hidden />
        </span>
        <span className="ny-item-text">
          <strong className="ny-item-title">{item.title}</strong>
          <span className="ny-item-reason" id={descriptionId}>{item.label}</span>
          {item.detail && <span className="ny-item-detail" id={`${descriptionId}-detail`}>{item.detail}</span>}
        </span>
      </button>
      <span className="ny-row-end">
        <time className="ny-time" dateTime={new Date(item.attentionAt).toISOString()} title={new Date(item.attentionAt).toLocaleString()}>
          {relativeTime(item.attentionAt)}
        </time>
        <button type="button" className="ny-icon-button" onClick={onDismiss}
          aria-label={`Dismiss ${item.title}`} disabled={dismissing} aria-busy={dismissing}>
          {dismissing ? <span className="ny-spinner" aria-hidden /> : <Icon name="X" aria-hidden />}
        </button>
      </span>
    </li>
  );
}

type InboxActions = Pick<ReturnType<typeof useInbox>, "dismiss" | "dismissing">;

function ItemList({ items, dismiss, dismissing }: { items: Item[] } & InboxActions) {
  const nav = useBbNavigate();
  return (
    <ul className="ny-rows">
      {items.map(item => <ItemRow key={itemKey(item)} item={item}
        onOpen={() => openItem(nav, item)} onDismiss={() => void dismiss(item)}
        dismissing={dismissing.has(itemKey(item))} />)}
    </ul>
  );
}

function ItemGroup({ title, items, ...actions }: { title: string; items: Item[] } & InboxActions) {
  const id = useId();
  if (items.length === 0) return null;
  return (
    <section className="ny-group" aria-labelledby={id}>
      <div className="ny-group-heading"><h3 id={id}>{title}</h3><span className="ny-count">{items.length}</span></div>
      <ItemList items={items} {...actions} />
    </section>
  );
}

function InboxError({ hasData, retry, loading }: { hasData: boolean; retry: () => void; loading: boolean }) {
  return (
    <div className="ny-load-error" role="alert">
      <Icon name="AlertCircle" aria-hidden />
      <div>
        <strong>{hasData ? "Couldn’t refresh your inbox" : "Couldn’t load your inbox"}</strong>
        <p>{hasData ? "Your last loaded items are still shown. Try again to get the latest updates." : "Try again to see which threads need you."}</p>
        <button type="button" className="ny-retry" onClick={retry} disabled={loading}>{loading ? "Trying again…" : "Try again"}</button>
      </div>
    </div>
  );
}

function EmptyInbox() {
  return <div className="ny-empty">
    <span className="ny-empty-icon"><Icon name="CircleCheck" aria-hidden /></span>
    <h3>Nothing needs you right now.</h3>
    <p>Questions, failed runs, and finished work will appear here.</p>
  </div>;
}

function InboxPanel({ subPath = "" }: { subPath?: string }) {
  const setup = useSetup();
  const [view, setView] = useState<"inbox" | "settings">(subPath === "settings" ? "settings" : "inbox");
  const inbox = useInbox(true);
  const items = inbox.data?.items ?? [];
  const failed = items.filter(item => item.kind === "error");
  const waiting = items.filter(item => item.kind === "blocked");
  const finished = items.filter(item => item.kind === "finished");
  const active = failed.length + waiting.length;
  const initialLoading = inbox.loading && !inbox.data;
  const actions = { dismiss: inbox.dismiss, dismissing: inbox.dismissing };

  return (
    <div className="ny-panel">
      <InboxStyles />
      <div className="ny-panel-inner">
        <header className="ny-header">
          <div>
            <h2>Needs You</h2>
            <p className="ny-summary" role="status">
              {initialLoading ? "Checking your threads…" : !inbox.data && inbox.error ? "Unable to check your threads" : active > 0
                ? <><strong>{active} item{active === 1 ? "" : "s"}</strong> need{active === 1 ? "s" : ""} your attention</>
                : "No waiting or failed work."}
            </p>
          </div>
          <nav className="ny-view-nav" aria-label="Needs You views">
            <button type="button" aria-pressed={view === "inbox"} onClick={() => setView("inbox")}>Inbox</button>
            <button type="button" aria-pressed={view === "settings"} onClick={() => setView("settings")}>Settings</button>
          </nav>
        </header>
        {setup.update?.outcome === "update-available" && view === "inbox" && <div className="ny-update-notice" role="status">
          <span>Update available: {setup.update.latestVersion}</span><button onClick={() => setView("settings")}>View update</button>
        </div>}
        {setup.error && <p className="ny-setup-error" role="status">{setup.error} <button onClick={() => void setup.load()}>Retry setup</button></p>}
        {view === "settings" && !setup.state && <p role="status">{setup.error || "Loading settings…"}</p>}
        {setup.state && <div hidden={view !== "settings"}><SettingsView model={setup} back={() => setView("inbox")} /></div>}
        <div hidden={view !== "inbox"}>
        <WelcomeSetup model={setup} openSettings={() => setView("settings")} />
        {inbox.error && <InboxError hasData={!!inbox.data} loading={inbox.loading} retry={() => void inbox.reload()} />}
        {initialLoading ? <div className="ny-loading" role="status">
          <span className="ny-sr-only">Loading inbox</span>
          {[0, 1, 2].map(i => <div key={i} aria-hidden><div className="ny-skeleton" /><div className="ny-skeleton ny-skeleton-short" /></div>)}
        </div> : inbox.data ? <>
          {items.length === 0 && !inbox.error && <EmptyInbox />}
          <ItemGroup title="Failed" items={failed} {...actions} />
          <ItemGroup title="Waiting for you" items={waiting} {...actions} />
          {finished.length > 0 && <div className="ny-finished">
            <ItemGroup title="Finished" items={finished} {...actions} />
            <p className="ny-finished-note">Finished work stays here until you dismiss it.</p>
          </div>}
        </> : null}
        </div>
      </div>
    </div>
  );
}

// A smaller version of the same inbox on the new-thread screen.
function HomepageInbox() {
  const inbox = useInbox(false);
  const nav = useBbNavigate();
  const items = (inbox.data?.items ?? []).slice(0, 5);
  const actions = { dismiss: inbox.dismiss, dismissing: inbox.dismissing };
  if (!inbox.error && (inbox.loading && !inbox.data || items.length === 0)) return null;
  return (
    <section className="ny-home" aria-label="Needs You inbox">
      <InboxStyles />
      <header className="ny-home-header">
        <h3><NeedsYouMark /> Needs You <span className="ny-count">{inbox.data?.total ?? 0}</span></h3>
        <button type="button" className="ny-view-inbox" onClick={() => nav.toPluginPanel("inbox")}>View inbox <Icon name="ArrowRight" aria-hidden /></button>
      </header>
      {inbox.error && <InboxError hasData={!!inbox.data} loading={inbox.loading} retry={() => void inbox.reload()} />}
      <ItemGroup title="Failed" items={items.filter(item => item.kind === "error")} {...actions} />
      <ItemGroup title="Waiting for you" items={items.filter(item => item.kind === "blocked")} {...actions} />
    </section>
  );
}

// Sidebar accessory: a small count of outstanding items.
function InboxBadge() {
  const rpc = useRpc<typeof rpcContract>();
  const [total, setTotal] = useState(0);
  const load = useCallback(async () => {
    try {
      const res = await rpc.call("list", { projectId: null, includeFinished: false });
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
    <span className="ny-badge">
      {total > 99 ? "99+" : total}
    </span>
  );
}

// Payload of the `inbox:toast` realtime channel (server.ts `maybeNotify`).
interface ToastEvent {
  threadId?: string;
  id?: string;
  href?: string;
  sourceName?: string;
  projectId: string;
  kind: Kind;
  title: string;
  label: string;
  detail: string | null;
  attentionAt: number;
  at: number;
}

function isToastEvent(payload: unknown): payload is ToastEvent {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return (
    ((typeof p.threadId === "string" && p.id === undefined && p.href === undefined) ||
      (typeof p.id === "string" && p.id.startsWith("activity:") && p.threadId === undefined && isActivityHref(p.href))) &&
    typeof p.title === "string" &&
    typeof p.label === "string" &&
    typeof p.attentionAt === "number" && Number.isFinite(p.attentionAt) &&
    (p.detail == null || typeof p.detail === "string") &&
    (p.kind === "error" || p.kind === "blocked" || p.kind === "finished")
  );
}

function ToastContent({ event }: { event: ToastEvent }) {
  return <>
    <div className="ny-toast-brand"><NeedsYouMark /><span>Needs You</span><span className="ny-toast-time">Now</span></div>
    <div className="ny-toast-kind" data-kind={event.kind}>{event.label}</div>
    <strong className="ny-toast-thread">{event.title}</strong>
    {event.detail && <div className="ny-toast-detail">{event.detail}</div>}
  </>;
}

// Uses BB's existing Sonner host and lifecycle, with plugin-scoped presentation.
function NeedsYouToaster() {
  const nav = useBbNavigate();
  const { threadId: activeThreadId } = useBbContext();
  const navRef = useRef(nav);
  const activeThreadRef = useRef(activeThreadId);
  const visibleToasts = useRef(new Map<string, ToastEvent>());
  const dismissedToasts = useRef(new Set<string>());
  const latestAttention = useRef(new Map<string, number>());
  navRef.current = nav;
  activeThreadRef.current = activeThreadId;

  // Reading a thread makes its existing popup redundant in this window.
  // Keep desktop/Telegram delivery and the unresolved inbox item independent.
  useEffect(() => {
    const removed: string[] = [];
    for (const [id, event] of visibleToasts.current) {
      if ((event.threadId && event.threadId === activeThreadId) || viewingActivity(event.href)) {
        toast.dismiss(id);
        visibleToasts.current.delete(id);
        removed.push(id);
      }
    }
    if (removed.length === 0) return;
    // Sonner queues insertion. Also dismiss after that queue has flushed when
    // navigation follows a realtime event in the same tick.
    const timer = setTimeout(() => {
      for (const id of removed) toast.dismiss(id);
    }, 0);
    return () => clearTimeout(timer);
  }, [activeThreadId]);

  useEffect(() => {
    const visible = visibleToasts.current;
    return () => {
      for (const id of visible.keys()) toast.dismiss(id);
      visible.clear();
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      for (const [id, event] of visibleToasts.current) if (viewingActivity(event.href)) {
        toast.dismiss(id);
        visibleToasts.current.delete(id);
      }
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const onEvent = useCallback((payload: unknown) => {
    if (!isToastEvent(payload)) return;
    const ev = payload;
    const key = itemKey(ev);
    const episode = `needs-you:${key}:${ev.attentionAt}:${ev.kind}`;
    if (
      (ev.threadId && ev.threadId === activeThreadRef.current) || viewingActivity(ev.href) ||
      dismissedToasts.current.has(episode) ||
      ev.attentionAt < (latestAttention.current.get(key) ?? -Infinity)
    ) return;

    // Reuse the visible popup, but give a new episode its own ID after closing.
    // Reusing a closing Sonner ID lets its exit animation remove the new alert.
    const id = [...visibleToasts.current].find(([, event]) => itemKey(event) === key)?.[0] ?? episode;
    latestAttention.current.set(key, ev.attentionAt);
    visibleToasts.current.set(id, ev);
    toast.message(() => <ToastContent event={ev} />, {
      className: "ny-toast",
      classNames: { content: "ny-toast-content", closeButton: "ny-toast-close", actionButton: "ny-toast-action" },
      richColors: false,
      // One popup per thread. A later completion or change of reason replaces
      // the visible popup while dismissal still belongs to its exact episode.
      id,
      duration: ev.kind === "finished" ? 8000 : 15000,
      closeButton: true,
      onDismiss: () => {
        // A new event can arrive before Sonner rerenders its close button.
        const current = visibleToasts.current.get(id) ?? ev;
        dismissedToasts.current.add(`needs-you:${itemKey(current)}:${current.attentionAt}:${current.kind}`);
        visibleToasts.current.delete(id);
      },
      onAutoClose: () => visibleToasts.current.delete(id),
      action: {
        label: <>{ev.href ? (ev.sourceName === "Guided Review" ? "Open review" : "Open activity") : "Open thread"} <Icon name="ArrowRight" aria-hidden /></>,
        onClick: () => openItem(navRef.current, ev),
      },
    });
  }, []);

  useRealtime("inbox:toast", onEvent);
  return null;
}

// Single accessory slot, so it carries both the count badge and the (invisible)
// toast listener that must stay mounted alongside it.
function InboxAccessory() {
  return (
    <>
      <InboxStyles />
      <NeedsYouToaster />
      <InboxBadge />
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "inbox",
    title: "Needs You",
    icon: "Inbox",
    path: "inbox",
    component: InboxPanel,
    experimental_sidebarAccessory: InboxAccessory,
  });
  app.slots.homepageSection({
    id: "inbox",
    title: "Needs You",
    component: HomepageInbox,
  });
});
