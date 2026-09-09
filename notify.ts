// Notification channels: native desktop (macOS) + Telegram (mobile), plus the
// bb-connect deeplink resolver borrowed from bb-plugin-ntfy so mobile links open
// the actual thread on the user's phone.
import { exec } from "node:child_process";
import { platform } from "node:process";
import { telegramRequest } from "./telegram-api";

/**
 * Prefer bb connect's remote origin when this server is paired, so a deeplink
 * opens on the phone. Falls back to the loopback URL (desktop-local).
 */
export async function resolveDeeplinkBaseUrl(
  loopbackBaseUrl: string,
): Promise<string> {
  try {
    const response = await fetch(
      `${loopbackBaseUrl}/api/v1/plugins/connect/rpc/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!response.ok) return loopbackBaseUrl;
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null) return loopbackBaseUrl;
    const rpc = payload as { ok?: unknown; result?: unknown };
    if (rpc.ok !== true) return loopbackBaseUrl;
    const result = rpc.result;
    if (typeof result !== "object" || result === null) return loopbackBaseUrl;
    const { paired, url } = result as { paired?: unknown; url?: unknown };
    if (paired === true && typeof url === "string" && url.length > 0) {
      return url.replace(/\/+$/, "");
    }
  } catch {
    // connect disabled/unavailable — keep local deeplinks.
  }
  return loopbackBaseUrl;
}

export function threadUrl(
  baseUrl: string,
  projectId: string,
  threadId: string,
): string {
  return `${baseUrl}/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(threadId)}`;
}

// ---------------------------------------------------------------------------
// Desktop (macOS native notification via osascript)
// ---------------------------------------------------------------------------

export function desktopAvailable(): boolean {
  return platform === "darwin";
}

/** Escape a string for embedding inside an AppleScript double-quoted literal. */
function osaEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function sendDesktop(
  title: string,
  message: string,
  subtitle?: string,
): Promise<{ ok: boolean; detail?: string }> {
  if (!desktopAvailable()) {
    return { ok: false, detail: `unsupported platform: ${platform}` };
  }
  const parts = [
    `display notification "${osaEscape(message)}"`,
    `with title "${osaEscape(title)}"`,
  ];
  if (subtitle) parts.push(`subtitle "${osaEscape(subtitle)}"`);
  const script = parts.join(" ");
  return new Promise((resolve) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (error) => {
      if (error) resolve({ ok: false, detail: error.message });
      else resolve({ ok: true });
    });
  });
}

// ---------------------------------------------------------------------------
// Telegram (mobile)
// ---------------------------------------------------------------------------

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export async function sendTelegram(
  cfg: TelegramConfig,
  text: string,
  linkUrl?: string,
): Promise<{ ok: boolean; messageId?: number; detail?: string }> {
  const body =
    linkUrl && linkUrl.startsWith("http")
      ? `${text}\n\n<a href="${escapeHtml(linkUrl)}">Open in bb</a>`
      : text;
  try {
    const payload = await telegramRequest(cfg.botToken, "sendMessage", {
      chat_id: cfg.chatId, text: body, parse_mode: "HTML", disable_web_page_preview: true,
    }) as { message_id?: number };
    if (!Number.isSafeInteger(payload?.message_id)) return { ok: false, detail: "Telegram did not acknowledge this notification." };
    return { ok: true, messageId: payload.message_id };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "Telegram delivery failed." };
  }
}

export interface TelegramUpdate {
  updateId: number;
  chatId: string;
  text: string;
  replyToMessageId?: number;
}

/**
 * Long-poll getUpdates from `offset`. Returns received updates and the next
 * offset to persist. `signal` aborts the poll on plugin dispose.
 */
export async function telegramGetUpdates(
  botToken: string,
  offset: number,
  timeoutSeconds: number,
  signal?: AbortSignal,
): Promise<{ ok: boolean; updates: TelegramUpdate[]; nextOffset: number; detail?: string }> {
  try {
    const result = await telegramRequest(botToken, "getUpdates", {
      offset, timeout: Math.min(timeoutSeconds, 5), allowed_updates: ["message"],
    }, signal) as Array<{ update_id: number; message?: {
      text?: string; chat?: { id: number | string }; reply_to_message?: { message_id?: number };
    } }>;
    if (!Array.isArray(result)) throw new Error("Telegram returned an unexpected reply. Try again.");
    const updates: TelegramUpdate[] = [];
    let nextOffset = offset;
    for (const raw of result) {
      nextOffset = Math.max(nextOffset, raw.update_id + 1);
      const msg = raw.message;
      if (!msg?.chat || typeof msg.text !== "string") continue;
      updates.push({
        updateId: raw.update_id,
        chatId: String(msg.chat.id),
        text: msg.text,
        ...(msg.reply_to_message?.message_id
          ? { replyToMessageId: msg.reply_to_message.message_id }
          : {}),
      });
    }
    return { ok: true, updates, nextOffset };
  } catch (error) {
    if (signal?.aborted) return { ok: true, updates: [], nextOffset: offset };
    return {
      ok: false,
      updates: [],
      nextOffset: offset,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface TelegramChat {
  chatId: string;
  name: string;
  lastText: string;
}

/** Read recent chats from getUpdates so the user can discover their chat id. */
export async function telegramChats(
  botToken: string,
): Promise<{ ok: boolean; chats: TelegramChat[]; detail?: string }> {
  try {
    const result = await telegramRequest(botToken, "getUpdates", { timeout: 0, limit: 100 }) as
      Array<{ message?: TelegramApiMessage; channel_post?: TelegramApiMessage }>;
    if (!Array.isArray(result)) throw new Error("Telegram returned an unexpected reply. Try again.");
    const byId = new Map<string, TelegramChat>();
    for (const update of result) {
      const msg = update.message ?? update.channel_post;
      const chat = msg?.chat;
      if (!chat) continue;
      const name =
        chat.title ??
        [chat.first_name, chat.last_name].filter(Boolean).join(" ") ??
        chat.username ??
        "(unknown)";
      byId.set(String(chat.id), {
        chatId: String(chat.id),
        name,
        lastText: msg?.text ?? "",
      });
    }
    return { ok: true, chats: [...byId.values()] };
  } catch (error) {
    return {
      ok: false,
      chats: [],
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

interface TelegramApiMessage {
  text?: string;
  chat?: {
    id: number | string;
    title?: string;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export { escapeHtml };
