import type { HttpChannelAdapter } from "managed-deepagents";

import { readReplyTarget, type ReplyTarget } from "./events.js";
import { sendPhotonTyping } from "./spectrum.js";

type ActiveDm = { pending: number; signal: Promise<void> };

export function createTypingHooks(): Pick<HttpChannelAdapter, "onReceived" | "onFinish"> {
  const active = new Map<string, ActiveDm>();

  async function changeTyping(target: ReplyTarget, enabled: boolean): Promise<void> {
    try {
      await sendPhotonTyping(target, enabled);
    } catch {
      console.warn(enabled ? "Photon typing start failed." : "Photon typing stop failed.");
    }
  }

  return {
    async onReceived(target) {
      const dm = readReplyTarget(target);
      const key = JSON.stringify([dm.projectId, dm.spaceId, dm.phone]);
      const entry = active.get(key) ?? { pending: 0, signal: Promise.resolve() };
      active.set(key, entry);
      entry.pending += 1;
      if (entry.pending === 1) {
        entry.signal = entry.signal.then(() => changeTyping(dm, true));
      }
      await entry.signal;
    },

    async onFinish(target) {
      const dm = readReplyTarget(target);
      const key = JSON.stringify([dm.projectId, dm.spaceId, dm.phone]);
      const entry = active.get(key);
      if (!entry || !entry.pending) return;
      entry.pending -= 1;
      if (entry.pending) return;

      const stop = entry.signal.then(() => changeTyping(dm, false));
      entry.signal = stop;
      await stop;
      if (entry.signal === stop) active.delete(key);
    },
  };
}
