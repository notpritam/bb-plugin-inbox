# Notify through Needs You

Needs You 0.2.0-beta.3+ exposes an optional activity API for other BB extensions.
It saves one inbox item per extension and piece of work, sends enabled alerts,
and opens the source extension when the user selects the item.

Use this for meaningful outcomes such as a completed review guide. Hidden
worker threads are not notification targets. Never send credentials, diffs,
private notes, or other sensitive content in notification text.

```ts
import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export async function notifyGuideReady(
  bb: BbPluginApi,
  input: { targetKey: string; generationId: string; completedAt: number; projectId: string; title: string },
) {
  try {
    await bb.sdk.plugins.callRpc({
      pluginId: "inbox", method: "activityCapabilities", input: null,
      outputSchema: z.object({ version: z.literal(1) }),
    });
    return await bb.sdk.plugins.callRpc({
      pluginId: "inbox", method: "publishActivity",
      input: {
        sourceId: bb.pluginId, sourceName: "Guided Review",
        entityId: input.targetKey, eventId: input.generationId,
        occurredAt: input.completedAt, projectId: input.projectId,
        title: input.title, body: "Your guide is ready to review.", status: "ready",
        target: { panel: "review", segments: [input.targetKey] },
      },
      outputSchema: z.object({ accepted: z.literal(true), id: z.string(), duplicate: z.boolean() }),
    });
  } catch {
    // Keep your completed work successful. Needs You may be absent, disabled,
    // outdated, or restarting. Retain the same event for a bounded retry.
    return null;
  }
}
```

## Contract

- `sourceId`: your plugin ID; lowercase letters, digits and hyphens, up to 80 characters.
- `sourceName`: the readable extension name, up to 80 characters.
- `entityId`: stable identity for the review or job, up to 512 characters.
- `eventId`: stable identity for this outcome, up to 128 characters. Retries reuse it.
- `occurredAt`: integer milliseconds. Persist a strictly increasing value per entity
  for new outcomes, even when two outcomes occur in the same millisecond. Retries
  must reuse the original timestamp; older or equal timestamps are ignored.
- `projectId`: optional BB project ID. Omit for installation-wide activity.
- `title`: 1–240 characters; `body`: up to 600 characters.
- `status`: `ready` or `error`.
- `target`: your registered nav panel's path and up to 12 unencoded subpath segments.
  Segments cannot contain slashes, backslashes, controls, `.` or `..`.
  Needs You constructs `/plugins/<sourceId>/<panel>/<encoded segments>`.

RPC calls run in the trusted BB installation. The SDK does not provide an
authenticated caller identity for these methods: source fields are attribution,
not an authorization boundary. This is not a public webhook or remote send API.

`accepted` means the item is saved, not that Telegram or a desktop notification
was delivered. Duplicate and older events return `duplicate: true` and do not
send alerts. A newer outcome replaces the entity's row and can notify again.
Dismissal retains its dedup receipt across reloads. Completed items stay visible
until dismissed; closing a popup does not dismiss its inbox item.

## User controls and delivery

**Settings → Extension activity** is on by default, separately from completed
thread alerts. Turning it off silences delivery and leaves saved items available.
Failure alerts also respect **Failed runs**. Quiet hours, popup, desktop and
Telegram instant-push preferences apply. Telegram must already be connected.
Popups stay quiet while the exact destination is open in that browser window.
Desktop/Telegram delivery is independent of which browser window is open.

Receipts are committed before channel delivery to prevent duplicate pings after
a lost response. Channel failures are not retried automatically; the inbox item
is the durable fallback. In-app popups require BB's desktop sidebar accessory;
the inbox also works on compact layouts. Checking for updates does not install
them; normal BB update handling applies.

Guided Review retries an unacknowledged event once a minute for up to 24 hours
while loaded. It discards outcomes superseded by a newer generation and never
turns a successful guide into an error because notification delivery failed.
