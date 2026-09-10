import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import type { Preferences, SetupStatus } from "./setup";
import type { Pairing } from "./telegram-setup";
import type { UpdateStatus } from "./updates";

export function useSetup() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<SetupStatus | null>(null);
  const [error, setError] = useState("");
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [updateError, setUpdateError] = useState("");
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);
  const load = useCallback(async () => {
    try { const next = await rpc.call("setupStatus", null); if (mounted.current) { setState(next); setError(""); } }
    catch { if (mounted.current) setError("Couldn’t load setup. Your inbox is still available."); }
  }, [rpc]);
  const check = useCallback(async (force = false) => {
    setChecking(true);
    try { const next = await rpc.call("setupCheckUpdates", { force }); if (mounted.current) { setUpdate(next); setUpdateError(""); } }
    catch { if (mounted.current) { setUpdate(null); setUpdateError("Couldn’t check for updates. Try again."); } }
    finally { if (mounted.current) setChecking(false); }
  }, [rpc]);
  useEffect(() => { mounted.current = true; void load(); void check(); return () => { mounted.current = false; }; }, [load, check]);
  return { state, setState, error, load, rpc, update, updateError, checking, check };
}
type Model = ReturnType<typeof useSetup>;

export function WelcomeSetup({ model, openSettings }: { model: Model; openSettings: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!model.state || model.state.completed) return null;
  async function skip() {
    setBusy(true); setError("");
    try { await model.rpc.call("setupFinish", null); await model.load(); }
    catch { setError("Couldn’t save your choice. Try again."); }
    finally { setBusy(false); }
  }
  return <section className="ny-welcome" aria-labelledby="ny-welcome-title">
    <div><h3 id="ny-welcome-title">Welcome to Needs You</h3>
      <p>Your inbox is ready. Get questions and failed runs here, and optionally connect Telegram for alerts on your phone.</p>
      <p>Finished work stays until you dismiss it. Turn on completion alerts or change other notifications in Settings.</p></div>
    <div className="ny-settings-actions"><button className="ny-primary" onClick={openSettings}>Set up Telegram</button>
      <button className="ny-secondary" onClick={() => void skip()} disabled={busy}>{busy ? "Saving…" : "Use inbox"}</button></div>
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function SettingsView({ model, back }: { model: Model; back: () => void }) {
  const state = model.state!;
  const [preferences, setPreferences] = useState<Preferences>(state.preferences);
  const [dirty, setDirty] = useState(false);
  const [token, setToken] = useState("");
  const [pairing, setPairing] = useState<Pairing | null>(state.pairing);
  const [replacing, setReplacing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reloadReady, setReloadReady] = useState(false);
  const previewId = useRef<string | number | null>(null);
  useEffect(() => { if (!dirty) setPreferences(state.preferences); }, [state.preferences, dirty]);
  useEffect(() => () => { if (previewId.current !== null) toast.dismiss(previewId.current); }, []);
  async function run(name: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(name); setError(""); setMessage("");
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : "Something went wrong. Try again."); }
    finally { setBusy(""); }
  }
  function change<K extends keyof Preferences>(key: K, value: Preferences[K]) { setDirty(true); setPreferences(v => ({ ...v, [key]: value })); }
  function preview() {
    previewId.current = toast.message("Needs You · sample notification", {
      description: "An agent needs your input. This preview does not open a thread or send anything to Telegram.",
      duration: 5000, closeButton: true,
    });
  }
  const labels: Array<[keyof Pick<Preferences, "notifyBlocked" | "notifyFailed" | "notifyFinished" | "notifyExtensions" | "toastEnabled" | "desktopEnabled" | "telegramInstant">, string, string]> = [
    ["notifyBlocked", "Questions and approvals", "When an agent needs your input."],
    ["notifyFailed", "Failed runs", "When a thread stops with an error."],
    ["notifyFinished", "Completed turns", "When an agent finishes. Off by default to keep things quiet."],
    ["notifyExtensions", "Extension activity", "Notify when Guided Review and other extensions finish work. Items stay until dismissed."],
    ["toastEnabled", "In-app popups", "One dismissible popup per thread or review, quiet while you’re viewing it. Desktop sidebar required."],
    ["desktopEnabled", "Native desktop notifications", state.desktopAvailable ? "Notifications on the Mac running BB." : "Requires a Mac running the BB server; unavailable on this host."],
    ["telegramInstant", "Telegram alerts", "Send selected alerts to your connected private chat."],
  ];
  return <div className="ny-settings">
    <div className="ny-settings-top"><h3>Settings</h3><button className="ny-secondary" onClick={back}>Back to inbox</button></div>
    {error && <div className="ny-settings-feedback" role="alert">{error}</div>}
    {message && <p className="ny-settings-feedback" role="status">{message}</p>}
    <div className="ny-settings-columns">
      <section aria-labelledby="ny-notifications-title">
        <h4 id="ny-notifications-title">Notifications</h4>
        <form onSubmit={event => { event.preventDefault(); void run("save", async () => {
          if (Boolean(preferences.quietStart) !== Boolean(preferences.quietEnd)) throw new Error("Set both quiet-hours times, or clear both.");
          model.setState(await model.rpc.call("setupSave", preferences)); setDirty(false); setMessage("Notification settings saved.");
        }); }}>
          <fieldset disabled={Boolean(busy)} className="ny-settings-fields">
            {labels.map(([key, label, description]) => <label className="ny-setting-toggle" key={key}>
              <input type="checkbox" checked={preferences[key]} disabled={key === "desktopEnabled" && !state.desktopAvailable} onChange={e => change(key, e.target.checked)} />
              <span><strong>{label}</strong><small>{description}</small></span>
            </label>)}
            <div className="ny-settings-times">
              <label>Quiet hours start<input type="time" value={preferences.quietStart} onChange={e => change("quietStart", e.target.value)} /></label>
              <label>Quiet hours end<input type="time" value={preferences.quietEnd} onChange={e => change("quietEnd", e.target.value)} /></label>
            </div>
            <p>Uses {state.timezone}, the BB host’s timezone. Clear both times to turn quiet hours off.</p>
            <label className="ny-settings-field">Seconds between completion alerts<input type="number" min="0" max="86400" value={preferences.cooldownSeconds} onChange={e => change("cooldownSeconds", Number(e.target.value))} /></label>
            <div className="ny-settings-actions"><button className="ny-primary" type="submit">{busy === "save" ? "Saving…" : "Save notification settings"}</button>
              <button className="ny-secondary" type="button" onClick={preview}>Preview popup</button></div>
          </fieldset>
        </form>
      </section>
      <section aria-labelledby="ny-telegram-title">
        <h4 id="ny-telegram-title">Telegram</h4>
        <p>Use your own bot for phone alerts. Notifications share titles and request context with Telegram. Reply to questions and approve requests inside BB.</p>
        {state.telegram.configured && <div className="ny-connection">
          <strong>{state.telegram.botUsername ? `@${state.telegram.botUsername}` : "Telegram configured"}</strong>
          <p>{state.telegram.name ?? "Private chat"} · {state.telegram.chatId}</p>
          <p>{state.telegram.lastTest ? state.telegram.lastTest.ok ? "Telegram accepted your last test. Check that it reached your phone." : "Your last test failed. Try again or reconnect." : "Send a test to check this connection."}</p>
          <div className="ny-settings-actions"><button className="ny-primary" disabled={Boolean(busy)} onClick={() => void run("test", async () => {
            await model.rpc.call("setupTelegramTest", null); setMessage("Telegram accepted the test. Check your phone to confirm it arrived."); await model.load();
          })}>{busy === "test" ? "Sending…" : "Send test notification"}</button>
            <button className="ny-secondary" disabled={Boolean(busy)} onClick={() => { setReplacing(true); setDisconnecting(false); }}>Change bot</button>
            <button className="ny-secondary" disabled={Boolean(busy)} onClick={() => setDisconnecting(true)}>Disconnect</button></div>
          {disconnecting && <div className="ny-disconnect"><p>Remove this bot token and chat from BB? Your inbox will keep working.</p>
            <button className="ny-secondary" disabled={Boolean(busy)} onClick={() => void run("disconnect", async () => {
              model.setState(await model.rpc.call("setupTelegramDisconnect", null)); setPairing(null); setReplacing(false); setDisconnecting(false); setToken(""); setMessage("Telegram disconnected.");
            })}>Disconnect Telegram</button> <button className="ny-secondary" onClick={() => setDisconnecting(false)}>Keep connected</button></div>}
        </div>}
        {pairing ? <div className="ny-pairing">
          <strong>Connect @{pairing.botUsername}</strong>
          {pairing.candidate ? <>
            <p>Confirm that this is your private Telegram chat:</p>
            <p><strong>{pairing.candidate.name}</strong>{pairing.candidate.username && <span className="ny-pairing-user">@{pairing.candidate.username}</span>} · {pairing.candidate.chatId}</p>
            <button className="ny-primary" disabled={Boolean(busy)} onClick={() => void run("confirm", async () => {
              model.setState(await model.rpc.call("setupTelegramConfirm", { pairingId: pairing.id })); setPairing(null); setReplacing(false); setMessage("Chat connected. Send a test notification to check delivery.");
            })}>Confirm this chat</button>
          </> : <>
            <p>Open the bot and press Start, then return here. This link expires in 10 minutes.</p>
            <div className="ny-settings-actions"><a className="ny-primary" href={pairing.url} target="_blank" rel="noreferrer">Open bot in Telegram</a>
              <button className="ny-secondary" disabled={Boolean(busy)} onClick={() => void run("pair", async () => {
                const next = await model.rpc.call("setupTelegramCheck", { pairingId: pairing.id }); setPairing(next);
                if (!next.candidate) setMessage("No matching private chat yet. Press Start using the link above, then check again.");
              })}>{busy === "pair" ? "Checking…" : "I pressed Start"}</button></div>
          </>}
          <button className="ny-secondary ny-cancel-pairing" disabled={Boolean(busy)} onClick={() => void run("cancel", async () => {
            try { await model.rpc.call("setupTelegramCancel", { pairingId: pairing.id }); } finally { setPairing(null); setToken(""); }
          })}>Cancel pairing</button>
        </div> : (!state.telegram.configured || replacing) && <form className="ny-token-form" onSubmit={event => { event.preventDefault(); void run("connect", async () => {
          const value = token; setToken("");
          setPairing(await model.rpc.call("setupTelegramBegin", { token: value }));
        }); }}>
          <ol><li>Open <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">BotFather</a> and send <code>/newbot</code>.</li>
            <li>Name your bot and copy the token BotFather gives you.</li></ol>
          <label className="ny-settings-field">Telegram bot token<input type="password" autoComplete="off" spellCheck={false} value={token} onChange={e => setToken(e.target.value)} required disabled={Boolean(busy)} /></label>
          <p>The token stays in this BB installation. Use a dedicated bot that no other app is reading.</p>
          <button className="ny-primary" type="submit" disabled={Boolean(busy) || !token.trim()}>{busy === "connect" ? "Checking bot…" : "Connect bot"}</button>
        </form>}
        <p className="ny-telegram-help">Enable BB Connect for thread links that open from your phone. Setup never enables Telegram replies or sends a test automatically.</p>
        {!state.completed && <button className="ny-secondary" disabled={Boolean(busy)} onClick={() => void run("finish", async () => { await model.rpc.call("setupFinish", null); await model.load(); back(); })}>Finish setup</button>}
      </section>
    </div>
    <section className="ny-updates" aria-labelledby="ny-updates-title">
      <div><h4 id="ny-updates-title">Version & updates</h4><p>Update now installs the latest compatible release available when BB resolves the update.</p><p>Installed: {state.version}</p>
        <p>{model.updateError || (model.checking ? "Checking for updates…" : model.update?.detail ?? "Check for compatible releases from your installation’s source.")}</p>
        {model.update?.latestVersion && <p>Available: {model.update.latestVersion}</p>}</div>
      <div className="ny-settings-actions">
        <button className="ny-secondary" disabled={Boolean(busy) || model.checking} onClick={() => void model.check(true)}>Check for updates</button>
        {model.update?.outcome === "update-available" && model.update.candidateVersion && <button className="ny-primary" disabled={Boolean(busy) || Boolean(pairing) || model.checking} onClick={() => void run("update", async () => {
          const result = await model.rpc.call("setupApplyUpdate", { candidateVersion: model.update!.candidateVersion! });
          if (result.outcome === "rolled-back") throw new Error("The update could not start. BB restored the previous version. Check for updates before trying again.");
          setMessage(result.outcome === "updated" ? "Update installed. Reload Needs You to use the new version." : "You’re already on the latest compatible release.");
          setReloadReady(result.outcome === "updated"); await model.check(true);
        })}>{busy === "update" ? "Updating…" : "Update now"}</button>}
        {reloadReady && <button className="ny-primary" onClick={() => window.location.reload()}>Reload Needs You</button>}
        <a href="https://github.com/notpritam/bb-plugin-inbox/releases" target="_blank" rel="noreferrer">Release notes</a>
      </div>
    </section>
  </div>;
}
