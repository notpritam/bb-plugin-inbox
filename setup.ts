import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import packageInfo from "./package.json" with { type: "json" };
import { desktopAvailable } from "./notify";
import { createTelegramSetup, pairingSchema, telegramStatusSchema } from "./telegram-setup";
import { createUpdates, updateRpc } from "./updates";

const clockTime = z.string().regex(/^(?:|(?:[01]\d|2[0-3]):[0-5]\d)$/);
export const preferencesSchema = z.object({
  notifyBlocked: z.boolean(), notifyFailed: z.boolean(), notifyFinished: z.boolean(), notifyExtensions: z.boolean().default(true),
  toastEnabled: z.boolean(), desktopEnabled: z.boolean(), telegramInstant: z.boolean(),
  cooldownSeconds: z.number().int().min(0).max(86400),
  quietStart: clockTime, quietEnd: clockTime,
}).strict().refine(v => Boolean(v.quietStart) === Boolean(v.quietEnd), {
  message: "Set both quiet-hours times, or clear both.", path: ["quietEnd"],
});
export type Preferences = z.infer<typeof preferencesSchema>;
export type StoredSettings = Omit<Preferences, "cooldownSeconds"> & {
  cooldownSeconds: string; telegramBotToken?: string; telegramChatId: string;
};
export const setupStatusSchema = z.object({
  pairing: pairingSchema.nullable(),
  completed: z.boolean(), version: z.string(), preferences: preferencesSchema,
  desktopAvailable: z.boolean(), timezone: z.string(),
  telegram: telegramStatusSchema,
});
export type SetupStatus = z.infer<typeof setupStatusSchema>;
export const setupRpc = {
  ...updateRpc,
  setupTelegramBegin: { input: z.object({ token: z.string().min(1).max(256) }).strict(), output: pairingSchema },
  setupTelegramCheck: { input: z.object({ pairingId: z.string().max(64) }).strict(), output: pairingSchema },
  setupTelegramCancel: { input: z.object({ pairingId: z.string().max(64) }).strict(), output: z.object({ ok: z.boolean() }) },
  setupTelegramConfirm: { input: z.object({ pairingId: z.string().max(64) }).strict(), output: setupStatusSchema },
  setupTelegramTest: { input: z.null(), output: z.object({ ok: z.boolean() }) },
  setupTelegramDisconnect: { input: z.null(), output: setupStatusSchema },
  setupStatus: { input: z.null(), output: setupStatusSchema },
  setupFinish: { input: z.null(), output: z.object({ ok: z.boolean() }) },
  setupSave: { input: preferencesSchema, output: setupStatusSchema },
};

export function createSetup(bb: BbPluginApi, settings: { get(): Promise<StoredSettings> }) {
  const telegram = createTelegramSetup(bb, settings);
  async function status(): Promise<SetupStatus> {
    const cfg = await settings.get();
    const quietValid = clockTime.safeParse(cfg.quietStart).success && clockTime.safeParse(cfg.quietEnd).success && Boolean(cfg.quietStart) === Boolean(cfg.quietEnd);
    return {
      pairing: telegram.pairing(),
      completed: (await bb.storage.kv.get<boolean>("setup:completed")) === true,
      version: packageInfo.version,
      preferences: {
        notifyBlocked: cfg.notifyBlocked, notifyFailed: cfg.notifyFailed, notifyFinished: cfg.notifyFinished, notifyExtensions: cfg.notifyExtensions,
        toastEnabled: cfg.toastEnabled, desktopEnabled: cfg.desktopEnabled, telegramInstant: cfg.telegramInstant,
        cooldownSeconds: Math.trunc(Math.max(0, Math.min(86400, Number(cfg.cooldownSeconds) || 0))),
        quietStart: quietValid ? cfg.quietStart : "",
        quietEnd: quietValid ? cfg.quietEnd : "",
      },
      desktopAvailable: desktopAvailable(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      telegram: await telegram.status(),
    };
  }
  return {
    telegram,
    handlers: {
    ...createUpdates(bb, telegram.withUpdate),
    setupTelegramBegin: ({ token }: { token: string }) => telegram.begin(token),
    setupTelegramCheck: ({ pairingId }: { pairingId: string }) => telegram.check(pairingId),
    setupTelegramCancel: ({ pairingId }: { pairingId: string }) => telegram.cancel(pairingId),
    async setupTelegramConfirm({ pairingId }: { pairingId: string }) { await telegram.confirm(pairingId); return status(); },
    setupTelegramTest: () => telegram.test(),
    async setupTelegramDisconnect() { await telegram.disconnect(); return status(); },
    setupStatus: status,
    async setupFinish() {
      await bb.storage.kv.set("setup:completed", true);
      return { ok: true };
    },
    async setupSave(input: Preferences) {
      await bb.sdk.plugins.updateSettings({ pluginId: bb.pluginId, values: {
        ...input, cooldownSeconds: String(input.cooldownSeconds),
      } });
      return status();
    },
    },
  };
}
