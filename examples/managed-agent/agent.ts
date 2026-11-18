import { defineDeepAgent } from "managed-deepagents";

export const agent = defineDeepAgent({
  name: "photon-imessage-example",
  model: process.env.EXAMPLE_MODEL || "openai:gpt-6.1-sol",
});
