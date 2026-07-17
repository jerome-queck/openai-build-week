# Use Codex app-server as the version-one model runtime

Version one will use a Codex Runtime backed by a local `codex app-server` process for both supported authentication choices: Sign in with ChatGPT for subscription access and OpenAI API-key login for usage-based access. Codex owns the authentication session; the education app will not treat a ChatGPT credential as a general-purpose API token. The integration will use the stable local stdio protocol rather than the experimental WebSocket transport.

Product and session state will depend on a Model Runtime boundary rather than directly on Codex thread objects or transport messages. This keeps authentication, streamed events, approvals, and tool execution unified for version one while allowing a direct Responses API runtime to be added later if its capabilities justify maintaining a second backend.

This follows OpenAI's current [authentication](https://learn.chatgpt.com/docs/auth) and [Codex app-server](https://learn.chatgpt.com/docs/app-server) guidance. API-key usage remains billed through the learner's API account, while ChatGPT sign-in follows the learner's eligible subscription and workspace controls.
