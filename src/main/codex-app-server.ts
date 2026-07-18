import { ModelAccessError, type
  AuthenticationState,
  ChatGptLogin,
  ConceptPeekRequest,
  ModelRuntime,
  ModelRuntimeEvent,
  SessionProposal,
  TeachingRequest
} from "../shared/model-runtime";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { sessionAccessPolicyLabel } from "../shared/session-access";

type ProtocolId = number;

interface ProtocolMessage {
  id?: ProtocolId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface AppServerTransport {
  write(line: string): void;
  onLine(listener: (line: string) => void): void;
  onClose(listener: (error?: Error) => void): void;
  close(): void;
}

class CodexProcessTransport implements AppServerTransport {
  private readonly process: ChildProcessWithoutNullStreams;
  private lineListener: ((line: string) => void) | null = null;
  private closeListener: ((error?: Error) => void) | null = null;
  private stderr = "";
  private closed = false;

  constructor(command: string, cwd: string) {
    this.process = spawn(command, ["app-server", "--stdio"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
    createInterface({ input: this.process.stdout }).on("line", (line) => this.lineListener?.(line));
    this.process.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-4_000);
    });
    this.process.once("error", (error) => this.closeListener?.(error));
    this.process.once("exit", (code, signal) => {
      this.closed = true;
      const detail = this.stderr.trim();
      if (detail) console.error("Codex app-server diagnostics:", detail);
      this.closeListener?.(new Error(
        `Codex app-server stopped${code === null ? ` with signal ${signal}` : ` with code ${code}`}.`
      ));
    });
  }

  write(line: string): void {
    if (this.closed || !this.process.stdin.writable) throw new Error("Codex app-server is not writable.");
    this.process.stdin.write(line);
  }

  onLine(listener: (line: string) => void): void {
    this.lineListener = listener;
  }

  onClose(listener: (error?: Error) => void): void {
    this.closeListener = listener;
  }

  close(): void {
    if (this.closed) return;
    this.process.stdin.end();
    const terminationTimer = setTimeout(() => {
      if (!this.closed) this.process.kill("SIGTERM");
    }, 1_000);
    terminationTimer.unref();
  }
}

