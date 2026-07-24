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
const dataDirectory = process.env.CODEX_HOME ?? process.cwd();

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

const accessState = () => {
  try {
    return JSON.parse(readFileSync(join(dataDirectory, "fake-codex-access.json"), "utf8"));
  } catch {
    return { status: "available" };
  }
};

const teachingControl = () => accessState();

const waitForTeachingRelease = () => new Promise((resolve) => {
  const release = setInterval(() => {
    if (!teachingControl().holdTeaching) {
      clearInterval(release);
      resolve();
    }
  }, 10);
});

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
          userAgent: "clarifold-fake-codex/1",
          codexHome: "/tmp/clarifold-fake-codex",
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
      if (accessState().status === "signedOut") {
        send({ id: message.id, result: { account: null, requiresOpenaiAuth: true } });
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
            id: "clarifold-test-model",
            model: "clarifold-test-model",
            displayName: "Clarifold Test Model",
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
      send({
        id: message.id,
        result: message.params.type === "chatgpt"
          ? {
              type: "chatgpt",
              loginId: "fake-login",
              authUrl: accessState().authenticationUrl ?? "https://auth.openai.com/oauth/authorize?state=fake"
            }
          : { type: message.params.type }
      });
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
        message.params.baseInstructions.includes("Full Access supplies") ? "full" : "bounded"
      );
      send({ id: message.id, result: { thread: { id: `fake-thread-${threadNumber}` } } });
      break;
    case "turn/start": {
      turnNumber += 1;
      const turnId = `fake-turn-${turnNumber}`;
      send({ id: message.id, result: { turn: { id: turnId } } });
      queueMicrotask(async () => {
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
          const delayedTransferTask = Boolean(message.params.outputSchema.properties?.taskDemand);
          const delayedTransferAssessment = Boolean(message.params.outputSchema.properties?.reasoningQuality);
          const annotationId = prompt.match(/"annotationId":"([^"]+)"/)?.[1];
          const structuredResult = delayedTransferTask ? {
            prompt: "A compact parameter space is covered by neighbourhoods carrying local bounds. Explain how to obtain one uniform bound.",
            concept: "compactness",
            taskDemand: "derive a uniform bound from finitely many local bounds",
            structuralComparison: "The mathematical objects change while the finite-subcover proof structure remains.",
            mathematicalContext: {
              concepts: ["compactness", "finite subcover"],
              mathematicalStructures: ["compact parameter space with local bounds"],
              prerequisiteRelationships: [{
                prerequisiteConcept: "open cover", supportsConcept: "compactness", relationship: "requiredFor"
              }],
              taskDemands: ["derive a uniform bound from finitely many local bounds"]
            }
          } : delayedTransferAssessment ? {
            result: "partial",
            reasoningQuality: "developing",
            confidenceCalibration: "aligned",
            misconceptionOrStrength: "The finite reduction is correct, but the uniform maximum still needs justification.",
            recommendedNextAction: "Explain why the maximum controls every parameter.",
            refresherGoal: "Connect the finite subcover to the construction of one uniform bound."
          } : artifactSynthesis ? {
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
          };
          send({
            method: "item/agentMessage/delta",
            params: {
              threadId: message.params.threadId,
              turnId,
              itemId: artifactSynthesis ? "artifact-synthesis" : delayedTransferTask ? "delayed-task"
                : delayedTransferAssessment ? "delayed-assessment" : "proposal",
              delta: JSON.stringify(structuredResult)
            }
          });
        } else if ((message.params.input[0].text.includes("TRIGGER_ACCESS_REQUEST")
          && threadPolicies.get(message.params.threadId) !== "full")
          || (message.params.input[0].text.includes("TRIGGER_NARROW_ACCESS_REQUEST")
            && message.params.input[0].text.includes("Session Access Policy: Focused Access"))) {
          writeFileSync(join(dataDirectory, "fake-codex-last-teaching-input.json"), JSON.stringify({
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
          writeFileSync(join(dataDirectory, "fake-codex-last-teaching-input.json"), JSON.stringify({
            prompt: message.params.input[0].text
          }), "utf8");
          if (teachingControl().holdTeaching) await waitForTeachingRelease();
          send({
            method: "item/agentMessage/delta",
            params: {
              threadId: message.params.threadId,
              turnId,
              itemId: "teaching-card",
              delta: message.params.input[0].text.includes("Answer one clarification about a Delayed Transfer Check")
                ? "Use the parameter neighbourhoods on which each local estimate holds; you still need to justify the finite reduction."
                : "Start from the key definition, then connect each inference to the stated goal."
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
