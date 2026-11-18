import { createHmac } from "node:crypto";

import { channels, type HttpChannelPostInput } from "managed-deepagents";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { photonImessageChannel } from "../src/index.js";

const spectrum = vi.hoisted(() => {
  const space = {
    type: "dm",
    send: vi.fn(),
    startTyping: vi.fn(),
    stopTyping: vi.fn(),
  };
  return {
    space,
    getSpace: vi.fn(),
    stop: vi.fn(),
    open: vi.fn(),
  };
});

vi.mock("@spectrum-ts/core", () => ({ Spectrum: spectrum.open }));
vi.mock("@spectrum-ts/imessage", () => ({
  imessage: Object.assign(() => ({ space: { get: spectrum.getSpace } }), {
    config: () => ({ provider: "imessage" }),
  }),
}));

const senderId = "+12025550101";
const spaceId = "iMessage;-;+12025550101";
const target = {
  projectId: "stable-project",
  senderId,
  spaceId,
  phone: "+12025550100",
};
const secret = "a-test-signing-secret";
const delivery = { threadId: "2ff30922-3894-55d6-88ad-9dbbaf2c3d6e" };
const finished = { ...delivery, type: "skipped", reason: "duplicate", interrupts: [] } as const;

function callbacks() {
  const http = vi.spyOn(channels, "http");
  const channel = photonImessageChannel();
  expect(channel.kind).toBe("photon");
  const options = http.mock.calls.at(-1)?.[0];
  if (!options) throw new Error("The factory did not register an HTTP channel");
  return options;
}

function envelope() {
  const space = { id: spaceId, platform: "iMessage", type: "dm", phone: target.phone };
  return {
    event: "messages",
    space,
    message: {
      id: "inbound-1",
      platform: "iMessage",
      direction: "inbound",
      sender: { id: senderId },
      space,
      content: { type: "text", text: "Remember my favorite color is blue." },
    },
  };
}

function signedRequest(body: unknown = envelope(), age = 0) {
  const json = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000) - age);
  const rawBody = new TextEncoder().encode(json);
  const signature = createHmac("sha256", secret).update(`v0:${timestamp}:`).update(rawBody).digest("hex");
  const request = new Request("https://example.test/channels/photon/events", {
    method: "POST",
    headers: {
      "x-spectrum-timestamp": timestamp,
      "x-spectrum-signature": `v0=${signature}`,
    },
    body: rawBody,
  });
  return { rawBody, request };
}