class AppServerClient {
  private nextId = 1;
  private readonly pending = new Map<ProtocolId, {
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>();
  private readonly notificationListeners = new Set<(message: ProtocolMessage) => void>();
  private readonly failureListeners = new Set<(error: Error) => void>();
  private serverRequestHandler: ((method: string, params: unknown) => Promise<unknown>) | null = null;
  private failureError: Error | null = null;

  constructor(private readonly transport: AppServerTransport) {
    transport.onLine((line) => this.receive(line));
    transport.onClose((error) => this.rejectPending(new ModelAccessError(
      "runtime",
      `Codex runtime became unavailable. ${error?.message ?? "Codex app-server stopped."}`
    )));
  }

  async initialize(): Promise<void> {
    const response = await this.request("initialize", {
      clientInfo: { name: "quick_study", title: "Quick Study", version: "0.1.0" },
      capabilities: null
    });
    if (!isInitializeResponse(response)) {
      throw new Error("Codex app-server uses an incompatible initialize response.");
    }
    this.notify("initialized", {});
  }

  request(method: string, params?: unknown, timeoutMs = 10_000): Promise<unknown> {
    if (this.failureError) {
      return Promise.reject(new ModelAccessError("runtime", "Codex runtime became unavailable. Restart Codex and retry."));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server timed out while handling ${method}.`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      this.send({ id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ method, params });
  }

  close(): void {
    this.transport.close();
  }

  onNotification(listener: (message: ProtocolMessage) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onFailure(listener: (error: Error) => void): () => void {
    this.failureListeners.add(listener);
    if (this.failureError) listener(this.failureError);
    return () => this.failureListeners.delete(listener);
  }

  onServerRequest(handler: (method: string, params: unknown) => Promise<unknown>): void {
    this.serverRequestHandler = handler;
  }

  private send(message: ProtocolMessage): void {
    try {
      this.transport.write(`${JSON.stringify(message)}\n`);
    } catch {
      const error = new ModelAccessError("runtime", "Codex runtime became unavailable. Restart Codex and retry.");
      this.rejectPending(error);
      throw error;
    }
  }

  private receive(line: string): void {
    let message: ProtocolMessage;
    try {
      message = JSON.parse(line) as ProtocolMessage;
    } catch {
      this.rejectPending(new Error("Codex app-server sent malformed JSON."));
      return;
    }
    if (message.id !== undefined && message.method) {
      if (message.method === "item/tool/call" && this.serverRequestHandler) {
        void this.serverRequestHandler(message.method, message.params).then(
          (result) => this.send({ id: message.id, result }),
          (error: unknown) => this.send({
            id: message.id,
            result: dynamicToolFailure(error)
          })
        );
        return;
      }
      this.denyServerRequest(message.id, message.method);
      return;
    }
    if (message.id === undefined) {
      for (const listener of this.notificationListeners) listener(message);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      console.error("Codex app-server request failed:", message.error);
      pending.reject(curatedProtocolError(message.error.message));
    } else {
      pending.resolve(message.result);
    }
  }

  private denyServerRequest(id: ProtocolId, method: string): void {
    const modernApproval = method === "item/commandExecution/requestApproval"
      || method === "item/fileChange/requestApproval";
    const legacyApproval = method === "execCommandApproval" || method === "applyPatchApproval";
    if (modernApproval) {
      this.send({ id, result: { decision: "decline" } });
    } else if (legacyApproval) {
      this.send({ id, result: { decision: "denied" } });
    } else {
      this.send({ id, error: { code: -32601, message: "Focused Access does not permit server-initiated requests." } });
    }
  }

  private rejectPending(error: Error): void {
    if (this.failureError) return;
    this.failureError = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const listener of this.failureListeners) listener(error);
  }
}

export class CodexAppServerRuntime implements ModelRuntime {
  private readonly turns = new Map<string, {
    threadId: string;
    content: string;
    onDelta?: (delta: string) => void;
    resolve(content: string): void;
    reject(error: Error): void;
    timeout: ReturnType<typeof setTimeout>;
    onRuntimeEvent?: (event: ModelRuntimeEvent) => void;
    onAccessRequest?: TeachingRequest["onAccessRequest"];
  }>();
  private readonly earlyTurnNotifications = new Map<string, ProtocolMessage[]>();
  private readonly turnRegistrationWaiters = new Map<string, () => void>();
  private runtimeFailure: Error | null = null;
  private readonly teachingStartSignals = new Map<string, {
    promise: Promise<void>;
    resolve(): void;
  }>();

  private constructor(
    private readonly client: AppServerClient,
    private readonly cwd: string,
    private readonly turnTimeoutMs: number
  ) {
    client.onNotification((message) => this.receiveNotification(message));
    client.onServerRequest((_method, params) => this.handleDynamicToolCall(params));
    client.onFailure((error) => {
      this.runtimeFailure = error;
      this.failActiveTurns(error);
    });
  }

  static async connect(
    transport: AppServerTransport,
    cwd: string,
    options: { turnTimeoutMs?: number } = {}
  ): Promise<CodexAppServerRuntime> {
    const client = new AppServerClient(transport);
    await client.initialize();
    return new CodexAppServerRuntime(client, cwd, options.turnTimeoutMs ?? 120_000);
  }

  static launch(cwd: string, command = process.env.QUICK_STUDY_CODEX_PATH ?? "codex"): Promise<CodexAppServerRuntime> {
    return CodexAppServerRuntime.connect(new CodexProcessTransport(command, cwd), cwd);
  }

  async getAuthentication(): Promise<AuthenticationState> {
    const response = await this.client.request("account/read", { refreshToken: false }) as {
      account: null | { type: "apiKey" } | { type: "chatgpt"; email: string | null };
    };
    if (!response.account) return { status: "signedOut" };
    if (response.account.type === "apiKey") {
      return { status: "signedIn", method: "apiKey", accountLabel: null };
    }
    return {
      status: "signedIn",
      method: "chatgpt",
      accountLabel: response.account.email
    };
  }

  async startChatGptLogin(): Promise<ChatGptLogin> {
    const response = await this.client.request("account/login/start", {
      type: "chatgpt",
      codexStreamlinedLogin: true,
      useHostedLoginSuccessPage: true,
      appBrand: "codex"
    }) as { type: "chatgpt"; loginId: string; authUrl: string };
    if (response.type !== "chatgpt") throw new Error("Codex returned an unexpected login response.");
    return { loginId: response.loginId, authUrl: response.authUrl };
  }

  async loginWithApiKey(apiKey: string): Promise<void> {
    await this.client.request("account/login/start", { type: "apiKey", apiKey });
  }

  async proposeSession(mathematics: string, onRuntimeEvent?: (event: ModelRuntimeEvent) => void): Promise<SessionProposal> {
    try {
      const content = await this.runTurn(
        [
          "Interpret this mathematics intake for an adaptive learning session.",
          "Return only the requested JSON. Make the proposal concise and editable.",
          "Pause for confirmation only when ambiguity or likely cost makes a wrong start materially wasteful.",
          "Classify materialScope as focused or longOrMultiStage by mathematical coherence, not arbitrary length. If it is longOrMultiStage, return a compact Argument Roadmap with major claims, stages, dependencies, and an exact verbatim sourceExcerpt for each stage. Propose one coherent stage as the current Learning Slice, including only its immediate prerequisites. Do not expand or teach every step. For focused material, return argumentRoadmap as null.",
          "Mathematics intake:",
          mathematics
        ].join("\n\n"),
        SESSION_PROPOSAL_SCHEMA,
        undefined,
        undefined,
        onRuntimeEvent
      );
      return parseSessionProposal(content);
    } catch (error) {
      onRuntimeEvent?.({ type: "turnFailed", threadId: "unavailable", turnId: null, detail: diagnosticMessage(error) });
      throw error;
    }
  }

  async createConceptPeek(request: ConceptPeekRequest): Promise<string> {
    let resolveStart!: () => void;
    const start = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });
    this.teachingStartSignals.set(request.sessionId, { promise: start, resolve: resolveStart });
    try {
      if (request.signal.aborted) throw new Error("Concept Peek generation was stopped.");
      const content = await this.runTurn(
        [
          "Write one compact Concept Peek explaining the named prerequisite at the supplied Source Anchor.",
          "Use two to four learner-facing sentences. State the relevant definition, lemma, or technique and connect it directly to the anchored mathematics. Do not branch into a full lesson, claim verification, or mention internal tools.",
          `Learning Goal: ${request.learningGoal}`,
          `Prerequisite: ${request.prerequisite}`,
          `Source Anchor: ${JSON.stringify(request.selection)}`,
          "Session mathematics:",
          request.mathematics
        ].join("\n\n"),
        undefined,
        undefined,
        request.sessionId,
        request.onRuntimeEvent
      );
      if (request.signal.aborted) throw new Error("Concept Peek generation was stopped.");
      return content;
    } catch (error) {
      resolveStart();
      request.onRuntimeEvent?.({ type: "turnFailed", threadId: "unavailable", turnId: null, detail: diagnosticMessage(error) });
      throw error;
    } finally {
      this.teachingStartSignals.delete(request.sessionId);
    }
  }

  async streamTeaching(request: TeachingRequest): Promise<void> {
    let resolveStart!: () => void;
    const start = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });
    this.teachingStartSignals.set(request.sessionId, { promise: start, resolve: resolveStart });
    try {
      await this.runTurn(
        [
          "Create one learner-facing Teaching Card, not a chat transcript.",
          teachingSessionContext(request),
          `Session Access Policy: ${sessionAccessPolicyLabel(request.accessScope.policy)}. Use only the context supplied within this authorized scope. Source modification and deletion are prohibited.`,
          authorizedSourceContext(request),
          questionContext(request),
          questionRevision(request),
          teachingFocus(request),
          "Mathematics:",
          request.mathematics,
          "Explain the mathematical strategy clearly, surface assumptions, and do not claim verification that did not occur."
        ].join("\n\n"),
        undefined,
        request.onDelta,
        request.sessionId,
        request.onRuntimeEvent,
        request
      );
    } catch (error) {
      resolveStart();
      request.onRuntimeEvent?.({ type: "turnFailed", threadId: "unavailable", turnId: null, detail: diagnosticMessage(error) });
      throw error;
    } finally {
      this.teachingStartSignals.delete(request.sessionId);
    }
  }

  async cancelTeaching(sessionId: string): Promise<void> {
    if (!this.activeTeachingTurns.has(sessionId)) {
      await this.teachingStartSignals.get(sessionId)?.promise;
    }
    const active = this.activeTeachingTurns.get(sessionId);
    if (!active) return;
    await this.client.request("turn/interrupt", active);
  }

  async shutdown(): Promise<void> {
    this.client.close();
  }

  private async runTurn(
    prompt: string,
    outputSchema?: unknown,
    onDelta?: (delta: string) => void,
    sessionId?: string,
    onRuntimeEvent?: (event: ModelRuntimeEvent) => void,
    teachingRequest?: TeachingRequest
  ): Promise<string> {
    const accessPolicy = teachingRequest?.accessScope.policy ?? "focused";
    const anchoredFocus = Boolean(teachingRequest?.focus);
    const contextualQuestion = Boolean(teachingRequest?.questionContext);
    const boundedContext = anchoredFocus || contextualQuestion;
    const fullAccessTools = accessPolicy === "full" && !boundedContext;
    const threadResponse = await this.client.request("thread/start", {
      cwd: this.cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      dynamicTools: teachingRequest && !boundedContext ? [SESSION_ACCESS_REQUEST_TOOL] : [],
      config: {
        features: {
          apps: false,
          hooks: false,
          multi_agent: false,
          remote_plugin: false,
          shell_tool: fullAccessTools,
          unified_exec: fullAccessTools
        },
        mcp_servers: {},
        web_search: "disabled"
      },
      baseInstructions: anchoredFocus
        ? "You are the bounded teaching runtime for an anchored Teaching Card. Use only the supplied authorized source context so the Context Used Receipt remains complete. Do not request or inspect additional local material. Produce only learner-facing mathematical teaching output."
        : contextualQuestion
        ? "You are the bounded teaching runtime for a Question Card. Use only the learner-approved Ask Bar context and supplied authorized source context so the Context Used Receipt remains complete. Do not request or inspect additional local material. Revise one coherent Question Card rather than producing a chat transcript."
        : fullAccessTools
        ? "You are the bounded teaching runtime for Quick Study. Full Access permits read-only local inspection for this Learning Session. Never modify or delete source files. Produce only learner-facing mathematical teaching output."
        : "You are the bounded teaching runtime for Quick Study. Use only supplied authorized context. If broader local context is necessary, call request_session_access with the reason, exact scope, and intended action. Do not execute commands or modify files. Produce only learner-facing mathematical teaching output."
    }) as { thread: { id: string } };
    onRuntimeEvent?.({
      type: "threadStarted",
      threadId: threadResponse.thread.id,
      turnId: null,
      detail: `Codex teaching thread started with ${sessionAccessPolicyLabel(accessPolicy)}${fullAccessTools ? " read-only tools enabled" : " supplied context only"}.`
    });
    const turnResponse = await this.client.request("turn/start", {
      threadId: threadResponse.thread.id,
      input: [{ type: "text", text: prompt, text_elements: [] }],
      ...(outputSchema ? { outputSchema } : {})
    }) as { turn: { id: string } };
    if (this.runtimeFailure) {
      throw new ModelAccessError("runtime", `Codex runtime became unavailable. ${this.runtimeFailure.message}`);
    }
    onRuntimeEvent?.({
      type: "turnStarted",
      threadId: threadResponse.thread.id,
      turnId: turnResponse.turn.id,
      detail: "Codex teaching turn started."
    });
    onRuntimeEvent?.({
      type: "inputSubmitted",
      threadId: threadResponse.thread.id,
      turnId: turnResponse.turn.id,
      detail: prompt
    });

    return new Promise<string>((resolve, reject) => {
      this.turns.set(turnResponse.turn.id, {
        threadId: threadResponse.thread.id,
        content: "",
        onDelta,
        resolve,
        reject,
        timeout: createUnrefTimer(() => this.expireTurn(turnResponse.turn.id), this.turnTimeoutMs),
        onRuntimeEvent,
        onAccessRequest: teachingRequest?.onAccessRequest
      });
      this.turnRegistrationWaiters.get(turnResponse.turn.id)?.();
      if (sessionId) this.activeTeachingTurns.set(sessionId, {
        threadId: threadResponse.thread.id,
        turnId: turnResponse.turn.id
      });
      if (sessionId) this.teachingStartSignals.get(sessionId)?.resolve();
      for (const notification of this.earlyTurnNotifications.get(turnResponse.turn.id) ?? []) {
        this.receiveNotification(notification);
      }
      this.earlyTurnNotifications.delete(turnResponse.turn.id);
    });
  }

  private readonly activeTeachingTurns = new Map<string, { threadId: string; turnId: string }>();

  private async handleDynamicToolCall(params: unknown): Promise<unknown> {
    const call = parseAccessRequestToolCall(params);
    let turn = this.turns.get(call.turnId);
    if (!turn) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.turnRegistrationWaiters.delete(call.turnId);
          resolve();
        }, 1_000);
        this.turnRegistrationWaiters.set(call.turnId, () => {
          clearTimeout(timeout);
          this.turnRegistrationWaiters.delete(call.turnId);
          resolve();
        });
      });
      turn = this.turns.get(call.turnId);
    }
    if (!turn?.onAccessRequest) throw new Error("This turn cannot request Session Access elevation.");
    const decision = await turn.onAccessRequest(call.request);
    return {
      success: true,
      contentItems: [{
        type: "inputText",
        text: decision.status === "denied"
          ? `Access denied. Continue within ${sessionAccessPolicyLabel(decision.policy)} or explain the limitation.`
          : `Access ${decision.status}. The Learning Session now uses ${sessionAccessPolicyLabel(decision.policy)}.`
      }]
    };
  }

  private receiveNotification(message: ProtocolMessage): void {
    if (message.method === "item/agentMessage/delta") {
      const params = message.params as { turnId: string; delta: string };
      const turn = this.turns.get(params.turnId);
      if (!turn) {
        this.bufferEarlyTurnNotification(params.turnId, message);
        return;
      }
      turn.content += params.delta;
      turn.onDelta?.(params.delta);
      turn.onRuntimeEvent?.({
        type: "outputDelta",
        threadId: turn.threadId,
        turnId: params.turnId,
        detail: params.delta
      });
      return;
    }
    if (message.method !== "turn/completed") return;
    const params = message.params as {
      turn: { id: string; status: "completed" | "interrupted" | "failed"; error: null | { message?: string } };
    };
    const turn = this.turns.get(params.turn.id);
    if (!turn) {
      this.bufferEarlyTurnNotification(params.turn.id, message);
      return;
    }
    this.turns.delete(params.turn.id);
    clearTimeout(turn.timeout);
    for (const [sessionId, active] of this.activeTeachingTurns) {
      if (active.turnId === params.turn.id) this.activeTeachingTurns.delete(sessionId);
    }
    if (params.turn.status === "completed") {
      turn.onRuntimeEvent?.({
        type: "turnCompleted",
        threadId: turn.threadId,
        turnId: params.turn.id,
        detail: "Codex teaching turn completed."
      });
      turn.resolve(turn.content);
    } else if (params.turn.status === "interrupted") {
      turn.onRuntimeEvent?.({
        type: "turnFailed",
        threadId: turn.threadId,
        turnId: params.turn.id,
        detail: "Codex teaching turn was interrupted."
      });
      turn.reject(new Error("Codex teaching was interrupted."));
    } else {
      turn.onRuntimeEvent?.({
        type: "turnFailed",
        threadId: turn.threadId,
        turnId: params.turn.id,
        detail: params.turn.error?.message ?? "Codex teaching turn failed without protocol diagnostics."
      });
      turn.reject(curatedProtocolError(params.turn.error?.message ?? "Codex could not complete this turn."));
    }
  }

  private bufferEarlyTurnNotification(turnId: string, message: ProtocolMessage): void {
    const buffered = this.earlyTurnNotifications.get(turnId) ?? [];
    buffered.push(message);
    this.earlyTurnNotifications.set(turnId, buffered.slice(-100));
  }

  private expireTurn(turnId: string): void {
    const turn = this.turns.get(turnId);
    if (!turn) return;
    this.turns.delete(turnId);
    this.removeActiveTeachingTurn(turnId);
    turn.onRuntimeEvent?.({
      type: "turnFailed",
      threadId: turn.threadId,
      turnId,
      detail: "Codex teaching turn timed out."
    });
    void this.client.request("turn/interrupt", { threadId: turn.threadId, turnId }).catch(() => undefined);
    turn.reject(new Error("Codex teaching timed out. Retry when the runtime is available."));
  }

  private failActiveTurns(error: Error): void {
    for (const [turnId, turn] of this.turns) {
      clearTimeout(turn.timeout);
      turn.onRuntimeEvent?.({
        type: "turnFailed",
        threadId: turn.threadId,
        turnId,
      detail: error.message
      });
      turn.reject(new ModelAccessError("runtime", "Codex runtime became unavailable. Restart Codex and retry this Teaching Card."));
      this.removeActiveTeachingTurn(turnId);
    }
    this.turns.clear();
  }

  private removeActiveTeachingTurn(turnId: string): void {
    for (const [sessionId, active] of this.activeTeachingTurns) {
      if (active.turnId === turnId) this.activeTeachingTurns.delete(sessionId);
    }
  }
}

function authorizedSourceContext(request: TeachingRequest): string {
  if (request.sourceContext.length === 0) return "Authorized source context: none beyond the mathematics intake.";
  return [
    "Authorized source context (do not infer access to any other local material):",
    ...request.sourceContext.map((source) => JSON.stringify({
      sourceId: source.sourceId,
      name: source.name,
      mediaType: source.mediaType,
      content: source.content
    }))
  ].join("\n");
}

function teachingSessionContext(request: TeachingRequest): string {
  if (request.questionContext) {
    return "Session teaching context is limited to the learner-approved Ask Bar context below.";
  }
  const base = [
    `Learning Goal: ${request.learningGoal}`,
    `Scope: ${request.scope}`,
    `Initial teaching direction: ${request.initialTeachingDirection}`
  ];
  if (!request.learningSlice) return base.join("\n");
  return [
    ...base,
    `Argument Roadmap: ${request.learningSlice.roadmapTitle}`,
    `Chosen Learning Slice: ${request.learningSlice.stageTitle}`,
    `Editable slice boundary: ${request.learningSlice.boundary}`,
    `Immediate prerequisites only: ${request.learningSlice.immediatePrerequisites.join("; ") || "none"}`,
    `Future Learning Sessions, not part of this Teaching Card: ${request.learningSlice.remainingStageTitles.join("; ")}`,
    "Teach only the chosen Learning Slice and its immediate prerequisites. Do not expand the remaining roadmap or replace it with one exhaustive explanation or artifact."
  ].join("\n");
}

function questionContext(request: TeachingRequest): string {
  if (!request.questionContext) return "Ask Bar context: use the current Learning Session intake.";
  return [
    "Learner-approved Ask Bar context (the complete Context Used Receipt):",
    ...request.questionContext.map((item) => JSON.stringify({
      type: item.typeLabel,
      identity: item.identity,
      location: item.location,
      preview: item.preview
    }))
  ].join("\n");
}

function questionRevision(request: TeachingRequest): string {
  if (!request.questionRevision) return "Question Card revision: create the first coherent answer.";
  return [
    "Question Card revision: revise the existing structured card rather than appending a reply.",
    `Previous question: ${request.questionRevision.previousQuestion}`,
    `Previous answer: ${request.questionRevision.previousContent}`
  ].join("\n");
}

function teachingFocus(request: TeachingRequest): string {
  if (!request.focus) return "Teaching focus: the current Learning Session intake.";
  return [
    "Teaching focus: produce a Teaching Card visibly associated with this exact Source Anchor.",
    `Source Anchor: ${JSON.stringify({
      sourceAnchorId: request.focus.sourceAnchorId,
      sourceId: request.focus.sourceId,
      selection: request.focus.selection
    })}`,
    `Learner instruction: ${request.focus.instruction}`,
    request.focus.previousContent === null
      ? "This is the first explanation route for the anchor."
      : `Revise or branch from this current route without producing a chronological message feed:\n${request.focus.previousContent}`,
    request.focus.variantName === null
      ? "Return one coherent current route."
      : `Return a genuinely different route retained as the named Teaching Variant: ${request.focus.variantName}.`
  ].join("\n\n");
}

function parseAccessRequestToolCall(params: unknown): {
  turnId: string;
  request: Parameters<TeachingRequest["onAccessRequest"]>[0];
} {
  if (!isRecord(params) || params.tool !== "request_session_access" || typeof params.turnId !== "string"
    || !isRecord(params.arguments)) {
    throw new Error("Codex sent an invalid Session Access Request.");
  }
  const request = params.arguments;
  if ((request.requestedPolicy !== "workspace" && request.requestedPolicy !== "full")
    || typeof request.reason !== "string" || !request.reason.trim()
    || typeof request.exactScope !== "string" || !request.exactScope.trim()
    || typeof request.intendedAction !== "string" || !request.intendedAction.trim()) {
    throw new Error("Codex sent an invalid Session Access Request.");
  }
  return {
    turnId: params.turnId,
    request: {
      requestedPolicy: request.requestedPolicy,
      reason: request.reason,
      exactScope: request.exactScope,
      intendedAction: request.intendedAction
    }
  };
}

function dynamicToolFailure(error: unknown): unknown {
  return {
    success: false,
    contentItems: [{ type: "inputText", text: diagnosticMessage(error) }]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isInitializeResponse(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return typeof response.userAgent === "string"
    && typeof response.codexHome === "string"
    && typeof response.platformFamily === "string"
    && typeof response.platformOs === "string";
}

function createUnrefTimer(callback: () => void, timeoutMs: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(callback, timeoutMs);
  timer.unref();
  return timer;
}

function curatedProtocolError(message: string): Error {
  if (/network|offline|connection/i.test(message)) {
    return new ModelAccessError("network", "Network connection is unavailable.");
  }
  if (/subscription.*capacity|capacity.*subscription/i.test(message)) {
    return new ModelAccessError("subscriptionCapacity", "ChatGPT subscription capacity is unavailable.");
  }
  if (/auth|unauthor|credential/i.test(message)) {
    return new ModelAccessError("authentication", "Codex authentication is unavailable. Sign in and retry.");
  }
  if (/rate|quota|usage|limit/i.test(message)) {
    return new ModelAccessError("quota", "Codex usage is currently unavailable. Check your plan or API usage, then retry.");
  }
  if (/interrupt/i.test(message)) return new Error("Codex teaching was interrupted.");
  return new Error("Codex could not complete this request. Retry when the runtime is available.");
}

function diagnosticMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const SESSION_ACCESS_REQUEST_TOOL = {
  type: "function",
  name: "request_session_access",
  description: "Ask the learner to elevate this Learning Session's local access. Use only when the current policy cannot supply necessary context.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["requestedPolicy", "reason", "exactScope", "intendedAction"],
    properties: {
      requestedPolicy: { type: "string", enum: ["workspace", "full"] },
      reason: { type: "string" },
      exactScope: { type: "string" },
      intendedAction: { type: "string" }
    }
  }
} as const;

const SESSION_PROPOSAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "learningGoal",
    "scope",
    "initialTeachingDirection",
    "requiresConfirmation",
    "confirmationReason",
    "materialScope",
    "argumentRoadmap"
  ],
  properties: {
    learningGoal: { type: "string" },
    scope: { type: "string" },
    initialTeachingDirection: { type: "string" },
    requiresConfirmation: { type: "boolean" },
    confirmationReason: { type: ["string", "null"] },
    materialScope: { type: "string", enum: ["focused", "longOrMultiStage"] },
    argumentRoadmap: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["title", "stages", "proposedStage"],
      properties: {
        title: { type: "string" },
        proposedStage: { type: "integer", minimum: 0 },
        stages: {
          type: "array",
          minItems: 2,
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "majorClaim", "dependsOn", "sourceExcerpt", "learningGoal", "boundary", "immediatePrerequisites"],
            properties: {
              title: { type: "string" },
              majorClaim: { type: "string" },
              dependsOn: { type: "array", items: { type: "integer", minimum: 0 } },
              sourceExcerpt: { type: "string" },
              learningGoal: { type: "string" },
              boundary: { type: "string" },
              immediatePrerequisites: { type: "array", items: { type: "string" } }
            }
          }
        }
      }
    }
  }
} as const;

function parseSessionProposal(content: string): SessionProposal {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("Codex returned a malformed Session Proposal. Retry to request a fresh proposal.");
  }
  if (!value || typeof value !== "object") {
    throw new Error("Codex returned a malformed Session Proposal. Retry to request a fresh proposal.");
  }
  const proposal = value as Record<string, unknown>;
  if (
    typeof proposal.learningGoal !== "string"
    || typeof proposal.scope !== "string"
    || typeof proposal.initialTeachingDirection !== "string"
    || typeof proposal.requiresConfirmation !== "boolean"
    || !(proposal.confirmationReason === null || typeof proposal.confirmationReason === "string")
    || (proposal.materialScope !== "focused" && proposal.materialScope !== "longOrMultiStage")
    || (proposal.materialScope === "focused" && proposal.argumentRoadmap !== null)
    || (proposal.materialScope === "longOrMultiStage" && proposal.argumentRoadmap === null)
    || !validArgumentRoadmapProposal(proposal.argumentRoadmap)
  ) {
    throw new Error("Codex returned a malformed Session Proposal. Retry to request a fresh proposal.");
  }
  return proposal as unknown as SessionProposal;
}

function validArgumentRoadmapProposal(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value) || typeof value.title !== "string" || !value.title.trim()
    || !Number.isInteger(value.proposedStage) || !Array.isArray(value.stages) || value.stages.length < 2 || value.stages.length > 12
    || (value.proposedStage as number) < 0 || (value.proposedStage as number) >= value.stages.length) return false;
  return value.stages.every((stage, index) => isRecord(stage)
    && typeof stage.title === "string" && Boolean(stage.title.trim())
    && typeof stage.majorClaim === "string" && Boolean(stage.majorClaim.trim())
    && Array.isArray(stage.dependsOn) && stage.dependsOn.every((dependency) => Number.isInteger(dependency)
      && (dependency as number) >= 0 && (dependency as number) < index)
    && typeof stage.sourceExcerpt === "string" && Boolean(stage.sourceExcerpt.trim())
    && typeof stage.learningGoal === "string" && Boolean(stage.learningGoal.trim())
    && typeof stage.boundary === "string" && Boolean(stage.boundary.trim())
    && Array.isArray(stage.immediatePrerequisites)
    && stage.immediatePrerequisites.every((prerequisite) => typeof prerequisite === "string" && Boolean(prerequisite.trim())));
}
