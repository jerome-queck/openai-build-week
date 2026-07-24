import { describe, expect, it, vi } from "vitest";
import {
  ChildProcessExitProof,
  CodexAppServerRuntime,
  codexProcessLaunchSpecification,
  type AppServerTransport
} from "./codex-app-server";

describe("Codex app-server contract", () => {
  it("keeps executable metacharacters as data and inherits only the bounded runtime environment", () => {
    const specification = codexProcessLaunchSpecification(
      "/Applications/Codex; touch PWNED/Contents/MacOS/codex",
      "/Users/learner/Maths \u03c0",
      {
        HOME: "/Users/learner",
        PATH: "/usr/bin:/bin",
        CODEX_HOME: "/Users/learner/.codex",
        HTTPS_PROXY: "https://proxy.example",
        LEARNER_CONTROLLED_SECRET: "must-not-cross-boundary",
        NODE_OPTIONS: "--require=/tmp/untrusted.cjs"
      }
    );

    expect(specification).toEqual({
      executable: "/Applications/Codex; touch PWNED/Contents/MacOS/codex",
      args: ["app-server", "--stdio"],
      options: {
        cwd: "/Users/learner/Maths \u03c0",
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        env: {
          HOME: "/Users/learner",
          PATH: "/usr/bin:/bin",
          CODEX_HOME: "/Users/learner/.codex",
          HTTPS_PROXY: "https://proxy.example"
        }
      }
    });
  });

  it("discovers only models and reasoning efforts advertised by the active runtime", async () => {
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "model/list") {
        transport.respond(message.id, {
          data: [{
            id: "codex-deep", model: "codex-deep", displayName: "Codex Deep", description: "Deep review",
            isDefault: true, hidden: false, defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Balanced" },
              { reasoningEffort: "high", description: "Deep" }
            ]
          }],
          nextCursor: null
        });
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");
    await expect(runtime.getCapabilities()).resolves.toEqual({
      models: [{
        model: "codex-deep", displayName: "Codex Deep", isDefault: true,
        supportedReasoningEfforts: ["medium", "high"]
      }]
    });
    expect(transport.messages).toContainEqual(expect.objectContaining({
      method: "model/list", params: { cursor: null, includeHidden: false, limit: 100 }
    }));
  });

  it("rejects duplicate or ambiguous runtime model catalogs", async () => {
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "model/list") {
        const model = {
          model: "duplicate", displayName: "Duplicate", isDefault: true,
          supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Balanced" }]
        };
        transport.respond(message.id, { data: [model, model], nextCursor: null });
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");
    await expect(runtime.getCapabilities()).rejects.toThrow("ambiguous model catalog");
  });

  it("initializes once and supports both Codex-owned authentication paths", async () => {
    let account: null | { type: "chatgpt"; email: string; planType: string } | { type: "apiKey" } = null;
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      switch (message.method) {
        case "initialize":
          transport.respond(message.id, {
            userAgent: "codex-cli/0.144.1",
            codexHome: "/tmp/codex-home",
            platformFamily: "unix",
            platformOs: "macos"
          });
          break;
        case "account/read":
          transport.respond(message.id, { account, requiresOpenaiAuth: true });
          break;
        case "account/login/start":
          if ((message.params as { type: string }).type === "chatgpt") {
            transport.respond(message.id, {
              type: "chatgpt",
              loginId: "login-1",
              authUrl: "https://auth.openai.com/oauth/authorize?login_id=login-1"
            });
          } else {
            account = { type: "apiKey" };
            transport.respond(message.id, { type: "apiKey" });
          }
          break;
      }
    });

    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");
    expect(transport.messages.slice(0, 2)).toEqual([
      {
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "clarifold", title: "Clarifold", version: "0.2.0" },
          capabilities: { experimentalApi: true, requestAttestation: false }
        }
      },
      { method: "initialized", params: {} }
    ]);
    expect(await runtime.getAuthentication()).toEqual({ status: "signedOut" });

    const login = await runtime.startChatGptLogin();
    expect(login).toEqual({
      loginId: "login-1",
      authUrl: "https://auth.openai.com/oauth/authorize?login_id=login-1"
    });
    expect(transport.messages.at(-1)).toMatchObject({
      method: "account/login/start",
      params: { type: "chatgpt", codexStreamlinedLogin: true, appBrand: "codex" }
    });

    await runtime.loginWithApiKey("sk-contract-sentinel");
    expect(transport.messages.at(-1)).toMatchObject({
      method: "account/login/start",
      params: { type: "apiKey", apiKey: "sk-contract-sentinel" }
    });
    expect(await runtime.getAuthentication()).toEqual({
      status: "signedIn",
      method: "apiKey",
      accountLabel: null
    });
  });

  it.each([
    {},
    { account: { type: "chatgpt", email: 42 } },
    { account: { type: "unexpected", email: null } },
    { account: "signed-in" }
  ])("rejects an incompatible authentication-state response: %j", async (response) => {
    const transport = new ScriptedTransport((message) => {
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "account/read") transport.respond(message.id, response);
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");

    await expect(runtime.getAuthentication()).rejects.toThrow(
      "Codex returned an incompatible authentication response."
    );
  });

  it.each([
    [{ type: "chatgpt", loginId: "login-1", authUrl: "https://example.test/oauth/authorize" }],
    [{ type: "chatgpt", loginId: "login-1", authUrl: "https://auth.opena\u0131.com/oauth/authorize" }],
    [{ type: "chatgpt", loginId: "login-1", authUrl: "https://auth.openai.com/%6fAuth/authorize" }],
    [{ type: "chatgpt", loginId: "login-1", authUrl: 42 }],
    [{ type: "apiKey" }]
  ])("rejects an incompatible ChatGPT login response: %j", async (response) => {
    const transport = new ScriptedTransport((message) => {
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "account/login/start") transport.respond(message.id, response);
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");

    await expect(runtime.startChatGptLogin()).rejects.toThrow(
      /incompatible ChatGPT login response|unsupported ChatGPT authentication URL/
    );
  });

  it("maps stable thread and turn events into a proposal and streamed Teaching Card", async () => {
    let threadNumber = 0;
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1",
          codexHome: "/tmp/codex-home",
          platformFamily: "unix",
          platformOs: "macos"
        });
      }
      if (message.method === "thread/start") {
        threadNumber += 1;
        transport.respond(message.id, { thread: { id: `thread-${threadNumber}` } });
      }
      if (message.method === "turn/start") {
        const params = message.params as { threadId: string; outputSchema?: unknown };
        const turnId = `turn-${threadNumber}`;
        transport.respond(message.id, { turn: { id: turnId } });
        if (params.outputSchema) {
          transport.notify("item/agentMessage/delta", {
            threadId: params.threadId,
            turnId,
            itemId: "proposal",
            delta: JSON.stringify({
              learningGoal: "Understand the alternating series test",
              scope: "Check decreasing magnitude and zero limit",
              initialTeachingDirection: "Inspect the absolute values first",
              requiresConfirmation: false,
              confirmationReason: null,
              materialScope: "focused",
              argumentRoadmap: null,
              evidenceTransferContext: {
                concepts: ["alternating series test"],
                mathematicalStructures: ["real series"],
                prerequisiteRelationships: [{
                  prerequisiteConcept: "absolute value", supportsConcept: "alternating series test", relationship: "requiredFor"
                }],
                taskDemands: ["apply a convergence test"]
              }
            })
          });
        } else {
          transport.notify("item/agentMessage/delta", {
            threadId: params.threadId,
            turnId,
            itemId: "teaching-card",
            delta: "First check that the term magnitudes decrease. "
          });
          transport.notify("item/agentMessage/delta", {
            threadId: params.threadId,
            turnId,
            itemId: "teaching-card",
            delta: "Then check that they tend to zero."
          });
        }
        transport.notify("turn/completed", {
          threadId: params.threadId,
          turn: { id: turnId, status: "completed", error: null }
        });
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");

    await expect(runtime.proposeSession("Does this alternating series converge?")).resolves.toEqual({
      learningGoal: "Understand the alternating series test",
      scope: "Check decreasing magnitude and zero limit",
      initialTeachingDirection: "Inspect the absolute values first",
      requiresConfirmation: false,
      confirmationReason: null,
      materialScope: "focused",
      argumentRoadmap: null,
      evidenceTransferContext: {
        concepts: ["alternating series test"],
        mathematicalStructures: ["real series"],
        prerequisiteRelationships: [{
          prerequisiteConcept: "absolute value", supportsConcept: "alternating series test", relationship: "requiredFor"
        }],
        taskDemands: ["apply a convergence test"]
      }
    });
    const proposalTurn = transport.messages.find((message) => message.method === "turn/start");
    expect(proposalTurn).toMatchObject({
      params: {
        outputSchema: {
          required: expect.arrayContaining(["argumentRoadmap", "evidenceTransferContext"]),
          properties: { argumentRoadmap: expect.any(Object), evidenceTransferContext: expect.any(Object) }
        }
      }
    });
    expect(JSON.stringify(proposalTurn)).toContain("Argument Roadmap");
    expect(transport.messages.find((message) => message.method === "thread/start")).toMatchObject({
      params: {
        cwd: "/workspace",
        approvalPolicy: "never",
        sandbox: "read-only",
        ephemeral: true,
        config: {
          features: {
            apps: false,
            hooks: false,
            multi_agent: false,
            remote_plugin: false,
            shell_tool: false,
            unified_exec: false
          },
          mcp_servers: {},
          web_search: "disabled"
        }
      }
    });

    await expect(runtime.createConceptPeek({
      sessionId: "learning-session-1",
      prerequisite: "absolute convergence",
      mathematics: "Does this alternating series converge?",
      learningGoal: "Understand the alternating series test",
      sourceAnchorId: "anchor-1",
      sourceId: "source-1",
      selection: {
        kind: "text", startOffset: 10, endOffset: 28, exactText: "alternating series", prefix: "Does this ", suffix: " converge?"
      },
      signal: new AbortController().signal
    })).resolves.toBe("First check that the term magnitudes decrease. Then check that they tend to zero.");
    const conceptPeekTurn = transport.messages.filter((message) => message.method === "turn/start").at(-1)!;
    expect(JSON.stringify(conceptPeekTurn.params)).toContain("compact Concept Peek");
    expect(JSON.stringify(conceptPeekTurn.params)).toContain("absolute convergence");

    const deltas: string[] = [];
    await runtime.streamTeaching({
      sessionId: "learning-session-1",
      mathematics: "Does this alternating series converge?",
      learningGoal: "Understand the alternating series test",
      scope: "Check decreasing magnitude and zero limit",
      initialTeachingDirection: "Inspect the absolute values first",
      adaptiveTeaching: {
        kind: "demonstrate",
        route: "proofStructural",
        reason: "Understanding Evidence indicates a specific gap in the finite-subcover step."
      },
      learnerModelGuidance: {
        evidenceTransfers: [{
          id: "transfer-1",
          origin: "transferred",
          learnerModelEntryId: "ledger-1",
          sourceSessionId: "source-session",
          sourceRecordId: "evidence-1",
          inference: "secure understanding",
          confidence: "high",
          sourceContext: {
            concepts: ["alternating series test"], mathematicalStructures: ["real series"],
            prerequisiteRelationships: [{
              prerequisiteConcept: "absolute value", supportsConcept: "alternating series test", relationship: "requiredFor"
            }], taskDemands: ["apply a convergence test"]
          },
          targetContext: {
            concepts: ["alternating series test"], mathematicalStructures: ["real series"],
            prerequisiteRelationships: [{
              prerequisiteConcept: "absolute value", supportsConcept: "alternating series test", relationship: "requiredFor"
            }], taskDemands: ["apply a convergence test"]
          },
          provenance: {
            workspaceId: "workspace-1", missionId: "mission-1", sessionTarget: "Choose a convergence test",
            summary: "The learner applied the alternating series test correctly.", lastUpdatedAt: "2026-07-20T00:00:00.000Z"
          }
        }],
        priorUnderstandingEvidence: [{
          id: "prior-evidence-1", origin: "priorSession", learnerModelEntryId: "ledger-2",
          sourceSessionId: "same-mission-session", sourceRecordId: "evidence-2",
          inference: "uncertain about the zero-limit condition", confidence: "medium",
          sourceContext: {
            concepts: ["alternating series test"], mathematicalStructures: ["real series"],
            prerequisiteRelationships: [{
              prerequisiteConcept: "absolute value", supportsConcept: "alternating series test", relationship: "requiredFor"
            }], taskDemands: ["apply a convergence test"]
          },
          targetContext: {
            concepts: ["alternating series test"], mathematicalStructures: ["real series"],
            prerequisiteRelationships: [{
              prerequisiteConcept: "absolute value", supportsConcept: "alternating series test", relationship: "requiredFor"
            }], taskDemands: ["apply a convergence test"]
          },
          provenance: {
            workspaceId: "workspace-2", missionId: "mission-2", sessionTarget: "Check the hypotheses",
            summary: "The learner omitted the zero-limit condition.", lastUpdatedAt: "2026-07-20T00:05:00.000Z"
          }
        }],
        interactionPreferences: [{
          id: "preference-1", origin: "interactionPreference", learnerModelEntryId: "ledger-3",
          sourceSessionId: "preference-session", sourceRecordId: "preference-record-1",
          inference: "visual route supported", confidence: "medium",
          sourceContext: {
            concepts: ["alternating series test"], mathematicalStructures: ["real series"],
            prerequisiteRelationships: [{
              prerequisiteConcept: "absolute value", supportsConcept: "alternating series test", relationship: "requiredFor"
            }], taskDemands: ["apply a convergence test"]
          },
          targetContext: {
            concepts: ["alternating series test"], mathematicalStructures: ["real series"],
            prerequisiteRelationships: [{
              prerequisiteConcept: "absolute value", supportsConcept: "alternating series test", relationship: "requiredFor"
            }], taskDemands: ["apply a convergence test"]
          },
          provenance: {
            workspaceId: "workspace-3", missionId: "mission-3", sessionTarget: "Compare series visually",
            summary: "A diagram was helpful.", lastUpdatedAt: "2026-07-20T00:10:00.000Z"
          }
        }]
      },
      learningSlice: {
        roadmapTitle: "Convergence test route",
        stageTitle: "Alternating series test",
        boundary: "Check decreasing magnitude and zero limit",
        immediatePrerequisites: ["absolute values"],
        remainingStageTitles: ["Error estimate", "Application"]
      },
      ...focusedTeachingAccess(),
      onDelta: (delta) => deltas.push(delta),
      signal: new AbortController().signal
    });
    expect(deltas).toEqual([
      "First check that the term magnitudes decrease. ",
      "Then check that they tend to zero."
    ]);
    const slicedTurn = transport.messages.find((message) => message.method === "turn/start"
      && JSON.stringify(message.params).includes("Chosen Learning Slice"));
    expect(JSON.stringify(slicedTurn?.params)).toContain("Teach only the chosen Learning Slice");
    expect(JSON.stringify(slicedTurn?.params)).toContain("Future Learning Sessions, not part of this Teaching Card: Error estimate; Application");
    expect(JSON.stringify(slicedTurn?.params)).toContain("Adaptive next Teaching Move: demonstrate through a proofStructural route.");
    expect(JSON.stringify(slicedTurn?.params)).toContain("end by asking the smallest useful clarification");
    expect(JSON.stringify(slicedTurn?.params)).toContain("within 180 words");
    expect(JSON.stringify(slicedTurn?.params)).toContain("recompute every displayed example or counterexample");
    expect(JSON.stringify(slicedTurn?.params)).toContain("state every domain and index restriction");
    expect(JSON.stringify(slicedTurn?.params)).toContain("Check boundary values and the first permitted index");
    expect(JSON.stringify(slicedTurn?.params)).toContain("preserve the current Session Target");
    expect(JSON.stringify(slicedTurn?.params)).toContain("Separate each source's authority and relevance");
    expect(JSON.stringify(slicedTurn?.params)).toContain("audit its hypotheses object by object");
    expect(JSON.stringify(slicedTurn?.params)).toContain("Never transfer measurability, continuity, integrability");
    expect(JSON.stringify(slicedTurn?.params)).not.toContain("1/n in the open interval (0,1)");
    expect(JSON.stringify(slicedTurn?.params)).not.toContain("measurability of an almost-everywhere limit");
    expect(JSON.stringify(slicedTurn?.params)).toContain("Why this move: Understanding Evidence indicates a specific gap");
    expect(JSON.stringify(slicedTurn?.params)).toContain("Evidence Transfer from source-session");
    expect(JSON.stringify(slicedTurn?.params)).toContain("Prior-session Understanding Evidence from same-mission-session");
    expect(JSON.stringify(slicedTurn?.params)).toContain("Interaction Preference from preference-session");
    expect(JSON.stringify(slicedTurn?.params)).toContain("fixed learning style");

    await runtime.streamTeaching({
      sessionId: "learning-session-full",
      mathematics: "Use the local reference.",
      learningGoal: "Understand the referenced lemma",
      scope: "Read the supporting source",
      initialTeachingDirection: "Inspect the lemma statement",
      accessScope: {
        policy: "full",
        sourceIds: ["source-1"],
        allowsBroadLocalRead: true,
        allowsSourceModification: false
      },
      sourceContext: [{ sourceId: "source-1", name: "lemma.txt", mediaType: "text/plain", content: "A bounded monotone sequence converges." }],
      onAccessRequest: async () => ({ status: "denied", policy: "full" }),
      onDelta: () => undefined,
      signal: new AbortController().signal
    });
    const fullThreadStart = transport.messages.filter((message) => message.method === "thread/start").at(-1)!;
    expect(fullThreadStart).toMatchObject({
      params: {
        sandbox: "read-only",
        config: { features: { shell_tool: false, unified_exec: false } }
      }
    });
    expect(JSON.stringify(fullThreadStart.params)).toContain("supplied authorized source context");
    expect(JSON.stringify(fullThreadStart.params)).not.toContain("local inspection");
    const fullTurnStart = transport.messages.filter((message) => message.method === "turn/start").at(-1)!;
    expect(JSON.stringify(fullTurnStart.params)).toContain("A bounded monotone sequence converges.");

    await runtime.streamTeaching({
      sessionId: "learning-session-full-anchor",
      mathematics: "bounded monotone sequence",
      learningGoal: "Understand the selected claim",
      scope: "Explain one Source Anchor",
      initialTeachingDirection: "Use only the supplied source",
      accessScope: {
        policy: "full",
        sourceIds: ["source-1"],
        allowsBroadLocalRead: true,
        allowsSourceModification: false
      },
      sourceContext: [{ sourceId: "source-1", name: "lemma.txt", mediaType: "text/plain", content: "A bounded monotone sequence converges." }],
      focus: {
        kind: "sourceAnchor",
        sourceAnchorId: "anchor-1",
        sourceId: "source-1",
        selection: { kind: "text", startOffset: 2, endOffset: 27, exactText: "bounded monotone sequence", prefix: "A ", suffix: " converges." },
        instruction: "Explain this anchor.",
        previousContent: null,
        variantName: null
      },
      onAccessRequest: async () => ({ status: "denied", policy: "full" }),
      onDelta: () => undefined,
      signal: new AbortController().signal
    });
    expect(transport.messages.filter((message) => message.method === "thread/start").at(-1)).toMatchObject({
      params: {
        dynamicTools: [],
        config: { features: { shell_tool: false, unified_exec: false } }
      }
    });

    await runtime.streamTeaching({
      sessionId: "learning-session-full-question",
      mathematics: "Where is monotonicity used?",
      learningGoal: "Understand the selected claim",
      scope: "Inspect one inference",
      initialTeachingDirection: "Use the learner-approved context",
      accessScope: {
        policy: "full",
        sourceIds: ["source-1"],
        allowsBroadLocalRead: true,
        allowsSourceModification: false
      },
      sourceContext: [{ sourceId: "source-1", name: "lemma.txt", mediaType: "text/plain", content: "bounded monotone sequence" }],
      tutorFeedback: [{
        annotationId: "feedback-1",
        sourceAnchorId: "anchor-1",
        content: "Use the learner's preferred sequence notation."
      }],
      questionContext: [{
        id: "source-anchor:anchor-1",
        kind: "sourceAnchor",
        typeLabel: "Source Anchor",
        identity: "bounded monotone sequence",
        location: "Text at characters 2–27",
        preview: "bounded monotone sequence",
        sourceId: "source-1",
        sourceAnchorId: "anchor-1"
      }],
      onAccessRequest: async () => ({ status: "denied", policy: "full" }),
      onDelta: () => undefined,
      signal: new AbortController().signal
    });
    expect(JSON.stringify(transport.messages.filter((message) => message.method === "turn/start").at(-1)?.params))
      .toContain("Tutor Feedback available to guide this Teaching Move");
    expect(JSON.stringify(transport.messages.filter((message) => message.method === "turn/start").at(-1)?.params))
      .toContain("Use the learner's preferred sequence notation.");
    expect(transport.messages.filter((message) => message.method === "thread/start").at(-1)).toMatchObject({
      params: {
        dynamicTools: [],
        config: { features: { shell_tool: false, unified_exec: false } }
      }
    });
    const questionTurnStart = transport.messages.filter((message) => message.method === "turn/start").at(-1)!;
    expect(JSON.stringify(questionTurnStart.params)).toContain("Learner-approved Ask Bar context");
    expect(JSON.stringify(questionTurnStart.params)).toContain("Text at characters 2–27");
    expect(JSON.stringify(questionTurnStart.params)).not.toContain("Learning Goal:");
  });

  it("uses Personal Notes only in the bounded artifact-synthesis request and returns linked interpretations", async () => {
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1",
          codexHome: "/tmp/codex-home",
          platformFamily: "unix",
          platformOs: "macos"
        });
      }
      if (message.method === "thread/start") {
        transport.respond(message.id, { thread: { id: "artifact-thread" } });
      }
      if (message.method === "turn/start") {
        const params = message.params as { threadId: string };
        transport.respond(message.id, { turn: { id: "artifact-turn" } });
        transport.notify("item/agentMessage/delta", {
          threadId: params.threadId,
          turnId: "artifact-turn",
          itemId: "artifact-synthesis",
          delta: JSON.stringify({
            content: "A coherent compactness argument using the learner's finite-choice picture.",
            noteInterpretations: [{
              annotationId: "annotation-1",
              interpretation: "Compactness reduces the local choices to a finite family."
            }]
          })
        });
        transport.notify("turn/completed", {
          threadId: params.threadId,
          turn: { id: "artifact-turn", status: "completed", error: null }
        });
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");
    const original = "  My exact finite-choice picture.\n";

    await expect(runtime.synthesizeArtifact({
      sessionId: "session-1",
      learningGoal: "Understand compactness",
      artifactTitle: "Compactness proof",
      artifactContent: "Use a finite subcover.",
      personalNotes: [{ annotationId: "annotation-1", sourceAnchorId: "anchor-1", content: original }],
      signal: new AbortController().signal
    })).resolves.toEqual({
      content: "A coherent compactness argument using the learner's finite-choice picture.",
      noteInterpretations: [{
        annotationId: "annotation-1",
        interpretation: "Compactness reduces the local choices to a finite family."
      }]
    });

    const synthesisTurn = transport.messages.find((message) => message.method === "turn/start")!;
    expect(synthesisTurn).toMatchObject({
      params: {
        outputSchema: {
          required: ["content", "noteInterpretations"],
          properties: { noteInterpretations: expect.any(Object) }
        }
      }
    });
    expect(JSON.stringify(synthesisTurn.params)).toContain(original.trim());
    expect(JSON.stringify(synthesisTurn.params)).toContain("authorized only for this artifact synthesis");
  });

  it("requests a bounded section-regeneration proposal with protected content and exact claim edits", async () => {
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "thread/start") transport.respond(message.id, { thread: { id: "regeneration-thread" } });
      if (message.method === "turn/start") {
        const params = message.params as { threadId: string };
        transport.respond(message.id, { turn: { id: "regeneration-turn" } });
        transport.notify("item/agentMessage/delta", {
          threadId: params.threadId, turnId: "regeneration-turn", itemId: "regeneration-proposal",
          delta: JSON.stringify({
            replacementContent: "Use the selected finite subcover while retaining $x \\in K$.",
            claimEdits: [{ claimId: "claim-1", statement: "Use the selected finite subcover." }],
            claimImpacts: [{ claimId: "claim-1", effect: "changed", changedAspects: ["text", "dependencies"] }],
            unresolvedRepairs: [{ kind: "citation", description: "Confirm the source page." }]
          })
        });
        transport.notify("turn/completed", {
          threadId: params.threadId, turn: { id: "regeneration-turn", status: "completed", error: null }
        });
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");
    await expect(runtime.regenerateArtifact({
      sessionId: "session-1", learningGoal: "Understand compactness", artifactTitle: "Compactness proof",
      artifactContent: "Use a finite subcover while retaining $x \\in K$.", scope: "section",
      selectedContent: "Use a finite subcover", instruction: "Name the selected cover.",
      protectedContent: [{ kind: "learnerProtected", content: "$x \\in K$" }],
      claims: [{ claimId: "claim-1", statement: "Use a finite subcover." }],
      signal: new AbortController().signal
    })).resolves.toEqual({
      replacementContent: "Use the selected finite subcover while retaining $x \\in K$.",
      claimEdits: [{ claimId: "claim-1", statement: "Use the selected finite subcover." }],
      claimImpacts: [{ claimId: "claim-1", effect: "changed", changedAspects: ["text", "dependencies"] }],
      unresolvedRepairs: [{ kind: "citation", description: "Confirm the source page." }]
    });
    const turn = transport.messages.find((message) => message.method === "turn/start")!;
    expect(turn).toMatchObject({ params: { outputSchema: {
      required: ["replacementContent", "claimEdits", "claimImpacts", "unresolvedRepairs"]
    } } });
    expect(JSON.stringify(turn.params)).toContain("learnerProtected");
    expect(JSON.stringify(turn.params)).toContain("Name the selected cover.");
  });

  it("requests a bounded reasoning recheck for one exact regenerated claim", async () => {
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "thread/start") transport.respond(message.id, { thread: { id: "recheck-thread" } });
      if (message.method === "turn/start") {
        const params = message.params as { threadId: string };
        transport.respond(message.id, { turn: { id: "recheck-turn" } });
        transport.notify("item/agentMessage/delta", {
          threadId: params.threadId, turnId: "recheck-turn", itemId: "recheck-result",
          delta: JSON.stringify({ outcome: "supports", summary: "The exact claim follows from its stated assumptions." })
        });
        transport.notify("turn/completed", {
          threadId: params.threadId, turn: { id: "recheck-turn", status: "completed", error: null }
        });
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");
    await expect(runtime.recheckArtifactClaim({
      sessionId: "session-1", learningGoal: "Understand compactness", artifactTitle: "Compactness proof",
      exactClaim: "Compactness gives a finite subcover.",
      priorEvidence: [{ method: "reasoningReview", outcome: "supports", summary: "Prior pass.", changedBecause: "Text changed." }],
      signal: new AbortController().signal
    })).resolves.toEqual({ outcome: "supports", summary: "The exact claim follows from its stated assumptions." });
    const turn = transport.messages.find((message) => message.method === "turn/start")!;
    expect(turn).toMatchObject({ params: { outputSchema: { required: ["outcome", "summary"] } } });
    expect(JSON.stringify(turn.params)).toContain("Compactness gives a finite subcover.");
    expect(JSON.stringify(turn.params)).toContain("Do not claim source grounding");
  });

  it("generates, clarifies, and assesses a delayed task through bounded structured turns", async () => {
    let turnNumber = 0;
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "thread/start") {
        transport.respond(message.id, { thread: { id: `delayed-thread-${turnNumber + 1}` } });
      }
      if (message.method === "turn/start") {
        turnNumber += 1;
        const params = message.params as { threadId: string; input: Array<{ text: string }>; outputSchema?: unknown };
        const turnId = `delayed-turn-${turnNumber}`;
        transport.respond(message.id, { turn: { id: turnId } });
        const prompt = params.input[0].text;
        const delta = prompt.includes("Create one unseen Delayed Transfer Check task")
          ? JSON.stringify({
              prompt: "A compact parameter space has local bounds. Explain how to obtain one uniform bound.",
              concept: "finite subcover",
              taskDemand: "transfer a local-to-finite-global argument",
              structuralComparison: "The objects change while the compactness reduction remains.",
              mathematicalContext: {
                concepts: ["finite subcover"], mathematicalStructures: ["compact parameter space with local bounds"],
                prerequisiteRelationships: [{
                  prerequisiteConcept: "open cover", supportsConcept: "finite subcover", relationship: "requiredFor"
                }], taskDemands: ["transfer a local-to-finite-global argument"]
              }
            })
          : prompt.includes("Answer one clarification")
            ? "Use the parameter neighbourhoods on which each local estimate holds."
            : JSON.stringify({
                result: "partial", reasoningQuality: "developing", confidenceCalibration: "aligned",
                misconceptionOrStrength: "The finite maximum still needs justification.",
                recommendedNextAction: "Explain why the maximum controls every parameter.",
                refresherGoal: "Connect the finite subcover to the uniform maximum."
              });
        transport.notify("item/agentMessage/delta", {
          threadId: params.threadId, turnId, itemId: `delayed-item-${turnNumber}`, delta
        });
        transport.notify("turn/completed", {
          threadId: params.threadId, turn: { id: turnId, status: "completed", error: null }
        });
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");
    const signal = new AbortController().signal;
    const task = await runtime.createDelayedTransferTask({
      checkId: "check-1", originatingSessionId: "session-1",
      originatingLearningGoal: "Understand compactness", originatingSessionTarget: "Explain the finite-subcover step",
      originatingConcepts: ["finite subcover"], intendedTransferGoal: "Apply compactness in a new proof.",
      originatingMathematics: "Show that a compact subset of a Hausdorff space is closed.", signal
    });
    expect(task).toMatchObject({ concept: "finite subcover", taskDemand: expect.stringContaining("local-to-finite") });
    await expect(runtime.clarifyDelayedTransferTask({
      checkId: "check-1", task, question: "Which sets form the cover?", signal
    })).resolves.toContain("parameter neighbourhoods");
    await expect(runtime.assessDelayedTransferWork({
      checkId: "check-1", task, work: "Take a finite subcover and a maximum.",
      reasoning: "Compactness makes the family finite.", confidence: "medium",
      clarifications: [{ question: "Which sets form the cover?", response: "Use the parameter neighbourhoods." }], signal
    })).resolves.toMatchObject({
      result: "partial", reasoningQuality: "developing", confidenceCalibration: "aligned",
      refresherGoal: "Connect the finite subcover to the uniform maximum."
    });
    const turns = transport.messages.filter((message) => message.method === "turn/start");
    expect(turns).toHaveLength(3);
    expect(turns[0]).toMatchObject({ params: { outputSchema: { required: ["prompt", "concept", "taskDemand", "structuralComparison", "mathematicalContext"] } } });
    expect(turns[1].params).not.toHaveProperty("outputSchema");
    expect(turns[2]).toMatchObject({ params: { outputSchema: { properties: { refresherGoal: { type: ["string", "null"] } } } } });
    expect(JSON.stringify(turns[0])).toContain("Do not repeat, quote, or lightly rename");
    expect(JSON.stringify(turns[2])).toContain("Do not assign a grade, global mastery, or failure label");
  });

  it("interrupts delayed task preparation when its abort signal fires", async () => {
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "thread/start") transport.respond(message.id, { thread: { id: "delayed-abort-thread" } });
      if (message.method === "turn/start") transport.respond(message.id, { turn: { id: "delayed-abort-turn" } });
      if (message.method === "turn/interrupt") {
        transport.respond(message.id, {});
        queueMicrotask(() => transport.notify("turn/completed", {
          threadId: "delayed-abort-thread",
          turn: { id: "delayed-abort-turn", status: "interrupted", error: null }
        }));
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");
    const controller = new AbortController();
    const task = runtime.createDelayedTransferTask({
      checkId: "check-abort", originatingSessionId: "session-1",
      originatingLearningGoal: "Understand compactness", originatingSessionTarget: "Explain the finite-subcover step",
      originatingConcepts: ["finite subcover"], intendedTransferGoal: "Apply compactness in a new proof.",
      originatingMathematics: "Show that a compact subset of a Hausdorff space is closed.", signal: controller.signal
    });
    await transport.waitForMessage("turn/start");
    await new Promise((resolve) => setTimeout(resolve, 0));

    controller.abort();

    await expect(task).rejects.toThrow("interrupted");
    expect(transport.messages.find((message) => message.method === "turn/interrupt")).toMatchObject({
      params: { threadId: "delayed-abort-thread", turnId: "delayed-abort-turn" }
    });
  });

  it("runs one Specialist Agent with only its checkpoint tool and the supplied Agent Brief", async () => {
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "thread/start") transport.respond(message.id, { thread: { id: "specialist-thread" } });
      if (message.method === "turn/start") {
        transport.respond(message.id, { turn: { id: "specialist-turn" } });
        queueMicrotask(() => {
          transport.notify("item/agentMessage/delta", {
            threadId: "specialist-thread", turnId: "specialist-turn", itemId: "specialist-result",
            delta: JSON.stringify({
              title: "Specialist review · separation assumption",
              content: "The step depends on Hausdorff separation."
            })
          });
          transport.notify("turn/completed", {
            threadId: "specialist-thread", turn: { id: "specialist-turn", status: "completed", error: null }
          });
        });
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");
    const events: string[] = [];
    const statuses: string[] = [];

    await expect(runtime.runSpecialistAgent({
      sessionId: "session-1",
      purpose: "Review one hidden assumption",
      brief: {
        learningGoal: "Understand compactness",
        sourceAnchors: [],
        constraints: ["Review only the current Teaching Card."],
        learnerEvidence: ["Choose disjoint neighbourhoods."],
        expectedOutput: "One concise integrated Teaching Card.",
        verificationNeeds: ["Identify hidden assumptions."]
      },
      budget: {
        agentCount: 1, concurrency: 1, model: "codex-deep", reasoningEffort: "high",
        tools: ["checkpointSpecialistResult"], maxTokens: 512, maxLatencyMs: 120_000
      },
      signal: new AbortController().signal,
      onStatus: (status) => statuses.push(status),
      onPartialResult: () => undefined,
      onRuntimeEvent: (event) => events.push(`${event.workKind}:${event.type}`)
    })).resolves.toEqual({
      title: "Specialist review · separation assumption",
      content: "The step depends on Hausdorff separation."
    });

    const threadStart = transport.messages.find((message) => message.method === "thread/start")!;
    expect(threadStart).toMatchObject({
      params: {
        sandbox: "read-only",
        model: "codex-deep",
        dynamicTools: [expect.objectContaining({ name: "checkpoint_specialist_result" })],
        config: { features: { apps: false, multi_agent: false, shell_tool: false, unified_exec: false } }
      }
    });
    expect(JSON.stringify(threadStart.params)).toContain("Use only the supplied Agent Brief");
    const turnStart = transport.messages.find((message) => message.method === "turn/start")!;
    expect(turnStart).toMatchObject({ params: { effort: "high" } });
    expect(JSON.stringify(turnStart.params)).toContain("Choose disjoint neighbourhoods.");
    expect(JSON.stringify(turnStart.params)).toContain("512-output-token limit");
    expect(JSON.stringify(turnStart.params)).toContain("not charged against this output budget");
    expect(JSON.stringify(turnStart.params)).not.toContain("total task token use");
    expect(JSON.stringify(turnStart.params)).not.toContain("/workspace");
    expect(events).toContain("specialist:turnCompleted");
    expect(statuses).toEqual(["waiting", "working"]);
  });

  it("checkpoints a valid structured Specialist Agent result before a later turn failure", async () => {
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "thread/start") transport.respond(message.id, { thread: { id: "partial-thread" } });
      if (message.method === "turn/start") {
        transport.respond(message.id, { turn: { id: "partial-turn" } });
        transport.request(701, "item/tool/call", {
          threadId: "partial-thread", turnId: "partial-turn", callId: "partial-checkpoint",
          namespace: null, tool: "checkpoint_specialist_result",
          arguments: { title: "Partial review", content: "The step needs separation." }
        });
      }
      if (message.id === 701 && message.result) {
        transport.request(702, "item/tool/call", {
          threadId: "partial-thread", turnId: "partial-turn", callId: "cumulative-checkpoint",
          namespace: null, tool: "checkpoint_specialist_result",
          arguments: {
            title: "Partial review",
            content: "The step needs separation. Hausdorff separation is sufficient."
          }
        });
      }
      if (message.id === 702 && message.result) {
        queueMicrotask(() => {
          transport.notify("turn/completed", {
            threadId: "partial-thread",
            turn: { id: "partial-turn", status: "failed", error: { message: "transport closed after output" } }
          });
        });
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");
    const partials: string[] = [];
    const request = runtime.runSpecialistAgent({
      sessionId: "session-1",
      purpose: "Review one hidden assumption",
      brief: {
        learningGoal: "Understand compactness", sourceAnchors: [],
        constraints: ["Current Teaching Card: choose disjoint neighbourhoods."], learnerEvidence: [],
        expectedOutput: "One concise integrated Teaching Card.", verificationNeeds: ["Identify hidden assumptions."]
      },
      budget: {
        agentCount: 1, concurrency: 1, model: "runtimeDefault", reasoningEffort: "medium",
        tools: ["checkpointSpecialistResult"], maxTokens: 512, maxLatencyMs: 120_000
      },
      signal: new AbortController().signal,
      onStatus: () => undefined,
      onPartialResult: (content) => partials.push(content)
    });

    await expect(request).rejects.toThrow("Codex could not complete this request");
    expect(partials).toEqual([
      "The step needs separation.",
      "The step needs separation. Hausdorff separation is sufficient."
    ]);
  });

  it("does not charge a Specialist Agent's large input context against its output-token budget", async () => {
    const reportedTokenUsage: number[] = [];
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "thread/start") transport.respond(message.id, { thread: { id: "input-budget-thread" } });
      if (message.method === "turn/start") {
        transport.respond(message.id, { turn: { id: "input-budget-turn" } });
        queueMicrotask(() => {
          transport.notify("thread/tokenUsage/updated", {
            threadId: "input-budget-thread", turnId: "input-budget-turn",
            tokenUsage: {
              total: { inputTokens: 29_700, cachedInputTokens: 0, outputTokens: 120, reasoningOutputTokens: 180, totalTokens: 30_000 },
              last: { inputTokens: 29_700, cachedInputTokens: 0, outputTokens: 120, reasoningOutputTokens: 180, totalTokens: 30_000 },
              modelContextWindow: 100_000
            }
          });
          transport.notify("item/agentMessage/delta", {
            threadId: "input-budget-thread", turnId: "input-budget-turn", itemId: "input-budget-result",
            delta: JSON.stringify({ title: "Bounded review", content: "The proof must distinguish the two topologies." })
          });
          transport.notify("turn/completed", {
            threadId: "input-budget-thread",
            turn: { id: "input-budget-turn", status: "completed", error: null }
          });
        });
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");

    await expect(runtime.runSpecialistAgent({
      sessionId: "session-1", purpose: "Review one hidden assumption",
      brief: {
        learningGoal: "Understand compactness", sourceAnchors: [], constraints: ["Review one card."],
        learnerEvidence: [], expectedOutput: "One concise card.", verificationNeeds: ["Identify assumptions."]
      },
      budget: {
        agentCount: 1, concurrency: 1, model: "runtimeDefault", reasoningEffort: "medium",
        tools: ["checkpointSpecialistResult"], maxTokens: 512, maxLatencyMs: 120_000
      },
      signal: new AbortController().signal, onStatus: () => undefined, onPartialResult: () => undefined,
      onTokenUsage: (outputTokens) => reportedTokenUsage.push(outputTokens)
    })).resolves.toMatchObject({ content: "The proof must distinguish the two topologies." });
    expect(reportedTokenUsage).toEqual([120]);
    expect(transport.messages).not.toContainEqual(expect.objectContaining({ method: "turn/interrupt" }));
  });

  it("interrupts Specialist Agent work when Codex reports output token use beyond its limit", async () => {
    const reportedTokenUsage: number[] = [];
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "thread/start") transport.respond(message.id, { thread: { id: "budget-thread" } });
      if (message.method === "turn/start") {
        transport.respond(message.id, { turn: { id: "budget-turn" } });
        queueMicrotask(() => transport.notify("thread/tokenUsage/updated", {
          threadId: "budget-thread", turnId: "budget-turn",
          tokenUsage: {
            total: { inputTokens: 29_300, cachedInputTokens: 0, outputTokens: 513, reasoningOutputTokens: 187, totalTokens: 30_000 },
            last: { inputTokens: 29_300, cachedInputTokens: 0, outputTokens: 513, reasoningOutputTokens: 187, totalTokens: 30_000 },
            modelContextWindow: 100_000
          }
        }));
      }
      if (message.method === "turn/interrupt") transport.respond(message.id, {});
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");

    await expect(runtime.runSpecialistAgent({
      sessionId: "session-1", purpose: "Review one hidden assumption",
      brief: {
        learningGoal: "Understand compactness", sourceAnchors: [], constraints: ["Review one card."],
        learnerEvidence: [], expectedOutput: "One concise card.", verificationNeeds: ["Identify assumptions."]
      },
      budget: {
        agentCount: 1, concurrency: 1, model: "runtimeDefault", reasoningEffort: "medium",
        tools: ["checkpointSpecialistResult"], maxTokens: 512, maxLatencyMs: 120_000
      },
      signal: new AbortController().signal, onStatus: () => undefined, onPartialResult: () => undefined,
      onTokenUsage: (outputTokens) => reportedTokenUsage.push(outputTokens)
    })).rejects.toThrow("exceeded its token budget");
    expect(reportedTokenUsage).toEqual([513]);
    expect(transport.messages).toContainEqual(expect.objectContaining({
      method: "turn/interrupt", params: { threadId: "budget-thread", turnId: "budget-turn" }
    }));
  });

  it("interrupts every concurrent Specialist Agent turn owned by one Learning Session", async () => {
    let nextThread = 0;
    let nextTurn = 0;
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "thread/start") {
        nextThread += 1;
        const id = `parallel-thread-${nextThread}`;
        transport.respond(message.id, { thread: { id } });
      }
      if (message.method === "turn/start") {
        nextTurn += 1;
        transport.respond(message.id, { turn: { id: `parallel-turn-${nextTurn}` } });
      }
      if (message.method === "turn/interrupt") {
        transport.respond(message.id, {});
        const params = message.params as { threadId: string; turnId: string };
        queueMicrotask(() => transport.notify("turn/completed", {
          threadId: params.threadId,
          turn: { id: params.turnId, status: "interrupted", error: null }
        }));
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");
    const specialistRequest = () => runtime.runSpecialistAgent({
      sessionId: "parallel-session", purpose: "Independent bounded review",
      brief: {
        learningGoal: "Check the proof", sourceAnchors: [], constraints: ["Review independently."],
        learnerEvidence: [], expectedOutput: "One concise card.", verificationNeeds: ["Identify assumptions."]
      },
      budget: {
        agentCount: 2, concurrency: 2, model: "runtimeDefault", reasoningEffort: "medium",
        tools: ["checkpointSpecialistResult"], maxTokens: 512, maxLatencyMs: 120_000
      },
      signal: new AbortController().signal, onStatus: () => undefined, onPartialResult: () => undefined
    });
    const reviews = Promise.allSettled([specialistRequest(), specialistRequest()]);
    await vi.waitFor(() => expect(transport.messages.filter((message) => message.method === "turn/start")).toHaveLength(2));

    await runtime.cancelTeaching("parallel-session");
    await reviews;

    expect(transport.messages.filter((message) => message.method === "turn/interrupt").map((message) => message.params))
      .toEqual(expect.arrayContaining([
        { threadId: "parallel-thread-1", turnId: "parallel-turn-1" },
        { threadId: "parallel-thread-2", turnId: "parallel-turn-2" }
      ]));
  });

  it("interrupts a concurrent Specialist Agent that finishes starting after cancellation begins", async () => {
    let nextThread = 0;
    let handledTurnStarts = 0;
    let delayedTurnRequestId: number | null = null;
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "thread/start") {
        nextThread += 1;
        transport.respond(message.id, { thread: { id: `startup-thread-${nextThread}` } });
      }
      if (message.method === "turn/start") {
        handledTurnStarts += 1;
        if (handledTurnStarts === 1) transport.respond(message.id, { turn: { id: "startup-turn-1" } });
        else delayedTurnRequestId = message.id;
      }
      if (message.method === "turn/interrupt") {
        transport.respond(message.id, {});
        const params = message.params as { threadId: string; turnId: string };
        queueMicrotask(() => transport.notify("turn/completed", {
          threadId: params.threadId,
          turn: { id: params.turnId, status: "interrupted", error: null }
        }));
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");
    const controller = new AbortController();
    const startedTurnIds: string[] = [];
    const specialistRequest = () => runtime.runSpecialistAgent({
      sessionId: "startup-session", purpose: "Independent bounded review",
      brief: {
        learningGoal: "Check the proof", sourceAnchors: [], constraints: ["Review independently."],
        learnerEvidence: [], expectedOutput: "One concise card.", verificationNeeds: ["Identify assumptions."]
      },
      budget: {
        agentCount: 2, concurrency: 2, model: "runtimeDefault", reasoningEffort: "medium",
        tools: ["checkpointSpecialistResult"], maxTokens: 512, maxLatencyMs: 120_000
      },
      signal: controller.signal, onStatus: () => undefined, onPartialResult: () => undefined,
      onRuntimeEvent: (event) => {
        if (event.type === "turnStarted" && event.turnId) startedTurnIds.push(event.turnId);
      }
    });
    const reviews = Promise.allSettled([specialistRequest(), specialistRequest()]);
    await vi.waitFor(() => {
      expect(delayedTurnRequestId).not.toBeNull();
      expect(startedTurnIds).toContain("startup-turn-1");
    });

    controller.abort();
    const cancellation = runtime.cancelTeaching("startup-session");
    transport.respond(delayedTurnRequestId!, { turn: { id: "startup-turn-2" } });
    await cancellation;
    await reviews;

    expect(transport.messages.filter((message) => message.method === "turn/interrupt").map((message) => message.params))
      .toEqual(expect.arrayContaining([
        { threadId: "startup-thread-1", turnId: "startup-turn-1" },
        { threadId: "startup-thread-2", turnId: "startup-turn-2" }
      ]));
  });

  it("interrupts active teaching and shuts down the stdio transport", async () => {
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1",
          codexHome: "/tmp/codex-home",
          platformFamily: "unix",
          platformOs: "macos"
        });
      }
      if (message.method === "thread/start") {
        transport.respond(message.id, { thread: { id: "thread-cancel" } });
      }
      if (message.method === "turn/start") {
        transport.respond(message.id, { turn: { id: "turn-cancel" } });
      }
      if (message.method === "turn/interrupt") {
        transport.respond(message.id, {});
        queueMicrotask(() => transport.notify("turn/completed", {
          threadId: "thread-cancel",
          turn: { id: "turn-cancel", status: "interrupted", error: null }
        }));
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");
    const teaching = runtime.streamTeaching({
      sessionId: "learning-session-cancel",
      mathematics: "Explain the diagonal argument.",
      learningGoal: "Understand diagonalization",
      scope: "Construct the differing sequence",
      initialTeachingDirection: "Assume an enumeration",
      ...focusedTeachingAccess(),
      onDelta: () => undefined,
      signal: new AbortController().signal
    });
    await transport.waitForMessage("turn/start");

    await runtime.cancelTeaching("learning-session-cancel");
    await expect(teaching).rejects.toThrow("interrupted");
    expect(transport.messages.find((message) => message.method === "turn/interrupt")).toMatchObject({
      params: { threadId: "thread-cancel", turnId: "turn-cancel" }
    });

    await runtime.shutdown();
    expect(transport.closed).toBe(true);
  });

  it("does not resolve runtime shutdown until the transport process has exited", async () => {
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => { releaseClose = resolve; });
    const transport = new ScriptedTransport((message) => {
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1",
          codexHome: "/tmp/codex-home",
          platformFamily: "unix",
          platformOs: "macos"
        });
      }
    });
    transport.closeGate = closeGate;
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");

    let settled = false;
    const shutdown = runtime.shutdown().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(transport.closed).toBe(false);

    releaseClose();
    await shutdown;
    expect(transport.closed).toBe(true);
  });

  it("does not mistake a child-process error for process exit", async () => {
    const exitProof = new ChildProcessExitProof();

    let settled = false;
    const closing = exitProof.settled.then(() => { settled = true; });
    exitProof.recordError(new Error("SIGTERM could not be delivered"));
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(exitProof.error?.message).toBe("SIGTERM could not be delivered");

    exitProof.recordClose();
    await closing;
    expect(settled).toBe(true);
  });

  it("turns protocol and malformed-output failures into useful errors", async () => {
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1",
          codexHome: "/tmp/codex-home",
          platformFamily: "unix",
          platformOs: "macos"
        });
      }
      if (message.method === "account/read") {
        transport.reject(message.id, -32000, "Authentication unavailable");
      }
      if (message.method === "thread/start") {
        transport.respond(message.id, { thread: { id: "thread-malformed" } });
      }
      if (message.method === "turn/start") {
        transport.respond(message.id, { turn: { id: "turn-malformed" } });
        queueMicrotask(() => {
          transport.notify("item/agentMessage/delta", {
            threadId: "thread-malformed",
            turnId: "turn-malformed",
            itemId: "proposal",
            delta: "not valid proposal JSON"
          });
          transport.notify("turn/completed", {
            threadId: "thread-malformed",
            turn: { id: "turn-malformed", status: "completed", error: null }
          });
        });
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");

    await expect(runtime.getAuthentication()).rejects.toThrow(
      "Codex authentication is unavailable. Sign in and retry."
    );
    await expect(runtime.proposeSession("Ambiguous input")).rejects.toThrow(
      "Codex returned a malformed Session Proposal. Retry"
    );
  });

  it("rejects invalid roadmap dependencies at the Model Runtime boundary", async () => {
    const transport = new ScriptedTransport((message) => {
      if (!("id" in message)) return;
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home",
          platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "thread/start") transport.respond(message.id, { thread: { id: "thread-roadmap" } });
      if (message.method === "turn/start") {
        transport.respond(message.id, { turn: { id: "turn-roadmap" } });
        queueMicrotask(() => {
          transport.notify("item/agentMessage/delta", {
            threadId: "thread-roadmap", turnId: "turn-roadmap", itemId: "proposal",
            delta: JSON.stringify({
              learningGoal: "Study a proof", scope: "Study stage one", initialTeachingDirection: "Begin",
              requiresConfirmation: false, confirmationReason: null, materialScope: "longOrMultiStage",
              argumentRoadmap: {
                title: "Invalid dependencies", proposedStage: 0,
                stages: [
                  {
                    title: "First", majorClaim: "First claim", dependsOn: [1], sourceExcerpt: "First.",
                    learningGoal: "Study first", boundary: "First only", immediatePrerequisites: []
                  },
                  {
                    title: "Second", majorClaim: "Second claim", dependsOn: [0], sourceExcerpt: "Second.",
                    learningGoal: "Study second", boundary: "Second only", immediatePrerequisites: []
                  }
                ]
              }
            })
          });
          transport.notify("turn/completed", {
            threadId: "thread-roadmap", turn: { id: "turn-roadmap", status: "completed", error: null }
          });
        });
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");

    await expect(runtime.proposeSession("First.\nSecond.")).rejects.toThrow(
      "Codex returned a malformed Session Proposal. Retry"
    );
  });

  it("fails active turns on timeout or transport loss instead of leaving a streaming hang", async () => {
    const createHangingTransport = () => {
      let created!: ScriptedTransport;
      created = new ScriptedTransport((message) => {
        if (!("id" in message)) return;
        if (message.method === "initialize") {
          created.respond(message.id, {
            userAgent: "codex-cli/0.144.1",
            codexHome: "/tmp/codex-home",
            platformFamily: "unix",
            platformOs: "macos"
          });
        }
        if (message.method === "thread/start") created.respond(message.id, { thread: { id: "thread-hang" } });
        if (message.method === "turn/start") created.respond(message.id, { turn: { id: "turn-hang" } });
        if (message.method === "turn/interrupt") created.respond(message.id, {});
      });
      return created;
    };

    const timeoutTransport = createHangingTransport();
    const timeoutRuntime = await CodexAppServerRuntime.connect(timeoutTransport, "/workspace", { turnTimeoutMs: 20 });
    await expect(timeoutRuntime.proposeSession("Never completes")).rejects.toThrow("timed out");

    const failedTransport = createHangingTransport();
    const failedRuntime = await CodexAppServerRuntime.connect(failedTransport, "/workspace", { turnTimeoutMs: 1_000 });
    const teaching = failedRuntime.streamTeaching({
      sessionId: "transport-failure",
      mathematics: "Explain this.",
      learningGoal: "Understand this",
      scope: "One claim",
      initialTeachingDirection: "Start",
      ...focusedTeachingAccess(),
      onDelta: () => undefined,
      signal: new AbortController().signal
    });
    await failedTransport.waitForMessage("turn/start");
    failedTransport.fail(new Error("stdio closed unexpectedly"));
    await expect(teaching).rejects.toThrow("Codex runtime became unavailable");
    await expect(failedRuntime.proposeSession("Try again while idle")).rejects.toThrow(
      "Codex runtime became unavailable. Restart Codex and retry."
    );
  });

  it.each([
    ["Network connection is unavailable.", "Network connection is unavailable."],
    ["ChatGPT subscription capacity is unavailable.", "ChatGPT subscription capacity is unavailable."],
    ["API quota exhausted", "Codex usage is currently unavailable. Check your plan or API usage, then retry."]
  ])("preserves supported access failures from account reads: %s", async (protocolMessage, expected) => {
    const transport = new ScriptedTransport((message) => {
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1",
          codexHome: "/tmp/codex-home",
          platformFamily: "unix",
          platformOs: "macos"
        });
      }
      if (message.method === "account/read") transport.reject(message.id, -32000, protocolMessage);
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");

    await expect(runtime.getAuthentication()).rejects.toThrow(expected);
  });

  it("rejects an incompatible initialize response before sending initialized", async () => {
    const transport = new ScriptedTransport((message) => {
      if (message.method === "initialize") transport.respond(message.id, { userAgent: "unknown" });
    });
    await expect(CodexAppServerRuntime.connect(transport, "/workspace")).rejects.toThrow("incompatible initialize response");
    expect(transport.messages.some((message) => message.method === "initialized")).toBe(false);
  });

  it("denies app-server approval requests under Focused Access", async () => {
    const transport = new ScriptedTransport((message) => {
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1",
          codexHome: "/tmp/codex-home",
          platformFamily: "unix",
          platformOs: "macos"
        });
      }
    });
    await CodexAppServerRuntime.connect(transport, "/workspace");

    transport.request(900, "item/commandExecution/requestApproval", {});
    transport.request(901, "item/fileChange/requestApproval", {});
    transport.request(902, "execCommandApproval", {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transport.messages).toContainEqual({ id: 900, result: { decision: "decline" } });
    expect(transport.messages).toContainEqual({ id: 901, result: { decision: "decline" } });
    expect(transport.messages).toContainEqual({ id: 902, result: { decision: "denied" } });
  });

  it.each(["item/tool/callUnexpected", "item/tool/call\uFF0Foverride", "toString"])(
    "rejects an unsupported server request method without dynamic dispatch: %s",
    async (method) => {
      const transport = new ScriptedTransport((message) => {
        if (message.method === "initialize") {
          transport.respond(message.id, {
            userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
          });
        }
      });
      await CodexAppServerRuntime.connect(transport, "/workspace");

      transport.request(903, method, { tool: "request_session_access" });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(transport.messages).toContainEqual({
        id: 903,
        error: { code: -32601, message: "Focused Access does not permit server-initiated requests." }
      });
    }
  );

  it.each(["unexpected_tool", "request_session_access\u0000", "checkpoint_specialist_resu\u0131t"])(
    "rejects an unsupported dynamic tool key: %s",
    async (tool) => {
      const transport = new ScriptedTransport((message) => {
        if (message.method === "initialize") {
          transport.respond(message.id, {
            userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
          });
        }
      });
      await CodexAppServerRuntime.connect(transport, "/workspace");

      transport.request(904, "item/tool/call", { tool, turnId: "turn-1", arguments: {} });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(transport.messages).toContainEqual({
        id: 904,
        result: {
          success: false,
          contentItems: [{ type: "inputText", text: "Codex requested an unsupported dynamic tool." }]
        }
      });
    }
  );

  it("rejects an exact access tool that the originating bounded turn did not advertise", async () => {
    const onAccessRequest = vi.fn(async () => ({ status: "denied" as const, policy: "focused" as const }));
    const transport = new ScriptedTransport((message) => {
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "thread/start") transport.respond(message.id, { thread: { id: "thread-bounded" } });
      if (message.method === "turn/start") {
        transport.respond(message.id, { turn: { id: "turn-bounded" } });
        transport.request(705, "item/tool/call", {
          threadId: "thread-bounded",
          turnId: "turn-bounded",
          tool: "request_session_access",
          arguments: {
            requestedPolicy: "full",
            reason: "Try a broader source.",
            exactScope: "/Users/learner",
            intendedAction: "Read another source."
          }
        });
      }
      if (message.id === 705 && message.result) {
        transport.notify("turn/completed", {
          threadId: "thread-bounded", turn: { id: "turn-bounded", status: "completed", error: null }
        });
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");

    await runtime.streamTeaching({
      sessionId: "bounded-session",
      mathematics: "bounded monotone sequence",
      learningGoal: "Understand the selected claim",
      scope: "Explain one Source Anchor",
      initialTeachingDirection: "Use only the supplied source",
      accessScope: focusedAccessScope(),
      sourceContext: [{ sourceId: "source-1", name: "lemma.txt", mediaType: "text/plain", content: "A bounded monotone sequence converges." }],
      focus: {
        kind: "sourceAnchor",
        sourceAnchorId: "anchor-1",
        sourceId: "source-1",
        selection: { kind: "text", startOffset: 2, endOffset: 27, exactText: "bounded monotone sequence", prefix: "A ", suffix: " converges." },
        instruction: "Explain this anchor.",
        previousContent: null,
        variantName: null
      },
      onAccessRequest,
      onDelta: () => undefined,
      signal: new AbortController().signal
    });

    expect(onAccessRequest).not.toHaveBeenCalled();
    expect(transport.messages).toContainEqual({
      id: 705,
      result: {
        success: false,
        contentItems: [{ type: "inputText", text: "This dynamic tool is not authorized for its originating turn." }]
      }
    });
  });

  it("rejects a dynamic tool envelope whose thread does not own the registered turn", async () => {
    const onAccessRequest = vi.fn(async () => ({ status: "denied" as const, policy: "focused" as const }));
    const transport = new ScriptedTransport((message) => {
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "thread/start") transport.respond(message.id, { thread: { id: "thread-victim" } });
      if (message.method === "turn/start") {
        transport.respond(message.id, { turn: { id: "turn-victim" } });
        transport.request(706, "item/tool/call", {
          threadId: "thread-attacker",
          turnId: "turn-victim",
          tool: "request_session_access",
          arguments: {
            requestedPolicy: "full",
            reason: "Try a broader source.",
            exactScope: "/Users/learner",
            intendedAction: "Read another source."
          }
        });
      }
      if (message.id === 706 && message.result) {
        transport.notify("turn/completed", {
          threadId: "thread-victim", turn: { id: "turn-victim", status: "completed", error: null }
        });
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");

    await runtime.streamTeaching({
      sessionId: "victim-session",
      mathematics: "Explain the theorem.",
      learningGoal: "Understand the theorem",
      scope: "Use available context",
      initialTeachingDirection: "Inspect the hypotheses",
      accessScope: focusedAccessScope(),
      sourceContext: [],
      onAccessRequest,
      onDelta: () => undefined,
      signal: new AbortController().signal
    });

    expect(onAccessRequest).not.toHaveBeenCalled();
    expect(transport.messages).toContainEqual({
      id: 706,
      result: {
        success: false,
        contentItems: [{ type: "inputText", text: "This dynamic tool is not authorized for its originating turn." }]
      }
    });
  });

  it("routes the request_session_access dynamic tool through the learner decision callback", async () => {
    const transport = new ScriptedTransport((message) => {
      if (message.method === "initialize") {
        transport.respond(message.id, {
          userAgent: "codex-cli/0.144.1", codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos"
        });
      }
      if (message.method === "thread/start") transport.respond(message.id, { thread: { id: "thread-access" } });
      if (message.method === "turn/start") {
        transport.respond(message.id, { turn: { id: "turn-access" } });
        transport.request(700, "item/tool/call", {
          threadId: "thread-access",
          turnId: "turn-access",
          callId: "call-access",
          namespace: null,
          tool: "request_session_access",
          arguments: {
            requestedPolicy: "full",
            reason: "A cited local reference is unavailable.",
            exactScope: "/Users/learner/reference.pdf",
            intendedAction: "Read the cited theorem statement."
          }
        });
      }
      if (message.id === 700 && message.result) {
        transport.notify("turn/completed", {
          threadId: "thread-access",
          turn: { id: "turn-access", status: "completed", error: null }
        });
      }
    });
    const runtime = await CodexAppServerRuntime.connect(transport, "/workspace");
    const accessRequests: unknown[] = [];

    await runtime.streamTeaching({
      sessionId: "learning-session-access",
      mathematics: "Explain the theorem.",
      learningGoal: "Understand the theorem",
      scope: "Use available context",
      initialTeachingDirection: "Inspect the hypotheses",
      accessScope: focusedAccessScope(),
      sourceContext: [],
      onAccessRequest: async (request) => {
        accessRequests.push(request);
        return { status: "denied", policy: "focused" };
      },
      onDelta: () => undefined,
      signal: new AbortController().signal
    });

    expect(accessRequests).toEqual([{
      requestedPolicy: "full",
      reason: "A cited local reference is unavailable.",
      exactScope: "/Users/learner/reference.pdf",
      intendedAction: "Read the cited theorem statement."
    }]);
    expect(transport.messages).toContainEqual({
      id: 700,
      result: {
        success: true,
        contentItems: [{ type: "inputText", text: "Access denied. Continue within Focused Access or explain the limitation." }]
      }
    });
  });
});

type ProtocolMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

function focusedAccessScope() {
  return {
    policy: "focused" as const,
    sourceIds: [],
    allowsBroadLocalRead: false,
    allowsSourceModification: false as const
  };
}

function focusedTeachingAccess() {
  return {
    accessScope: focusedAccessScope(),
    sourceContext: [],
    onAccessRequest: async () => ({ status: "denied" as const, policy: "focused" as const })
  };
}

class ScriptedTransport implements AppServerTransport {
  readonly messages: ProtocolMessage[] = [];
  closed = false;
  closeGate: Promise<void> | null = null;
  private lineListener: ((line: string) => void) | null = null;
  private closeListener: ((error?: Error) => void) | null = null;
  private readonly messageWaiters = new Map<string, Array<() => void>>();

  constructor(private readonly onMessage: (message: ProtocolMessage) => void) {}

  write(line: string): void {
    const message = JSON.parse(line) as ProtocolMessage;
    this.messages.push(message);
    if (message.method) {
      for (const resolve of this.messageWaiters.get(message.method) ?? []) resolve();
      this.messageWaiters.delete(message.method);
    }
    queueMicrotask(() => this.onMessage(message));
  }

  onLine(listener: (line: string) => void): void {
    this.lineListener = listener;
  }

  onClose(listener: (error?: Error) => void): void {
    this.closeListener = listener;
  }

  respond(id: number | undefined, result: unknown): void {
    this.lineListener?.(JSON.stringify({ id, result }));
  }

  notify(method: string, params: unknown): void {
    this.lineListener?.(JSON.stringify({ method, params }));
  }

  request(id: number, method: string, params: unknown): void {
    this.lineListener?.(JSON.stringify({ id, method, params }));
  }

  reject(id: number | undefined, code: number, message: string): void {
    this.lineListener?.(JSON.stringify({ id, error: { code, message } }));
  }

  async close(): Promise<void> {
    await this.closeGate;
    this.closed = true;
    this.closeListener?.();
  }

  fail(error: Error): void {
    this.closeListener?.(error);
  }

  async waitForMessage(method: string): Promise<void> {
    if (this.messages.some((message) => message.method === method)) return;
    await new Promise<void>((resolve) => {
      const waiters = this.messageWaiters.get(method) ?? [];
      waiters.push(resolve);
      this.messageWaiters.set(method, waiters);
    });
  }
}
