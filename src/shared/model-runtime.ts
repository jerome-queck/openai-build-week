export type AuthenticationMethod = "chatgpt" | "apiKey";
export type ModelAccessCause = "network" | "authentication" | "subscriptionCapacity" | "quota" | "runtime";

export class ModelAccessError extends Error {
  constructor(readonly cause: ModelAccessCause, message: string) {
    super(message);
    this.name = "ModelAccessError";
  }
}

export type AuthenticationState =
  | { status: "signedOut" }
  | { status: "signingIn"; method: AuthenticationMethod }
  | { status: "signedIn"; method: AuthenticationMethod; accountLabel: string | null }
  | { status: "failed"; method: AuthenticationMethod | null; error: string };

export interface ChatGptLogin {
  loginId: string;
  authUrl: string;
}

export interface SessionProposal {
  learningGoal: string;
  scope: string;
  initialTeachingDirection: string;
  requiresConfirmation: boolean;
  confirmationReason: string | null;
}

export interface TeachingRequest {
  sessionId: string;
  mathematics: string;
  learningGoal: string;
  scope: string;
  initialTeachingDirection: string;
  onDelta(delta: string): void;
  onRuntimeEvent?(event: ModelRuntimeEvent): void;
  signal: AbortSignal;
}

export interface ModelRuntimeEvent {
  type: "threadStarted" | "turnStarted" | "inputSubmitted" | "outputDelta" | "turnCompleted" | "turnFailed";
  threadId: string;
  turnId: string | null;
  detail: string;
}

export interface ModelRuntime {
  getAuthentication(): Promise<AuthenticationState>;
  startChatGptLogin(): Promise<ChatGptLogin>;
  loginWithApiKey(apiKey: string): Promise<void>;
  proposeSession(mathematics: string, onRuntimeEvent?: (event: ModelRuntimeEvent) => void): Promise<SessionProposal>;
  streamTeaching(request: TeachingRequest): Promise<void>;
  cancelTeaching(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
}
