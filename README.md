# Photon iMessage channel for LangSmith

Give an existing JavaScript Managed Deep Agent an iMessage line through Photon Stable. LangSmith hosts the channel and runs your agent with its existing model, instructions, and tools.

In your agent project, install `@brianseong99/photon-langchain` and add one file.

```ts
// channels/photon.ts
import { photonImessageChannel } from "@brianseong99/photon-langchain";

export const channel = photonImessageChannel();
```

[Connect a Managed Deep Agent to iMessage](docs/photon-imessage.md) for project setup, deployment, your first message, and troubleshooting. The [example project](examples/managed-agent/) uses the same channel declaration.

## How the channel works

The Photon channel runs inside your LangSmith deployment. It maps each iMessage conversation to a persistent agent thread and sends the final answer back to the original DM.

```mermaid
sequenceDiagram
    actor Phone as Messages on iPhone
    participant Photon as Photon Stable
    participant Runtime as LangSmith runtime
    participant Channel as Photon channel
    participant Agent as Your existing agent

    Phone->>Photon: Send an iMessage
    Photon->>Runtime: Signed webhook to /channels/photon/events
    Runtime->>Channel: verify() and parse()
    Channel-->>Runtime: Caller, thread UUID, delivery key, text, reply target
    Note over Runtime,Agent: Same conversation uses the same agent thread
    par Accept the delivery
        Runtime-->>Photon: HTTP 202 Accepted
    and Show activity
        Runtime->>Channel: onReceived()
        Channel->>Photon: Start typing through Spectrum SDK
        Photon-->>Phone: Show typing indicator
    and Run the agent
        Runtime->>Agent: Start or queue the turn
        Agent->>Agent: Use configured model, tools, and thread context
    end
    Agent-->>Runtime: Final answer
    Runtime->>Channel: post(answer, reply target)
    Channel->>Photon: Send text to the original DM through Spectrum SDK
    Photon-->>Phone: Deliver the iMessage reply
    Runtime->>Channel: onFinish()
    Channel->>Photon: Stop typing after the last pending delivery
    Photon-->>Phone: Clear typing indicator
```

Typing is best effort and can appear while a turn is queued. The finish hook also clears it after failed or skipped deliveries. [Channel behavior and troubleshooting](docs/photon-imessage.md#use-the-agent-in-messages)

## Develop the package

Use Node.js 24.11+ on the 24.x line, or Node.js 26+. CI uses Node.js 24.

```sh
npm ci
npm run check
npm test
npm run build
npm run smoke
```

The smoke check installs the packed library in a fresh Managed Deep Agents project and compiles that project with `mda build`.
