import { createHash, randomBytes } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { telegramRequest, TelegramError } from "./telegram-api";
import type { StoredSettings } from "./setup";

const candidateSchema = z.object({ chatId: z.string(), name: z.string(), username: z.string().nullable() });
export const pairingSchema = z.object({
  id: z.string(), botUsername: z.string(), url: z.string(), expiresAt: z.number(), candidate: candidateSchema.nullable(),
});
export type Pairing = z.infer<typeof pairingSchema>;
export const telegramStatusSchema = z.object({
  configured: z.boolean(), chatId: z.string().nullable(), botUsername: z.string().nullable(),
  name: z.string().nullable(), lastTest: z.object({ ok: z.boolean(), at: z.number() }).nullable(),
});
interface Pending extends Pairing { token: string; challenge: string; createdAt: number; offset: number; }
interface Metadata { fingerprint: string; botUsername?: string; name?: string; lastTest?: { ok: boolean; at: number }; }
const META_KEY = "setup:telegram";
const SUSPENDED_KEY = "setup:telegram-suspended";
const fingerprint = (token: string, chatId: string) => createHash("sha256").update(token).update("\0").update(chatId).digest("hex");

export function createTelegramSetup(bb: BbPluginApi, settings: { get(): Promise<StoredSettings> }) {
  let pending: Pending | null = null;
  let expiry: ReturnType<typeof setTimeout> | null = null;
  let queue = Promise.resolve();
  let writing = false;
  let operations = 0;
  let updating = false;
  const controller = new AbortController();
  function clear() { pending = null; if (expiry) clearTimeout(expiry); expiry = null; }
  bb.onDispose(() => { controller.abort(); clear(); });
  function serial<T>(run: () => Promise<T>): Promise<T> {
    if (updating) return Promise.reject(new Error("An update is running. Reopen Settings after it finishes."));
    operations++;
    const next = queue.then(() => { if (controller.signal.aborted) throw new Error("Needs You restarted. Open setup again."); return run(); });
    queue = next.then(() => {}, () => {});
    return next.finally(() => { operations--; });
  }
  function requirePairing(id: string): Pending {
    if (!pending || pending.id !== id || pending.expiresAt <= Date.now()) {
      if (pending?.expiresAt && pending.expiresAt <= Date.now()) clear();
      throw new Error("This setup link expired or was replaced. Start again.");
    }
    return pending;
  }
  function publicPairing(p: Pending): Pairing {
    return { id: p.id, botUsername: p.botUsername, url: p.url, expiresAt: p.expiresAt, candidate: p.candidate };
  }
  async function save(values: Record<string, string | boolean | null>) {
    writing = true;
    try {
      // Host secret-file and database writes are not atomic. Persist a delivery
      // barrier first so crashes or partial writes cannot mix a token and chat.
      await bb.storage.kv.set(SUSPENDED_KEY, true);
      await bb.sdk.plugins.updateSettings({ pluginId: bb.pluginId, values });
      await bb.storage.kv.delete(SUSPENDED_KEY);
    }
    catch { throw new Error("Couldn’t save the Telegram connection. Alerts are paused; reconnect from Settings to recover."); }
    finally { writing = false; }
  }
  async function status() {
    const cfg = await settings.get();
    const configured = !writing && !(await bb.storage.kv.get<boolean>(SUSPENDED_KEY)) && Boolean(cfg.telegramBotToken && cfg.telegramChatId);
    const stored = await bb.storage.kv.get<Metadata>(META_KEY);
    const metadata = configured && stored?.fingerprint === fingerprint(cfg.telegramBotToken!, cfg.telegramChatId) ? stored : null;
    return { configured, chatId: configured ? cfg.telegramChatId : null,
      botUsername: metadata?.botUsername ?? null, name: metadata?.name ?? null, lastTest: metadata?.lastTest ?? null };
  }
  return {
    status,
    pairing: () => pending && pending.expiresAt > Date.now() ? publicPairing(pending) : null,
    isPairing: () => operations > 0 || Boolean(pending && pending.expiresAt > Date.now()),
    async withUpdate<T>(run: () => Promise<T>): Promise<T> {
      if (updating) throw new Error("An update is already running.");
      if (operations || (pending && pending.expiresAt > Date.now())) throw new Error("Finish or cancel Telegram pairing before updating.");
      updating = true;
      try { return await run(); } finally { updating = false; }
    },
    withConnection: <T>(run: (cfg: StoredSettings & { telegramBotToken: string }) => Promise<T>): Promise<T | null> => serial(async () => {
      const cfg = await settings.get();
      if (!cfg.telegramBotToken || !cfg.telegramChatId || await bb.storage.kv.get<boolean>(SUSPENDED_KEY)) return null;
      // This gate spans reads, link resolution and delivery. A disconnect waits
      // for an already-started send and prevents every later queued send.
      return run({ ...cfg, telegramBotToken: cfg.telegramBotToken });
    }),
    isWriting: () => writing,
    begin: (token: string) => serial(async () => {
      token = token.trim();
      if (!/^\d{5,15}:[A-Za-z0-9_-]{25,100}$/.test(token)) throw new Error("Paste the complete bot token from BotFather.");
      const bot = z.object({ is_bot: z.literal(true), username: z.string().regex(/^[A-Za-z0-9_]{5,32}$/) })
        .safeParse(await telegramRequest(token, "getMe", {}, controller.signal));
      if (!bot.success) throw new Error("Telegram did not return a valid bot. Check the token and try again.");
      const webhook = z.object({ url: z.string() }).safeParse(await telegramRequest(token, "getWebhookInfo", {}, controller.signal));
      if (!webhook.success || webhook.data.url) throw new Error("This bot is connected to another app. Use a dedicated bot for Needs You.");
      if (controller.signal.aborted) throw new Error("Needs You restarted. Open setup again.");
      clear();
      const id = randomBytes(16).toString("hex"), challenge = "ny_" + randomBytes(24).toString("hex");
      pending = { id, token, challenge, botUsername: bot.data.username,
        url: `https://t.me/${bot.data.username}?start=${challenge}`, expiresAt: Date.now() + 10 * 60_000,
        createdAt: Math.floor(Date.now() / 1000), offset: 0, candidate: null };
      expiry = setTimeout(() => { if (pending?.id === id) clear(); }, 10 * 60_000); expiry.unref();
      return publicPairing(pending);
    }),
    check: (id: string) => serial(async () => {
      const p = requirePairing(id);
      if (p.candidate) return publicPairing(p);
      const raw = await telegramRequest(p.token, "getUpdates", { offset: p.offset, timeout: 0, limit: 100, allowed_updates: ["message"] }, controller.signal);
      if (!Array.isArray(raw)) throw new Error("Telegram returned an unexpected reply. Try checking again.");
      requirePairing(id);
      for (const update of raw) {
        if (!Number.isSafeInteger(update?.update_id) || update.update_id < p.offset) continue;
        p.offset = Math.max(p.offset, update.update_id + 1);
        const msg = update.message;
        if (msg?.text !== `/start ${p.challenge}` || msg?.chat?.type !== "private" || msg?.from?.is_bot !== false ||
          !Number.isSafeInteger(msg.chat.id) || msg.chat.id <= 0 || msg.from.id !== msg.chat.id ||
          !Number.isFinite(msg.date) || msg.date < p.createdAt || msg.forward_origin || msg.forward_date) continue;
        p.candidate = { chatId: String(msg.chat.id), name: [msg.from.first_name, msg.from.last_name].filter(v => typeof v === "string").join(" ").slice(0, 100) || "Your private chat",
          username: typeof msg.from.username === "string" ? msg.from.username.slice(0, 40) : null };
        break;
      }
      return publicPairing(p);
    }),
    confirm: (id: string) => serial(async () => {
      const p = requirePairing(id);
      if (!p.candidate) throw new Error("Open the bot and press Start before confirming your chat.");
      await save({ telegramBotToken: p.token, telegramChatId: p.candidate.chatId });
      await bb.storage.kv.set(META_KEY, { fingerprint: fingerprint(p.token, p.candidate.chatId), botUsername: p.botUsername, name: p.candidate.name } satisfies Metadata);
      clear();
    }),
    cancel: (id: string) => serial(async () => { requirePairing(id); clear(); return { ok: true }; }),
    test: () => serial(async () => {
      const cfg = await settings.get();
      if (!cfg.telegramBotToken || !cfg.telegramChatId || await bb.storage.kv.get<boolean>(SUSPENDED_KEY)) throw new Error("Connect Telegram before sending a test.");
      const key = fingerprint(cfg.telegramBotToken, cfg.telegramChatId);
      const stored = await bb.storage.kv.get<Metadata>(META_KEY);
      const metadata: Metadata = stored?.fingerprint === key ? stored : { fingerprint: key };
      try {
        const raw = await telegramRequest(cfg.telegramBotToken, "sendMessage", {
          chat_id: cfg.telegramChatId, text: "Needs You — test notification\nYour BB installation can send alerts to this chat. Return to Needs You to finish setup.",
        }, controller.signal);
        if (!raw || typeof raw !== "object" || !("message_id" in raw) || !Number.isSafeInteger(raw.message_id)) throw new TelegramError("Telegram did not acknowledge this test. Try again.");
        await bb.storage.kv.set(META_KEY, { ...metadata, lastTest: { ok: true, at: Date.now() } });
        return { ok: true };
      } catch (error) {
        await bb.storage.kv.set(META_KEY, { ...metadata, lastTest: { ok: false, at: Date.now() } });
        throw error;
      }
    }),
    disconnect: () => serial(async () => {
      clear();
      await save({ telegramBotToken: null, telegramChatId: "" });
      await bb.storage.kv.delete(META_KEY);
    }),
  };
}
