import { slimEnvelopeSchema } from "@spectrum-ts/core/webhook";
import type { HttpChannelParseResult } from "managed-deepagents";
import { v5 } from "uuid";

const phoneNumber = /^\+[1-9]\d{7,14}$/;
const threadNamespace = "8d4cb36f-dfa4-4e9a-9f9b-a12d806b6b22";

export type ReplyTarget = {
  projectId: string;
  senderId: string;
  spaceId: string;
  phone?: string;
};

export function photonProjectId(): string {
  const id = process.env.PHOTON_PROJECT_ID?.trim();
  if (!id || id.startsWith("pho_prj_")) {
    throw new Error("Set PHOTON_PROJECT_ID to a Photon Stable project ID.");
  }
  return id;
}

function allowedSender(senderId: unknown): senderId is string {
  if (typeof senderId !== "string" || !phoneNumber.test(senderId)) return false;
  const allowed = (process.env.PHOTON_ALLOWED_SENDERS ?? "").split(",").map(value => value.trim());
  return allowed.includes(senderId);
}

export function parsePhotonMessage(payload: unknown): HttpChannelParseResult {
  if (!payload || typeof payload !== "object" || !("event" in payload) ||
    typeof payload.event !== "string") {
    throw new Error("Invalid Photon webhook payload.");
  }
  if (payload.event !== "messages") return { type: "ignore" };

  const parsed = slimEnvelopeSchema.safeParse(payload);
  if (!parsed.success) throw new Error("Invalid Photon message event.");

  const { message, space: envelopeSpace } = parsed.data;
  const space = message.space;
  if (!space.id.trim() || (envelopeSpace && envelopeSpace.id !== space.id)) {
    throw new Error("Invalid Photon conversation ID.");
  }
  const senderId = message.sender?.id;
  if (
    message.direction !== "inbound" ||
    space.platform?.toLowerCase() !== "imessage" ||
    (message.platform && message.platform.toLowerCase() !== "imessage") ||
    space.type !== "dm" ||
    !allowedSender(senderId) ||
    message.content.type !== "text" ||
    typeof message.content.text !== "string" ||
    !message.content.text.trim()
  ) return { type: "ignore" };

  if (!message.id.trim()) throw new Error("Invalid Photon message ID.");
  const projectId = photonProjectId();
  const target: ReplyTarget = { projectId, senderId, spaceId: space.id };
  if (typeof space.phone === "string" && space.phone.trim()) target.phone = space.phone;

  return {
    type: "message",
    message: {
      userId: senderId,
      threadId: v5(JSON.stringify([projectId, space.id]), threadNamespace),
      deliveryKey: message.id,
      content: message.content.text,
      target,
    },
  };
}

export function readReplyTarget(target: unknown): ReplyTarget {
  const projectId = photonProjectId();
  if (
    !target || typeof target !== "object" ||
    !("projectId" in target) || target.projectId !== projectId ||
    !("senderId" in target) || !allowedSender(target.senderId) ||
    !("spaceId" in target) || typeof target.spaceId !== "string" || !target.spaceId.trim()
  ) throw new Error("Invalid Photon reply target.");

  const replyTarget: ReplyTarget = { projectId, senderId: target.senderId, spaceId: target.spaceId };
  if ("phone" in target) {
    if (typeof target.phone !== "string" || !target.phone.trim()) {
      throw new Error("Invalid Photon reply target.");
    }
    replyTarget.phone = target.phone;
  }
  return replyTarget;
}
