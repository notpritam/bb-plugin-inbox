// Telegram error bodies and request URLs can contain bot tokens. Never return them.
export class TelegramError extends Error {}
export async function telegramRequest(token: string, method: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 404) throw new TelegramError("Telegram rejected this bot token. Copy a current token from BotFather and try again.");
      if (response.status === 409) throw new TelegramError("Another app is reading this bot’s messages. Use a dedicated bot for Needs You.");
      if (response.status === 403) throw new TelegramError("The bot cannot message this chat. Unblock it and press Start in Telegram, then try again.");
      if (response.status === 429) throw new TelegramError("Telegram is limiting requests. Wait a moment, then try again.");
      throw new TelegramError("Telegram could not complete the request. Try again shortly.");
    }
    const payload = await response.json() as { ok?: unknown; result?: unknown };
    if (payload?.ok !== true) throw new TelegramError("Telegram could not complete the request. Check the bot and try again.");
    return payload.result;
  } catch (error) {
    if (error instanceof TelegramError) throw error;
    throw new TelegramError("Couldn’t reach Telegram. Check the BB host’s connection and try again.");
  }
}
