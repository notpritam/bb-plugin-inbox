// Route an inbound Telegram reply back into a bb thread: answer a pending
// question, approve/deny an approval, or (if nothing is pending) send it as a
// follow-up message.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

type Interaction = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["interactions"]["list"]>
>[number];
type QuestionPayload = Extract<
  Interaction["payload"],
  { kind: "user_question" }
>;
type Question = QuestionPayload["questions"][number];

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Map free-text (or option label/value) onto a question's answer shape. */
function buildAnswer(
  question: Question,
  text: string,
): { freeText?: string; selected: string[] } {
  const trimmed = text.trim();
  const options = question.options ?? [];
  if (options.length > 0) {
    const parts = question.multiSelect
      ? trimmed.split(/\s*,\s*/).filter(Boolean)
      : [trimmed];
    const selected: string[] = [];
    for (const part of parts) {
      const match = options.find(
        (o) =>
          o.value.toLowerCase() === part.toLowerCase() ||
          o.label.toLowerCase() === part.toLowerCase(),
      );
      if (match) selected.push(match.value);
    }
    if (selected.length > 0) return { selected };
    if (question.allowFreeText) return { freeText: trimmed, selected: [] };
    return { selected: [] };
  }
  return question.allowFreeText
    ? { freeText: trimmed, selected: [] }
    : { selected: [] };
}

export interface RouteResult {
  ok: boolean;
  message: string;
}

/**
 * Deliver `text` to `threadId` based on its current pending interaction (if any).
 * Returns a short confirmation to send back to Telegram.
 */
export async function routeReply(
  bb: BbPluginApi,
  threadId: string,
  text: string,
): Promise<RouteResult> {
  let thread;
  try {
    thread = await bb.sdk.threads.get({ threadId });
  } catch {
    return { ok: false, message: "That thread is no longer available." };
  }

  const pending = (
    await bb.sdk.threads.interactions.list({ threadId })
  ).find((item) => item.status === "pending");

  if (pending) {
    const payload = pending.payload;

    if (payload.kind === "user_question") {
      const answers: Record<string, { freeText?: string; selected: string[] }> = {};
      payload.questions.forEach((question, index) => {
        answers[question.id] =
          index === 0
            ? buildAnswer(question, text)
            : question.allowFreeText
              ? { freeText: "", selected: [] }
              : { selected: [] };
      });
      try {
        await bb.sdk.threads.interactions.resolve({
          threadId,
          interactionId: pending.id,
          resolution: { kind: "user_answer", answers },
        });
        return {
          ok: true,
          message: `✅ Answered: ${truncate(payload.questions[0]?.prompt ?? "question", 70)}`,
        };
      } catch (error) {
        return {
          ok: false,
          message: `Couldn't submit that answer (${error instanceof Error ? error.message : String(error)}). Answer it in bb.`,
        };
      }
    }

    if (payload.kind === "plugin") {
      return {
        ok: false,
        message: "This prompt needs to be answered inside bb.",
      };
    }

    // Provider approval (plan / command / file change).
    const t = text.trim().toLowerCase();
    if (/^(y|yes|approve|ok|okay|allow|go|do it)\b/.test(t)) {
      await bb.sdk.threads.interactions.resolve({
        threadId,
        interactionId: pending.id,
        resolution: { decision: "allow_once", grantedPermissions: null },
      });
      return { ok: true, message: "✅ Approved." };
    }
    if (/^(n|no|deny|reject|stop|don'?t)\b/.test(t)) {
      await bb.sdk.threads.interactions.resolve({
        threadId,
        interactionId: pending.id,
        resolution: { decision: "deny" },
      });
      return { ok: true, message: "🚫 Denied." };
    }
    return {
      ok: false,
      message: 'This is an approval — reply "yes" to approve or "no" to deny.',
    };
  }

  // Nothing pending — continue the conversation.
  try {
    await bb.sdk.threads.send({
      threadId,
      mode: "auto",
      input: [{ type: "text", text, mentions: [] }],
    });
    const title = thread.title ?? "the thread";
    return { ok: true, message: `✉️ Sent to ${truncate(title, 60)}.` };
  } catch (error) {
    return {
      ok: false,
      message: `Couldn't send: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
