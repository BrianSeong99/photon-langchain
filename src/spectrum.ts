import { Spectrum, type Space } from "@spectrum-ts/core";
import { imessage } from "@spectrum-ts/imessage";

import type { ReplyTarget } from "./events.js";

type DirectMessage = Pick<Space, "send" | "startTyping" | "stopTyping">;

async function withPhotonDm<T>(target: ReplyTarget, operation: (space: DirectMessage) => Promise<T>): Promise<T> {
  const projectSecret = process.env.PHOTON_PROJECT_SECRET?.trim();
  if (!projectSecret) throw new Error("Set PHOTON_PROJECT_SECRET for outbound Photon operations.");

  const app = await Spectrum({
    projectId: target.projectId,
    projectSecret,
    providers: [imessage.config()],
    signal: AbortSignal.timeout(10_000),
  });
  try {
    const space = await imessage(app).space.get(target.spaceId, { phone: target.phone });
    if (space.type !== "dm") throw new Error("Photon target must be a DM.");
    return await operation(space);
  } finally {
    await app.stop().catch(() => console.warn("Photon client cleanup failed."));
  }
}

export async function sendPhotonText(target: ReplyTarget, text: string): Promise<{ id: string }> {
  try {
    return await withPhotonDm(target, async space => {
      const sent = await space.send(text);
      if (!sent?.id) throw new Error("Photon did not return a message ID.");
      return { id: sent.id };
    });
  } catch {
    throw new Error("Photon reply failed.");
  }
}

export function sendPhotonTyping(target: ReplyTarget, active: boolean): Promise<void> {
  return withPhotonDm(target, async space => {
    const signal = active ? space.startTyping() : space.stopTyping();
    await signal;
  });
}
