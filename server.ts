// bb-plugin-inbox — backend entry.
//
// A "Needs You" inbox: ranks threads that are blocked on you / failed / finished,
// and pushes instant notifications to desktop (native macOS) and mobile
// (Telegram) — quiet during long runs, loud only when you're actually needed.
//
// Detection/ranking borrows bb-plugin-attention; dedupe + deeplink borrow
// bb-plugin-ntfy. Both MIT, by Shane Logsdon.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createSetup, setupRpc } from "./setup";
import {
  buildSnapshot,
  DISMISS_PREFIX,
  type AttentionItem,
  type AttentionKind,
} from "./attention";
import {
  desktopAvailable,
  escapeHtml,
  resolveDeeplinkBaseUrl,
  sendDesktop,
  sendTelegram,
  telegramChats,
  threadUrl,
  type TelegramConfig,
} from "./notify";
import {
  trackerAdd,
  trackerComplete,
  trackerList,
} from "./tracker";

import { createActivities, activityItemSchema, activityRpc, type ActivityItem } from "./activity";

const NOTI_PREFIX = "noti:";
const LAST_FINISHED_KEY = "last-finished-noti";
interface NotiRecord {
  at: number;
  kind: AttentionKind;
}

const zItem = z.object({
  threadId: z.string(),
  projectId: z.string(),
  title: z.string(),
  kind: z.enum(["error", "blocked", "finished"]),
  label: z.string(),
  detail: z.string().optional(),
  attentionAt: z.number(),
  updatedAt: z.number(),
});

