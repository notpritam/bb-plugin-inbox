import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import packageInfo from "./package.json" with { type: "json" };
export const updateSchema = z.object({
  outcome: z.enum(["update-available", "current", "incompatible", "pinned", "unavailable"]),
  installedVersion: z.string(), latestVersion: z.string().nullable(), candidateVersion: z.string().nullable(),
  detail: z.string(), checkedAt: z.number(),
});
export type UpdateStatus = z.infer<typeof updateSchema>;
export const updateRpc = {
  setupCheckUpdates: { input: z.object({ force: z.boolean().default(false) }), output: updateSchema },
  setupApplyUpdate: { input: z.object({ candidateVersion: z.string().min(1).max(512) }).strict(),
    output: z.object({ outcome: z.enum(["updated", "current", "rolled-back"]), version: z.string().nullable() }) },
};
export function createUpdates(bb: BbPluginApi, withUpdate: <T>(run: () => Promise<T>) => Promise<T>) {
  let cache: UpdateStatus | null = null;
  let checking: Promise<UpdateStatus> | null = null;
  let applying = false;
  async function check(force: boolean): Promise<UpdateStatus> {
    if (checking) return checking;
    if (!force && cache && Date.now() - cache.checkedAt < 15 * 60_000) return cache;
    checking = (async () => {
      try {
        const entry = (await bb.sdk.plugins.checkUpdates({ pluginId: bb.pluginId })).find(e => e.id === bb.pluginId);
        if (!entry) throw new Error("missing result");
        const detail = {
          "update-available": "A compatible release is ready. Your preferences and Telegram connection stay in BB when you update.",
          current: "You’re on the latest compatible release.",
          incompatible: "A newer release requires a newer BB or Node version. Update your BB host, then check again.",
          pinned: "This installation is pinned or local. A marketplace or Git version-range installation can follow compatible releases.",
          unavailable: "Couldn’t resolve updates for this installation. Try checking again.",
        }[entry.outcome];
        cache = { outcome: entry.outcome, installedVersion: packageInfo.version,
          latestVersion: entry.candidate?.display ?? entry.blocked?.version ?? null,
          candidateVersion: entry.candidate?.version ?? null, detail, checkedAt: Date.now() };
        return cache;
      } catch { cache = null; throw new Error("Couldn’t check for updates. Check the BB host’s connection and try again."); }
      finally { checking = null; }
    })();
    return checking;
  }
  return {
    setupCheckUpdates: ({ force }: { force: boolean }) => check(force),
    async setupApplyUpdate({ candidateVersion }: { candidateVersion: string }) {
      if (applying) throw new Error("An update is already running.");
      applying = true;
      try { return await withUpdate(async () => {
        if (checking) await checking;
        const latest = await check(true);
        if (latest.outcome !== "update-available" || latest.candidateVersion !== candidateVersion) {
          throw new Error("The available update changed or is blocked. Check again before updating.");
        }
        let result;
        try { result = await bb.sdk.plugins.applyUpdate({ pluginId: bb.pluginId }); }
        catch { throw new Error("BB couldn’t complete the update. Check for updates before trying again."); }
        cache = null;
        return { outcome: result.outcome, version: result.to?.display ?? null };
      }); } finally { applying = false; }
    },
  };
}
