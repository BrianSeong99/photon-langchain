import { verifySpectrumSignature } from "@spectrum-ts/core/webhook";
import { channels, type HttpChannel } from "managed-deepagents";

import { parsePhotonMessage, readReplyTarget } from "./events.js";
import { sendPhotonText } from "./spectrum.js";
import { createTypingHooks } from "./typing.js";

export function photonImessageChannel(): HttpChannel {
  return channels.http({
    provider: "photon",

    async verify({ request, rawBody }) {
      const secret = process.env.PHOTON_WEBHOOK_SECRET?.trim();
      if (!secret) return false;

      return (await verifySpectrumSignature({
        headers: Object.fromEntries(request.headers),
        rawBody,
        secret,
      })).ok;
    },

    async parse({ request }) {
      return parsePhotonMessage(await request.json());
    },

    ...createTypingHooks(),

    async post(input) {
      if (input.type !== "content" || input.newThread) {
        throw new Error("Photon supports text replies in the original DM.");
      }
      const content: unknown = input.content;
      const text = typeof content === "string" ? content : Array.isArray(content)
        ? content.flatMap((block: unknown) => {
          if (block && typeof block === "object" && "type" in block && block.type === "text" &&
            "text" in block && typeof block.text === "string") return [block.text];
          return [];
        }).join("\n")
        : "";
      if (!text.trim()) throw new Error("Photon reply requires final text.");

      return sendPhotonText(readReplyTarget(input.target), text);
    },

    async onError() {
      // A failed run or send must not cause another iMessage delivery attempt.
      console.warn("Photon channel run or reply failed.");
    },
  });
}
