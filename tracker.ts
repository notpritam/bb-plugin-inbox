// Thin client for the sibling `tracker` plugin, reached over cross-plugin RPC.
// Lets the Telegram bot add / list / complete daily tasks from the phone.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const TRACKER_ID = "tracker";

// Only the fields we render; callRpc validates and strips the rest.
const zTask = z.object({
  id: z.string(),
  seq: z.number(),
  title: z.string(),
  status: z.enum(["open", "done"]),
  dueDate: z.string().nullable(),
  projectName: z.string().nullable(),
});
export type TrackerTask = z.infer<typeof zTask>;

export type TrackerView = "today" | "upcoming" | "all" | "done";

export async function trackerAdd(
  bb: BbPluginApi,
  title: string,
  dueDate: string | null = null,
): Promise<TrackerTask> {
  const out = await bb.sdk.plugins.callRpc({
    pluginId: TRACKER_ID,
    method: "addTask",
    input: { title, dueDate },
    outputSchema: z.object({ task: zTask }),
  });
  return out.task;
}

export async function trackerList(
  bb: BbPluginApi,
  view: TrackerView,
): Promise<{ today: string; tasks: TrackerTask[] }> {
  return bb.sdk.plugins.callRpc({
    pluginId: TRACKER_ID,
    method: "listTasks",
    input: { view },
    outputSchema: z.object({ today: z.string(), tasks: z.array(zTask) }),
  });
}

/** Complete an open task by its short seq (#). Returns null if not found. */
export async function trackerComplete(
  bb: BbPluginApi,
  seq: number,
): Promise<TrackerTask | null> {
  const { tasks } = await trackerList(bb, "all");
  const target = tasks.find((t) => t.seq === seq);
  if (!target) return null;
  const out = await bb.sdk.plugins.callRpc({
    pluginId: TRACKER_ID,
    method: "setStatus",
    input: { id: target.id, status: "done" },
    outputSchema: z.object({ task: zTask }),
  });
  return out.task;
}