export const rpcContract = defineRpcContract({
  ...setupRpc,
  ...activityRpc,
  list: {
    input: z.object({
      projectId: z.string().nullable().default(null),
      includeFinished: z.boolean().default(true),
    }),
    output: z.object({
      items: z.array(z.union([zItem, activityItemSchema])),
      total: z.number().int(),
      generatedAt: z.number(),
    }),
  },
  status: {
    input: z.null(),
    output: z.object({
      desktop: z.boolean(),
      toast: z.boolean(),
      telegram: z.boolean(),
      notifyBlocked: z.boolean(),
      notifyFailed: z.boolean(),
      notifyFinished: z.boolean(),
    }),
  },
  dismiss: {
    input: z.object({ threadId: z.string(), attentionAt: z.number() }),
    output: z.object({ ok: z.boolean() }),
  },
  // Generic notification entrypoint for other plugins (e.g. lanes-governor).
  notify: {
    input: z.object({
      title: z.string(),
      body: z.string().default(""),
      channel: z.enum(["desktop", "telegram", "both"]).default("both"),
      url: z.string().nullable().default(null),
    }),
    output: z.object({ desktop: z.boolean(), telegram: z.boolean() }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    notifyBlocked: {
      type: "boolean",
      label: "Notify when an agent is blocked on you",
      default: true,
    },
    notifyFailed: {
      type: "boolean",
      label: "Notify when a thread fails",
      default: true,
    },
    notifyExtensions: {
      type: "boolean", label: "Notify when extensions finish work", default: true,
    },
    notifyFinished: {
      type: "boolean",
      label: "Notify when a turn finishes (noisier)",
      default: false,
    },
    desktopEnabled: {
      type: "boolean",
      label: "Desktop notifications (macOS)",
      default: true,
    },
    toastEnabled: {
      type: "boolean",
      label: "In-app toast (bottom-right popup inside bb)",
      default: true,
    },
    telegramInstant: {
      type: "boolean",
      label: "Instant Telegram push on new blocks/failures",
      default: true,
    },
    telegramBotToken: {
      type: "string",
      label: "Telegram bot token",
      secret: true,
      description:
        "Connect your own bot in Needs You → Settings → Telegram.",
    },
    telegramChatId: {
      type: "string",
      label: "Telegram chat id",
      default: "",
      description: "Connect your private chat in Needs You → Settings.",
    },
    cooldownSeconds: {
      type: "string",
      label: "Cooldown between finished-turn pings (seconds)",
      default: "45",
    },
    quietStart: {
      type: "string",
      label: "Quiet hours start (HH:MM, 24h)",
      default: "",
    },
    quietEnd: {
      type: "string",
      label: "Quiet hours end (HH:MM, 24h)",
      default: "",
    },
  });

  const setup = createSetup(bb, settings);
  const activities = createActivities(bb, notifyActivity);

  // ----- config helpers -------------------------------------------------

  function quietNow(cfg: { quietStart: string; quietEnd: string }): boolean {
    const start = parseHhmm(cfg.quietStart);
    const end = parseHhmm(cfg.quietEnd);
    if (start === null || end === null) return false;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    return start <= end
      ? minutes >= start && minutes < end
      : minutes >= start || minutes < end; // wraps past midnight
  }

  async function notifyActivity(item: ActivityItem, currentItem: () => boolean): Promise<void> {
    const cfg = await settings.get();
    if (!currentItem() || !cfg.notifyExtensions || (item.kind === "error" && !cfg.notifyFailed) || quietNow(cfg)) return;
    if (cfg.toastEnabled) bb.realtime.publish("inbox:toast", { ...item, at: Date.now() });
    if (cfg.desktopEnabled && desktopAvailable()) {
      await sendDesktop(`bb: ${truncate(item.title, 90)}`, truncate(item.detail, 200), item.label);
    }
    await setup.telegram.withConnection(async current => {
      if (!currentItem() || !current.notifyExtensions || !current.telegramInstant || (item.kind === "error" && !current.notifyFailed) || quietNow(current)) return;
      const base = await resolveDeeplinkBaseUrl(bb.server.loopbackBaseUrl);
      if (!currentItem()) return;
      const result = await sendTelegram({ botToken: current.telegramBotToken, chatId: current.telegramChatId },
        `<b>${escapeHtml(item.label)}</b>\n${escapeHtml(item.title)}\n${escapeHtml(item.detail)}`, `${base}${item.href}`);
      if (!result.ok) bb.log.warn("Extension Telegram delivery failed; the item remains in Needs You.");
    });
  }

  async function inboxSnapshot(options: Parameters<typeof buildSnapshot>[1] = {}) {
    const snapshot = await buildSnapshot(bb, options);
    const rank = { error: 0, blocked: 1, finished: 2 };
    const items = [...snapshot.items, ...activities.list(options?.projectId, options?.includeFinished)]
      .sort((a, b) => rank[a.kind] - rank[b.kind] || b.attentionAt - a.attentionAt);
    return { ...snapshot, items, total: items.length };
  }

  async function loadDismissed(): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    for (const key of await bb.storage.kv.list(DISMISS_PREFIX)) {
      const at = await bb.storage.kv.get<number>(key);
      if (typeof at === "number") map.set(key.slice(DISMISS_PREFIX.length), at);
    }
    return map;
  }

  // ----- notification dispatch -----------------------------------------

  async function deeplink(item: AttentionItem): Promise<string | undefined> {
    try {
      const base = await resolveDeeplinkBaseUrl(bb.server.loopbackBaseUrl);
      return threadUrl(base, item.projectId, item.threadId);
    } catch {
      return undefined;
    }
  }

  async function maybeNotify(
    item: AttentionItem,
    cfg: Awaited<ReturnType<typeof settings.get>>,
  ): Promise<void> {
    if (item.kind === "finished" && item.notificationEligible === false) return;
    const enabled =
      item.kind === "blocked"
        ? cfg.notifyBlocked
        : item.kind === "error"
          ? cfg.notifyFailed
          : cfg.notifyFinished;
    if (!enabled) return;
    if (quietNow(cfg)) return;

    const recKey = `${NOTI_PREFIX}${item.threadId}`;
    const rec = await bb.storage.kv.get<NotiRecord>(recKey);
    if (rec && rec.at === item.attentionAt && rec.kind === item.kind) return;

    if (item.kind === "finished") {
      const cooldownMs = (Number.isFinite(Number(cfg.cooldownSeconds)) ? Math.max(0, Number(cfg.cooldownSeconds)) : 45) * 1000;
      const last = (await bb.storage.kv.get<number>(LAST_FINISHED_KEY)) ?? 0;
      if (Date.now() - last < cooldownMs) return;
    }

    const title = truncate(item.title, 90);
    const body = item.detail
      ? `${item.label} — ${truncate(item.detail, 200)}`
      : item.label;

    // In-app toast: a bottom-right popup inside bb, delivered over realtime to
    // any open client. Fires here (past the enabled/quiet/dedupe/cooldown gates)
    // so it pops exactly once per new attention, like the desktop/Telegram pings.
    if (cfg.toastEnabled) {
      bb.realtime.publish("inbox:toast", {
        threadId: item.threadId,
        projectId: item.projectId,
        kind: item.kind,
        title,
        label: item.label,
        detail: item.detail ?? null,
        attentionAt: item.attentionAt,
        at: Date.now(),
      });
    }

    if (cfg.desktopEnabled && desktopAvailable()) {
      await sendDesktop(`bb: ${title}`, body, item.label);
    }

    await setup.telegram.withConnection(async current => {
      const enabled = item.kind === "blocked" ? current.notifyBlocked : item.kind === "error" ? current.notifyFailed : current.notifyFinished;
      if (!current.telegramInstant || !enabled || quietNow(current)) return;
      const tg = { botToken: current.telegramBotToken, chatId: current.telegramChatId };
      const url = await deeplink(item);
      const emoji =
        item.kind === "error" ? "🚨" : item.kind === "blocked" ? "🙋" : "🔔";
      const text = `${emoji} <b>${escapeHtml(title)}</b>\n${escapeHtml(body)}`;
      const res = await sendTelegram(tg, text, url);
      if (!res.ok) {
        bb.log.warn(`telegram send failed: ${res.detail}`);
      }
    });

    await bb.storage.kv.set(recKey, {
      at: item.attentionAt,
      kind: item.kind,
    } satisfies NotiRecord);
    if (item.kind === "finished") {
      await bb.storage.kv.set(LAST_FINISHED_KEY, Date.now());
    }
  }

  // ----- reconcile (debounced) -----------------------------------------

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pendingRun = false;
  let disposed = false;

  async function reconcile(): Promise<void> {
    const cfg = await settings.get();
    const dismissed = await loadDismissed();
    const snapshot = await buildSnapshot(bb, {
      dismissed,
      includeFinished: true,
    });
    bb.realtime.publish("inbox", {
      total: snapshot.total + activities.list().length,
      at: snapshot.generatedAt,
    });
    for (const item of snapshot.items) {
      await maybeNotify(item, cfg);
    }
  }

  async function runReconcile(): Promise<void> {
    running = true;
    try {
      await reconcile();
    } catch (error) {
      bb.log.error(
        `reconcile failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      running = false;
      if (pendingRun && !disposed) {
        pendingRun = false;
        scheduleReconcile();
      }
    }
  }

  function scheduleReconcile(): void {
    if (disposed) return;
    if (running) {
      pendingRun = true;
      return;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void runReconcile(), 800);
  }

  // ----- triggers -------------------------------------------------------

  bb.events.on("thread.idle", () => scheduleReconcile());
  bb.events.on("thread.failed", () => scheduleReconcile());
  bb.events.on("thread.active", () => scheduleReconcile());
  bb.events.on("thread.archived", () => scheduleReconcile());

  const RELEVANT_CHANGES = new Set([
    "interactions-changed",
    "status-changed",
    "read-state-changed",
    "thread-created",
    "thread-deleted",
    "archived-changed",
  ]);

  bb.background.service("watch", {
    async start(signal) {
      const unsubscribe = bb.sdk.subscribe({
        event: "thread:changed",
        callback: (event) => {
          if (event.changes.some((c) => RELEVANT_CHANGES.has(c))) {
            scheduleReconcile();
          }
        },
      });
      scheduleReconcile(); // startup sweep
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          unsubscribe();
          resolve();
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            unsubscribe();
            resolve();
          },
          { once: true },
        );
      });
    },
  });

  // Telegram is notification-only. Remote actions are not registered.

  // ----- RPC ------------------------------------------------------------

  bb.rpc.register(rpcContract, {
    ...setup.handlers,
    ...activities.handlers,
    async list({ projectId, includeFinished }) {
      const dismissed = await loadDismissed();
      const snapshot = await inboxSnapshot({
        projectId,
        dismissed,
        includeFinished,
      });
      return snapshot;
    },
    async status() {
      const cfg = await settings.get();
      return {
        desktop: cfg.desktopEnabled && desktopAvailable(),
        toast: cfg.toastEnabled,
        telegram: (await setup.telegram.status()).configured,
        notifyBlocked: cfg.notifyBlocked,
        notifyFailed: cfg.notifyFailed,
        notifyFinished: cfg.notifyFinished,
      };
    },
    async dismiss({ threadId, attentionAt }) {
      await bb.storage.kv.set(`${DISMISS_PREFIX}${threadId}`, attentionAt);
      bb.realtime.publish("inbox", { total: -1, at: Date.now() });
      return { ok: true };
    },
    async notify({ title, body, channel, url }) {
      const cfg = await settings.get();
      let desktop = false;
      let telegram = false;
      if (!cfg.notifyExtensions || quietNow(cfg)) return { desktop, telegram };
      if (
        (channel === "desktop" || channel === "both") &&
        cfg.desktopEnabled &&
        desktopAvailable()
      ) {
        await sendDesktop(`bb: ${truncate(title, 90)}`, truncate(body, 200), title);
        desktop = true;
      }
      if (channel === "telegram" || channel === "both") await setup.telegram.withConnection(async current => {
        if (!current.notifyExtensions || !current.telegramInstant || quietNow(current)) return;
        const tg = { botToken: current.telegramBotToken, chatId: current.telegramChatId };
        const text = `🔔 <b>${escapeHtml(truncate(title, 90))}</b>${
          body ? `\n${escapeHtml(truncate(body, 300))}` : ""
        }`;
        const res = await sendTelegram(tg, text, url ?? undefined);
        if (!res.ok) bb.log.warn(`notify telegram failed: ${res.detail}`);
        else telegram = true;
      });
      return { desktop, telegram };
    },
  });

  // ----- CLI (`bb inbox …`) --------------------------------------------

  bb.cli.register({
    name: "inbox",
    summary: "Threads that need you, with desktop + Telegram notifications",
    commands: [
      { name: "list", summary: "List threads needing you", usage: "bb inbox list [--all]" },
      { name: "dismiss", summary: "Dismiss an item until its next update", usage: "bb inbox dismiss <n>" },
      { name: "status", summary: "Show notification config", usage: "bb inbox status" },
      { name: "test", summary: "Send a test notification", usage: "bb inbox test [--desktop|--telegram|--toast]" },
      { name: "chats", summary: "Discover your Telegram chat id", usage: "bb inbox chats" },
      { name: "task", summary: "Add a daily task (via the tracker plugin)", usage: "bb inbox task <what to do>" },
      { name: "tasks", summary: "List today's tasks", usage: "bb inbox tasks" },
      { name: "done", summary: "Complete a task by its number", usage: "bb inbox done <n>" },
    ],
    async run(argv) {
      const [sub, ...rest] = argv;
      const cfg = await settings.get();
      const has = (flag: string) => rest.includes(flag);

      try {
        switch (sub) {
          case undefined:
          case "list": {
            const dismissed = await loadDismissed();
            const snap = await inboxSnapshot({
              dismissed,
              includeFinished: has("--all"),
            });
            if (snap.items.length === 0) {
              return { exitCode: 0, stdout: "Nothing needs you right now." };
            }
            const lines = snap.items.map((item, i) => {
              const badge = item.kind.toUpperCase().padEnd(8);
              const when = new Date(item.attentionAt).toLocaleTimeString();
              return `${i + 1}. [${badge}] ${item.title}${item.detail ? ` — ${item.detail}` : ""}  (${when})`;
            });
            lines.push(
              `\n${snap.total} thread${snap.total === 1 ? "" : "s"} need you${snap.total > snap.items.length ? `; showing ${snap.items.length}` : ""}.`,
            );
            return { exitCode: 0, stdout: lines.join("\n") };
          }

          case "dismiss": {
            const n = Number(rest[0]);
            const dismissed = await loadDismissed();
            const snap = await inboxSnapshot({
              dismissed,
              includeFinished: true,
            });
            const item = Number.isInteger(n) ? snap.items[n - 1] : undefined;
            if (!item) {
              return { exitCode: 1, stderr: `No item ${rest[0] ?? ""}. Run \`bb inbox list\`.` };
            }
            if ("id" in item) activities.handlers.dismissActivity({ id: item.id, attentionAt: item.attentionAt });
            else await bb.storage.kv.set(`${DISMISS_PREFIX}${item.threadId}`, item.attentionAt);
            bb.realtime.publish("inbox", { total: -1, at: Date.now() });
            return { exitCode: 0, stdout: `Dismissed: ${item.title}` };
          }

          case "status": {
            const tg = (await setup.telegram.status()).configured;
            const lines = [
              `desktop:        ${cfg.desktopEnabled && desktopAvailable() ? "on" : "off"}`,
              `in-app toast:   ${cfg.toastEnabled ? "on" : "off"}`,
              `telegram:       ${tg ? "configured" : "(not set)"}`,
              `  instant push: ${cfg.telegramInstant}`,
              `notify blocked: ${cfg.notifyBlocked}`,
              `notify failed:  ${cfg.notifyFailed}`,
              `notify finished:${cfg.notifyFinished}`,
              `quiet hours:    ${cfg.quietStart && cfg.quietEnd ? `${cfg.quietStart}–${cfg.quietEnd}` : "(off)"}`,
            ];
            return { exitCode: 0, stdout: lines.join("\n") };
          }

          case "test": {
            // With no flag, exercise every channel; a channel flag narrows it.
            const wantDesktop = !has("--telegram") && !has("--toast");
            const wantTelegram = !has("--desktop") && !has("--toast");
            const wantToast = !has("--desktop") && !has("--telegram");
            const out: string[] = [];
            if (wantToast) {
              bb.realtime.publish("inbox:toast", {
                threadId: "test",
                projectId: "test",
                kind: "blocked",
                title: "Test — a thread needs you",
                label: "Question for you",
                detail: "Sample toast from `bb inbox test`.",
                attentionAt: Date.now(),
                at: Date.now(),
              });
              out.push(
                "toast:    published (pops in any open bb window; bottom-right)",
              );
            }
            if (wantDesktop) {
              const r = await sendDesktop(
                "bb inbox",
                "Test notification from the inbox plugin.",
                "Test",
              );
              out.push(`desktop:  ${r.ok ? "sent" : `failed — ${r.detail}`}`);
            }
            if (wantTelegram) {
              try { await setup.telegram.test(); out.push("telegram: test accepted; check your phone"); }
              catch (error) { out.push(`telegram: ${error instanceof Error ? error.message : "Test failed"}`); }
            }
            return { exitCode: 0, stdout: out.join("\n") };
          }

          case "chats": {
            if (setup.telegram.isPairing()) return { exitCode: 1, stderr: "Telegram setup is pairing in Needs You. Finish or cancel it there before reading chats." };
            if (!cfg.telegramBotToken) {
              return { exitCode: 1, stderr: "Open Needs You → Settings → Telegram to connect your own bot and private chat." };
            }
            const r = await telegramChats(cfg.telegramBotToken);
            if (!r.ok) return { exitCode: 1, stderr: `getUpdates failed — ${r.detail}` };
            if (r.chats.length === 0) {
              return { exitCode: 0, stdout: "No recent chats. Send a message to your bot in Telegram, then re-run `bb inbox chats`." };
            }
            const lines = r.chats.map(
              (c) => `${c.chatId}  ${c.name}${c.lastText ? `  — "${truncate(c.lastText, 40)}"` : ""}`,
            );
            lines.push(
              "\nSet it with: bb plugin config inbox set telegramChatId <id>",
            );
            return { exitCode: 0, stdout: lines.join("\n") };
          }

          case "task":
          case "add": {
            const title = rest.join(" ").trim();
            if (!title) {
              return { exitCode: 1, stderr: "Usage: bb inbox task <what to do>" };
            }
            const task = await trackerAdd(bb, title);
            return { exitCode: 0, stdout: `Added #${task.seq} ${task.title}` };
          }

          case "tasks": {
            const { tasks } = await trackerList(bb, "today");
            if (tasks.length === 0) {
              return { exitCode: 0, stdout: "No tasks for today." };
            }
            const lines = tasks.map(
              (t) => `${t.status === "done" ? "[x]" : "[ ]"} #${t.seq} ${t.title}`,
            );
            return { exitCode: 0, stdout: lines.join("\n") };
          }

          case "done": {
            const seq = Number(rest[0]);
            if (!Number.isInteger(seq)) {
              return { exitCode: 1, stderr: "Usage: bb inbox done <task number>" };
            }
            const task = await trackerComplete(bb, seq);
            return task
              ? { exitCode: 0, stdout: `Done: ${task.title}` }
              : { exitCode: 1, stderr: `No open task #${seq}.` };
          }

          case "help":
            return { exitCode: 0, stdout: HELP };

          default:
            return { exitCode: 1, stderr: `Unknown command "${sub}".\n\n${HELP}` };
        }
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  bb.onDispose(() => {
    disposed = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    bb.log.info("inbox disposed");
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parseHhmm(value: string): number | null {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

const HELP = `bb inbox — threads that need you

  bb inbox list [--all]     list threads needing you (--all includes finished)
  bb inbox dismiss <n>      hide an item until its next update
  bb inbox status           show notification configuration
  bb inbox test [--desktop|--telegram|--toast]  send a test notification
  bb inbox chats            list Telegram chat ids (after messaging your bot)

Setup Telegram (optional):
  Open Needs You → Settings → Telegram.
  Connect your own bot, press Start in Telegram, confirm your private chat,
  then choose Send test notification. The inbox works without Telegram.`;