beforeEach(() => {
  vi.stubEnv("PHOTON_PROJECT_ID", target.projectId);
  vi.stubEnv("PHOTON_PROJECT_SECRET", "test-project-secret");
  vi.stubEnv("PHOTON_ALLOWED_SENDERS", senderId);
  vi.stubEnv("PHOTON_WEBHOOK_SECRET", secret);
  vi.clearAllMocks();
  spectrum.open.mockResolvedValue({ stop: spectrum.stop });
  spectrum.stop.mockResolvedValue(undefined);
  spectrum.getSpace.mockResolvedValue(spectrum.space);
  spectrum.space.send.mockResolvedValue({ id: "outbound-1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Photon HTTP channel", () => {
  it("creates a channel without opening a connection or reading secrets at import", async () => {
    vi.stubEnv("PHOTON_PROJECT_SECRET", undefined);
    vi.stubEnv("PHOTON_WEBHOOK_SECRET", undefined);
    expect(await callbacks().verify(signedRequest())).toBe(false);
    expect(spectrum.open).not.toHaveBeenCalled();
  });

  it("checks the signature, original bytes, and replay window", async () => {
    const { verify } = callbacks();
    const input = signedRequest();
    expect(await verify(input)).toBe(true);
    expect(await verify({ ...input, rawBody: new TextEncoder().encode("{}") })).toBe(false);
    expect(await verify(signedRequest(envelope(), 301))).toBe(false);
    expect(await verify(signedRequest(envelope(), -301))).toBe(false);
    input.request.headers.delete("x-spectrum-signature");
    expect(await verify(input)).toBe(false);
  });

  it("maps a verified sender, stable conversation and provider delivery key", async () => {
    const { parse } = callbacks();
    const one = await parse(signedRequest());
    expect(one).toEqual({
      type: "message",
      message: {
        userId: senderId,
        threadId: expect.stringMatching(/^[a-f0-9-]{36}$/),
        deliveryKey: "inbound-1",
        content: envelope().message.content.text,
        target,
      },
    });

    const next = envelope();
    next.message.id = "inbound-2";
    const two = await parse(signedRequest(next));
    expect(one.type === "message" && two.type === "message" &&
      one.message.threadId === two.message.threadId).toBe(true);
    expect(two).toMatchObject({ message: { deliveryKey: "inbound-2" } });

    next.space.id = "another-conversation";
    const other = await parse(signedRequest(next));
    expect(two.type === "message" && other.type === "message" &&
      two.message.threadId !== other.message.threadId).toBe(true);

    vi.stubEnv("PHOTON_PROJECT_ID", "other-stable-project");
    const otherProject = await parse(signedRequest());
    expect(one.type === "message" && otherProject.type === "message" &&
      one.message.threadId !== otherProject.message.threadId).toBe(true);
  });

  it.each([
    ["outbound text", (value: ReturnType<typeof envelope>) => { value.message.direction = "outbound"; }],
    ["unapproved sender", (value: ReturnType<typeof envelope>) => { value.message.sender.id = "+12025550102"; }],
    ["group", (value: ReturnType<typeof envelope>) => { value.space.type = "group"; }],
    ["SMS", (value: ReturnType<typeof envelope>) => { value.space.platform = "SMS"; value.message.platform = "SMS"; }],
    ["non-text", (value: ReturnType<typeof envelope>) => { value.message.content.type = "reaction"; }],
    ["blank text", (value: ReturnType<typeof envelope>) => { value.message.content.text = " "; }],
    ["unknown event", (value: ReturnType<typeof envelope>) => { value.event = "future-event"; }],
  ])("ignores %s", async (_label, change) => {
    const event = envelope();
    change(event);
    expect(await callbacks().parse(signedRequest(event))).toEqual({ type: "ignore" });
  });

  it("rejects malformed signed message shapes and mismatched conversation IDs", async () => {
    const { parse } = callbacks();
    await expect(parse(signedRequest({ event: "messages", message: {} }))).rejects.toThrow("Invalid Photon");
    const event = envelope();
    event.space = { ...event.space, id: "different-space" };
    await expect(parse(signedRequest(event))).rejects.toThrow("Invalid Photon");
  });

  it("sends only final text to the exact conversation inside a fresh SDK invocation", async () => {
    const { post } = callbacks();
    const input: HttpChannelPostInput = {
      type: "content",
      target,
      content: [
        { type: "reasoning", text: "internal reasoning" },
        { type: "text", text: "Your favorite color is blue." },
      ],
    };
    await expect(post?.(input)).resolves.toEqual({ id: "outbound-1" });
    expect(spectrum.getSpace).toHaveBeenCalledWith(spaceId, { phone: target.phone });
    expect(spectrum.space.send).toHaveBeenCalledExactlyOnceWith("Your favorite color is blue.");
    expect(spectrum.stop).toHaveBeenCalledTimes(1);
  });

  it("fails closed for altered reply targets, invalid configs and native messages", async () => {
    const { post } = callbacks();
    await expect(post?.({ target, type: "native", native: "payload" })).rejects.toThrow("text");
    await expect(post?.({
      target: { ...target, senderId: "+12025550102" }, type: "content", content: "hi",
    })).rejects.toThrow("target");
    vi.stubEnv("PHOTON_PROJECT_ID", "pho_prj_beta");
    await expect(post?.({ target, type: "content", content: "hi" })).rejects.toThrow("Photon Stable");
    expect(spectrum.open).not.toHaveBeenCalled();
  });

  it("reports a send failure without retrying or leaking the underlying exception", async () => {
    spectrum.space.send.mockRejectedValueOnce(new Error("secret upstream detail"));
    const { post } = callbacks();
    await expect(post?.({ target, type: "content", content: "hi" })).rejects.toThrow("Photon reply failed.");
    expect(spectrum.space.send).toHaveBeenCalledTimes(1);
    expect(spectrum.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps typing through overlapping deliveries and clears it after the last finish", async () => {
    const { onReceived, onFinish } = callbacks();
    await Promise.all([onReceived?.(target, delivery), onReceived?.(target, delivery)]);
    expect(spectrum.space.startTyping).toHaveBeenCalledTimes(1);
    await onFinish?.(target, { ...finished, interrupts: [] });
    expect(spectrum.space.stopTyping).not.toHaveBeenCalled();
    await onFinish?.(target, { ...delivery, type: "failed", reason: "start", interrupts: [] });
    expect(spectrum.space.stopTyping).toHaveBeenCalledTimes(1);
    expect(spectrum.stop).toHaveBeenCalledTimes(2);
  });

  it("serializes a new start after an outstanding stop on the same DM", async () => {
    const { onReceived, onFinish } = callbacks();
    await onReceived?.(target, delivery);
    let resolveStop!: () => void;
    let didStartStop!: () => void;
    const stopStarted = new Promise<void>(resolve => { didStartStop = resolve; });
    spectrum.space.stopTyping.mockImplementationOnce(() => {
      didStartStop();
      return new Promise<void>(resolve => { resolveStop = resolve; });
    });
    const cleanup = onFinish?.(target, { ...finished, interrupts: [] });
    await stopStarted;
    const next = onReceived?.(target, delivery);
    expect(spectrum.space.startTyping).toHaveBeenCalledTimes(1);
    resolveStop();
    await Promise.all([cleanup, next]);
    expect(spectrum.space.startTyping).toHaveBeenCalledTimes(2);
    await onFinish?.(target, { ...finished, reason: "cancel", interrupts: [] });
    expect(spectrum.space.stopTyping).toHaveBeenCalledTimes(2);
  });

  it("keeps typing failures from preventing replies or cleanup", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    spectrum.space.startTyping.mockRejectedValueOnce(new Error("private typing error"));
    const { onReceived, onFinish, post } = callbacks();
    await expect(onReceived?.(target, delivery)).resolves.toBeUndefined();
    await expect(post?.({ target, type: "content", content: "hello" })).resolves.toEqual({ id: "outbound-1" });
    await expect(onFinish?.(target, { ...finished, interrupts: [] })).resolves.toBeUndefined();
    expect(spectrum.space.stopTyping).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith("Photon typing start failed.");
  });
});
