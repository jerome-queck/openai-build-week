#!/usr/bin/env node

import { createInterface } from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let threadNumber = 0;
let turnNumber = 0;
let serverRequestNumber = 1_000;
const threadPolicies = new Map();
const threadKinds = new Map();
const pendingAccessRequests = new Map();

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

const accessState = () => {
  try {
    return JSON.parse(readFileSync(join(process.env.QUICK_STUDY_DATA_DIR, "fake-codex-access.json"), "utf8"));
  } catch {
    return { status: "available" };
  }
};

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (!message.method && pendingAccessRequests.has(message.id)) {
    const pending = pendingAccessRequests.get(message.id);
    pendingAccessRequests.delete(message.id);
    send({
      method: "item/agentMessage/delta",
      params: {
        threadId: pending.threadId,
        turnId: pending.turnId,
        itemId: "teaching-card",
        delta: message.result?.contentItems?.[0]?.text ?? "Continue within the learner's access decision."
      }
    });
    send({
      method: "turn/completed",
      params: { threadId: pending.threadId, turn: { id: pending.turnId, status: "completed", error: null } }
    });
    return;
  }

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
      if (accessState().status === "runtime") {
        process.exit(1);
      }
      if (accessState().status === "unavailable") {
        send({ id: message.id, error: { code: -32000, message: accessState().message } });
        break;
      }
      send({
        id: message.id,
        result: {
          account: { type: "chatgpt", email: "packaged-test@example.test", planType: "plus" },
          requiresOpenaiAuth: true
        }
      });
      break;
    case "model/list":
      send({
        id: message.id,
        result: {
          data: [{
            id: "quick-study-test-model",
            model: "quick-study-test-model",
            displayName: "Quick Study Test Model",
            description: "Deterministic packaged-test model",
            isDefault: true,
            hidden: false,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Fast" },
              { reasoningEffort: "medium", description: "Balanced" },
              { reasoningEffort: "high", description: "Deep" }
            ]
          }],
          nextCursor: null
        }
      });
      break;
    case "account/login/start":
      send({ id: message.id, result: { type: message.params.type } });
      break;
    case "thread/start":
      threadNumber += 1;
      threadKinds.set(
        `fake-thread-${threadNumber}`,
        message.params.dynamicTools?.some((tool) => tool.name === "checkpoint_specialist_result")
          ? "specialist"
          : "teaching"
      );
      threadPolicies.set(
        `fake-thread-${threadNumber}`,
        message.params.baseInstructions.includes("Full Access permits") ? "full" : "bounded"
      );
      send({ id: message.id, result: { thread: { id: `fake-thread-${threadNumber}` } } });
      break;
    case "turn/start": {
      turnNumber += 1;
      const turnId = `fake-turn-${turnNumber}`;
      send({ id: message.id, result: { turn: { id: turnId } } });
      queueMicrotask(() => {
        if (threadKinds.get(message.params.threadId) === "specialist") {
          const checkpoint = "The retained checkpoint identifies Hausdorff separation.";
          send({
            id: serverRequestNumber++,
            method: "item/tool/call",
            params: {
              threadId: message.params.threadId,
              turnId,
              callId: `checkpoint-${turnId}`,
              namespace: null,
              tool: "checkpoint_specialist_result",
              arguments: { title: "Specialist review", content: checkpoint }
            }
          });
          if (accessState().specialist === "hold") return;
          if (accessState().specialist === "fail") {
            send({
              method: "turn/completed",
              params: {
                threadId: message.params.threadId,
                turn: {
                  id: turnId,
                  status: "failed",
                  error: { message: "Specialist review failed in packaged test." }
                }
              }
            });
            return;
          }
          send({
            method: "item/agentMessage/delta",
            params: {
              threadId: message.params.threadId,
              turnId,
              itemId: "specialist-result",
              delta: JSON.stringify({
                title: "Specialist review",
                content: `${checkpoint} Compactness supplies the finite reduction.`
              })
            }
          });
        } else if (message.params.outputSchema) {
          const prompt = message.params.input[0].text;
          const artifactSynthesis = Boolean(message.params.outputSchema.properties?.noteInterpretations);
          const annotationId = prompt.match(/"annotationId":"([^"]+)"/)?.[1];
          send({
            method: "item/agentMessage/delta",
            params: {
              threadId: message.params.threadId,
              turnId,
              itemId: artifactSynthesis ? "artifact-synthesis" : "proposal",
              delta: JSON.stringify(artifactSynthesis ? {
                content: "Start from the key definition, then preserve the learner's finite-choice insight.",
                noteInterpretations: annotationId ? [{
                  annotationId,
                  interpretation: "The learner connects the equation with a finite-choice insight."
                }] : []
              } : {
                learningGoal: "Understand the mathematical strategy",
                scope: "Work through the central claim",
                initialTeachingDirection: "Identify the key definition and first inference",
                requiresConfirmation: false,
                confirmationReason: null,
                materialScope: "focused",
                argumentRoadmap: null,
                evidenceTransferContext: {
                  concepts: ["compactness"],
                  mathematicalStructures: ["compact Hausdorff subspace"],
                  prerequisiteRelationships: [{
                    prerequisiteConcept: "Hausdorff separation", supportsConcept: "compactness", relationship: "requiredFor"
                  }],
                  taskDemands: ["explain a proof strategy"]
                }
              })
            }
          });
        } else if ((message.params.input[0].text.includes("TRIGGER_ACCESS_REQUEST")
          && threadPolicies.get(message.params.threadId) !== "full")
          || (message.params.input[0].text.includes("TRIGGER_NARROW_ACCESS_REQUEST")
            && message.params.input[0].text.includes("Session Access Policy: Focused Access"))) {
          writeFileSync(join(process.env.QUICK_STUDY_DATA_DIR, "fake-codex-last-teaching-input.json"), JSON.stringify({
            prompt: message.params.input[0].text
          }), "utf8");
          const requestId = serverRequestNumber++;
          pendingAccessRequests.set(requestId, { threadId: message.params.threadId, turnId });
          send({
            id: requestId,
            method: "item/tool/call",
            params: {
              threadId: message.params.threadId,
              turnId,
              callId: `access-call-${requestId}`,
              namespace: null,
              tool: "request_session_access",
              arguments: {
                requestedPolicy: "full",
                reason: "The proof cites a local lemma that is not available under the current policy.",
                exactScope: "/Users/learner/reference/lemma.pdf",
                intendedAction: "Read the cited lemma statement without modifying the source."
              }
            }
          });
          return;
        } else {
          writeFileSync(join(process.env.QUICK_STUDY_DATA_DIR, "fake-codex-last-teaching-input.json"), JSON.stringify({
            prompt: message.params.input[0].text
          }), "utf8");
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
      queueMicrotask(() => send({
        method: "turn/completed",
        params: {
          threadId: message.params.threadId,
          turn: { id: message.params.turnId, status: "interrupted", error: null }
        }
      }));
      break;
  }
});
