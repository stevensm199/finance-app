# Repository Working Agreement

## Purpose and architecture

This repository contains the backend for a personal finance app. The Telegram bot is the only client in the MVP. Keep business behavior independent from Telegram, Express, Supabase, and the language model so those integrations can change without rewriting use cases.

Use Clean Architecture with dependencies pointing inward:

| Layer | Responsibilities | Keep out |
| --- | --- | --- |
| `presentation` | HTTP and Telegram boundaries, request validation, authentication, identity resolution, and response mapping | Business rules and provider SDK details |
| `service` | Application use cases and orchestration across domain ports | Express request/response objects and direct database/provider calls |
| `domain` | Business types, rules, errors, and interfaces (ports) required by use cases | Frameworks, environment variables, and infrastructure implementations |
| `infrastructure` | Adapters for Supabase, Telegram, DeepSeek, and logging | Ownership or transaction policy decisions |

`src/server.ts` is the composition root: it loads configuration, creates infrastructure adapters, and injects them into presentation and service code. Avoid importing infrastructure from the domain or service layers.

## Configuration and secrets

- Validate environment variables once at startup in `src/config/config.ts` with Zod. Read configuration through the typed config object rather than accessing `process.env` elsewhere.
- Keep credentials in local `.env` files or the deployment secret store. Never commit real credentials, print them, or return them to Telegram clients. Update `.env.example` only with safe placeholders and documented non-secret settings.
- Keep user-facing text, prompts, locale, currency, time zone, and transaction cues in configuration files rather than embedding them in use cases.
- Do not add mutable global state or singleton clients. Pass dependencies through constructors or use-case arguments so tests can replace them.

## Security and ownership

- Authenticate bot-to-API requests with the configured service credential. Treat that as service authentication, separate from identifying the Telegram user.
- Resolve the transaction owner only from the validated Telegram identity and its internal user association. Never accept an owner ID from a body, query, or other client-controlled transaction data.
- Apply owner scoping to every transaction read or mutation, including lookup, update, delete, and pagination.

## Tests and commands

Use pnpm for package management and scripts. Add or update Vitest unit tests for both successful behavior and relevant invalid-input, authorization, provider, and persistence failures. Keep unit tests deterministic: stub network and database boundaries instead of calling real services.

Common commands:

```sh
pnpm install
pnpm dev
pnpm test
pnpm build
pnpm start
```

Keep tests next to the code they cover as `*.test.ts`. Do not add a dependency when the platform or existing packages already solve the problem.

## Logging

- Inject the `Logger` interface; do not add ad hoc `console.log` calls or a global logger. The production adapter emits one JSON object per line and uses `LOG_LEVEL` to control verbosity.
- Use stable event names and include only operational context needed to trace outcomes, such as update ID, operation, duration, HTTP status, error code, and item count.
- Never log credentials, authorization headers, Telegram user/chat IDs, internal owner or transaction IDs, transaction text or fields, prompts, or model output. Log outcome categories instead of personal or financial data.
- Log meaningful lifecycle events and failures at the appropriate level. Avoid logging the same successful action repeatedly at `info`; use `debug` for routine internal steps.

## Documentation and code changes

Write technical documentation, comments, and documentation comments in English. Explain user-visible behavior and important constraints before implementation details. Keep changes within the existing layer structure and update callers, tests, configuration examples, and docs affected by a change.
