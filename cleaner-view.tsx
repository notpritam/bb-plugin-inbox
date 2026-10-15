import { useCallback, useEffect, useRef, useState } from "react";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { CleanerPreview, CleanerRow } from "./cleaner";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./components/ui/dialog";
import { toast } from "sonner";

type Result = { items: CleanerRow[]; total: number; projects: { id: string; name: string }[] };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function ArchiveReview({ preview, close, complete }: {
  preview: CleanerPreview | null; close: () => void; complete: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [preview]);
  async function archive() {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const result = await rpc.call("cleanerArchive", { token: preview.token });
      if (result.archivedIds.length) toast.success(`${result.archivedIds.length} thread${result.archivedIds.length === 1 ? "" : "s"} archived`);
      if (result.errors.length) toast.error(result.errors.join("\n"), { duration: 12000 });
      complete(); close();
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  return <Dialog open={!!preview} onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent>
      <DialogTitle>{preview?.reason === "done" ? "Mark done & archive" : "Archive unwanted threads"}</DialogTitle>
      <DialogDescription>
        {preview?.items.length} thread{preview?.items.length === 1 ? "" : "s"}, including any children, will leave your sidebar. Conversation history stays available in Archived.
      </DialogDescription>
      <p className="text-sm text-muted-foreground">BB may remove managed workspace files after archiving. Save any files you need first. Restoring a conversation does not recover removed files.</p>
      <ul className="max-h-60 overflow-y-auto text-sm space-y-2" aria-label="Threads to archive">
        {preview?.items.map(item => <li key={item.id}><strong>{item.title}</strong><span className="block text-xs text-muted-foreground">{item.projectName}</span></li>)}
      </ul>
      {preview?.reason === "done" && <p className="text-xs text-muted-foreground">Records this thread as done in Needs You. Linked Tracker tasks keep their own status.</p>}
      {error && <p role="alert" className="text-sm">{error} Close this preview and try again.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={close}>Cancel</Button>
        <Button disabled={busy || !!error} onClick={() => void archive()}>{busy ? "Archiving…" : "Confirm archive"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

export function ArchiveThreadButton({ threadId, title }: { threadId: string; title: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [preview, setPreview] = useState<CleanerPreview | null>(null);
  const [busy, setBusy] = useState(false);
  return <>
    <Button variant="ghost" size="sm" aria-label={`Done and archive ${title}`} disabled={busy} onClick={async () => {
      setBusy(true);
      try { setPreview(await rpc.call("cleanerPreview", { threadIds: [threadId], reason: "done" })); }
      catch (error) { toast.error(message(error)); }
      finally { setBusy(false); }
    }}>Done & archive</Button>
    <ArchiveReview preview={preview} close={() => setPreview(null)} complete={() => {}} />
  </>;
}

export function CleanerView() {
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [olderThanDays, setOlderThanDays] = useState(0);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Result | null>(null);
  const [selected, setSelected] = useState(new Set<string>());
  const [preview, setPreview] = useState<CleanerPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    try {
      const result = await rpc.call("cleanerList", { archived, query, projectId, olderThanDays, offset });
      if (current !== request.current) return;
      if (offset && offset >= result.total) { setOffset(Math.max(0, Math.floor((result.total - 1) / 100) * 100)); return; }
      setData(result); setError(null);
      setSelected(previous => new Set([...previous].filter(id => result.items.some(t => t.id === id && (archived || !t.blocked)))));
    } catch (err) { if (current === request.current) { setError(message(err)); setData(null); } }
    finally { if (current === request.current) setLoading(false); }
  }, [rpc, archived, query, projectId, olderThanDays, offset]);
  useEffect(() => {
    setSelected(new Set()); setData(null); setLoading(true);
    const timer = setTimeout(() => void load(), 180);
    return () => { clearTimeout(timer); ++request.current; };
  }, [load]);
  useRealtime("inbox", () => void load());
  const eligible = data?.items.filter(t => archived || !t.blocked) ?? [];
  async function review(reason: "done" | "unneeded") {
    setBusy(true); setError(null);
    try { setPreview(await rpc.call("cleanerPreview", { threadIds: [...selected], reason })); }
    catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  async function restore() {
    setBusy(true); setError(null);
    try {
      const result = await rpc.call("cleanerRestore", { threadIds: [...selected] });
      if (result.restoredIds.length) toast.success(`${result.restoredIds.length} conversation${result.restoredIds.length === 1 ? "" : "s"} restored`);
      setSelected(new Set()); await load();
      if (result.errors.length) setError(result.errors.join("\n"));
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  return <section className="ny-cleaner" aria-label="Thread cleaner">
    <div className="ny-cleaner-heading">
      <div><h3>Thread cleaner</h3><p>Close out finished tasks and clear one-off conversations.</p></div>
      <div className="ny-view-nav" aria-label="Thread archive views">
        <button aria-pressed={!archived} onClick={() => { setArchived(false); setOffset(0); }}>Open threads</button>
        <button aria-pressed={archived} onClick={() => { setArchived(true); setOffset(0); }}>Archived</button>
      </div>
    </div>
    <div className="ny-cleaner-filters">
      <Input aria-label="Search threads" placeholder="Search threads…" value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} />
      <select aria-label="Filter by project" value={projectId ?? ""} onChange={event => { setProjectId(event.target.value || null); setOffset(0); }}>
        <option value="">All projects</option>{data?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select aria-label="Last activity" value={olderThanDays} onChange={event => { setOlderThanDays(Number(event.target.value)); setOffset(0); }}>
        <option value={0}>Any age</option><option value={7}>Inactive 7+ days</option><option value={30}>Inactive 30+ days</option><option value={90}>Inactive 90+ days</option>
      </select>
    </div>
    <p className="ny-summary">{archived ? "Restore conversations and children archived with them. Workspace files may no longer be available." : "Oldest activity first. Running, pinned, waiting, and queued threads are protected."}</p>
    <div className="ny-cleaner-actions">
      <label><input type="checkbox" aria-label="Select eligible threads on this page" disabled={busy || loading || !eligible.length} checked={eligible.length > 0 && eligible.every(t => selected.has(t.id))} onChange={event => setSelected(new Set(event.target.checked ? eligible.map(t => t.id) : []))} /> Select page</label>
      <span role="status">{selected.size} selected</span>
      {archived ? <Button size="sm" disabled={busy || loading || !selected.size} onClick={() => void restore()}>Restore selected</Button> : <>
        <Button size="sm" disabled={busy || loading || !selected.size} onClick={() => void review("done")}>Done & archive</Button>
        <Button size="sm" variant="outline" disabled={busy || loading || !selected.size} onClick={() => void review("unneeded")}>Archive unwanted</Button>
      </>}
    </div>
    {error && <div role="alert" className="ny-cleaner-error">{error} <Button size="sm" variant="ghost" onClick={() => void load()}>Refresh</Button></div>}
    {loading && <p role="status" className="ny-summary">Loading threads…</p>}
    {data && <>
      {!data.items.length && <div className="ny-empty"><h3>No threads match.</h3><p>Try another search or age filter.</p></div>}
      <ul className="ny-rows">
        {data.items.map(item => <li className="ny-row ny-cleaner-row" key={item.id}>
          <input type="checkbox" aria-label={`Select ${item.title}`} title={archived ? undefined : item.blocked ?? undefined} disabled={busy || loading || (!archived && !!item.blocked)} checked={selected.has(item.id)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} />
          <button className="ny-open" onClick={() => nav.toThread(item.id)} aria-label={`Open ${item.title}`}>
            <span className="ny-item-text"><strong className="ny-item-title">{item.title}</strong>
              <span className="ny-item-reason">{item.projectName} · {archived ? item.reason === "done" ? "Done" : item.reason === "unneeded" ? "No longer needed" : "Archived" : item.blocked ?? (item.status === "error" ? "Failed" : "Idle")}</span>
            </span>
          </button>
          <time className="ny-time" dateTime={new Date(item.updatedAt).toISOString()} title="Last activity">{new Date(item.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</time>
        </li>)}
      </ul>
      <div className="ny-cleaner-pagination"><span>{data.total ? offset + 1 : 0}–{offset + data.items.length} of {data.total} threads</span>
        <Button size="sm" variant="ghost" disabled={busy || loading || offset === 0} onClick={() => setOffset(offset - 100)}>Previous</Button>
        <Button size="sm" variant="ghost" disabled={busy || loading || offset + 100 >= data.total} onClick={() => setOffset(offset + 100)}>Next</Button>
      </div>
    </>}
    <ArchiveReview preview={preview} close={() => setPreview(null)} complete={() => { setSelected(new Set()); void load(); }} />
  </section>;
}
