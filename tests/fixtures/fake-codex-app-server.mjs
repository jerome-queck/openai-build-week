#!/usr/bin/env node

import { createInterface } from "node:readline";

let threadNumber = 0;

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;

  switch (message.method) {
    case "initialize":
      send({
        id: message.id,
        result: {
          userAgent: "quick-study-fake-codex/1",
          codexHome: "/tmp/quick-study-fake-codex",
          platformFamily: "unix",
          platformOs: "macos"
        }
      });
      break;
    case "account/read":
      send({
        id: message.id,
        result: {
          account: { type: "chatgpt", email: "packaged-test@example.test", planType: "plus" },
          requiresOpenaiAuth: true
        }
      });
      break;
    case "account/login/start":
      send({ id: message.id, result: { type: message.params.type } });
      break;
    case "thread/start":
      threadNumber += 1;
      send({ id: message.id, result: { thread: { id: `fake-thread-${threadNumber}` } } });
      break;
    case "turn/start": {
      const turnId = `fake-turn-${threadNumber}`;
      send({ id: message.id, result: { turn: { id: turnId } } });
      queueMicrotask(() => {
        if (message.params.outputSchema) {
          send({
            method: "item/agentMessage/delta",
            params: {
              threadId: message.params.threadId,
              turnId,
              itemId: "proposal",
              delta: JSON.stringify({
                learningGoal: "Understand the mathematical strategy",
                scope: "Work through the central claim",
                initialTeachingDirection: "Identify the key definition and first inference",
                requiresConfirmation: false,
                confirmationReason: null
              })
            }
          });
        } else {
          send({
            method: "item/agentMessage/delta",
            params: {
              threadId: message.params.threadId,
              turnId,
              itemId: "teaching-card",
              delta: "Start from the key definition, then connect each inference to the stated goal."
            }
          });
        }
        send({
          method: "turn/completed",
          params: {
            threadId: message.params.threadId,
            turn: { id: turnId, status: "completed", error: null }
          }
        });
      });
      break;
    }
    case "turn/interrupt":
      send({ id: message.id, result: {} });
      break;
  }
});
