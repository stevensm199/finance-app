## Context

The repository contains only the default OpenSpec configuration, so this change starts a greenfield backend. See `proposal.md` for motivation and the capability specs for observable behavior. The requested runtime is Express, TypeScript with ECMAScript Modules (ESM), Supabase, Zod, Vitest, Telegram, and a DeepSeek model described as “Flash.” CRUD calls are restricted to the backend bot; the exact DeepSeek model identifier remains a deployment setting.

## Goals / Non-Goals

**Goals:**
- Keep transaction rules independent of Express, Supabase, Telegram, and any language model provider.
- Make service authentication, Telegram-to-user association, owner scoping, server timestamps, exact money values, validation, and duplicate webhook handling explicit.
- Allow provider credentials, model identifier, prompt, pre-check cues, currency, locale, pagination limits, and user-facing messages to change through deployment configuration.

**Non-Goals:**
- User registration, a web interface, budgets, recurring transactions, attachments, multi-currency conversion, or analytics.
- Guaranteeing exactly-once delivery of Telegram replies; external network delivery cannot be made atomic with a database commit.
- Selecting an unspecified external identity provider or guessing the exact DeepSeek model identifier.

## Decisions

### Layer dependencies

Use four layers with dependencies pointing inward: presentation handles HTTP and Telegram payloads; service coordinates use cases; domain owns transaction rules and provider-neutral contracts; infrastructure implements the contracts with Supabase, Telegram, and the configured language model provider. Express handlers and webhook adapters validate untrusted input with Zod, map it to use-case inputs, and translate outcomes through a centralized error handler. The service layer does not import provider SDKs. This keeps a future WhatsApp adapter or language model replacement from changing domain behavior.

### Service authentication and owner identity

Require a server-only `BOT_SERVICE_TOKEN` of at least 32 characters in the `Authorization: Bearer` header for CRUD calls. Validate the token in middleware with a constant-time comparison and fail closed when it is missing or invalid. The configured bot API URL MUST use HTTPS outside localhost, and the HTTP client MUST reject redirects so the credential cannot be forwarded to another host. The Telegram webhook adapter authenticates Telegram's webhook secret before reading the sender ID, then the bot API client passes that validated Telegram ID in a separate `X-Telegram-User-Id` header. After authenticating the service, the API looks up that ID in an internal `users` association table and puts only the associated internal UUID in trusted request context. A missing association is rejected; there is no automatic account creation. Do not accept an owner ID from request bodies or query parameters. The bot token is never sent to Telegram users or logged. Future web authentication can add a different identity middleware that supplies the same internal owner ID without changing transaction use cases.

### Transaction data and timestamps

Use a Supabase/PostgreSQL `users` table with an internal UUID and unique Telegram user ID, and a transaction table with an `owner_id` foreign key to `users.id`, type, description, exact decimal amount, and canonical UTC registration timestamp (`timestamptz`). User associations are provisioned out of band for this MVP; the transaction API does not register users. Use a database `numeric` column for amounts and decimal strings at JSON boundaries to avoid binary floating-point rounding. Keep currency deployment-wide for this initial scope because the requested schema has no currency field; do not imply currency conversion. Render the canonical timestamp as date and time in the configured timezone/locale. The database clock sets the timestamp; clients and the language model cannot set it.

### HTTP API and pagination

Expose `POST /api/transactions`, `PATCH /api/transactions/:id`, `DELETE /api/transactions/:id`, and `GET /api/transactions` only to the authenticated backend bot service. Use `page` and `pageSize` query parameters with defaults and maximums from configuration. Return newest registration timestamp first and transaction ID as a stable tie-breaker. Scope every query and mutation by the internal owner UUID. Return the same not-found response for a missing transaction and one owned by someone else to avoid confirming another user's data exists.

### Telegram extraction and idempotency

Expose a Telegram webhook route that checks Telegram's configured webhook secret before processing. Normalize the sender ID and message text into a provider-neutral intake request. Run configured keyword cues as a cheap pre-check, then call the configured language model adapter only for likely transaction messages. Treat model output as untrusted structured data and validate it with Zod/domain rules before calling the create use case. Keep the initial adapter configured for the user's selected DeepSeek “Flash” model, with the exact provider model name supplied as configuration.

Persist the Telegram update identifier with the resulting transaction, pass it as an `Idempotency-Key` header, and enforce uniqueness in the database. This prevents concurrent webhook retries from creating duplicate transactions while allowing a retry after failure before persistence. A database commit and Telegram reply cannot be one atomic operation: retrying a reply may produce a repeated confirmation, but must not create another transaction.

### Errors, configuration, and messages

Use one error middleware to map validation, service authentication, user association, not-found, provider, and persistence failures to stable HTTP responses without exposing stack traces or credentials. The Telegram adapter chooses configured messages for usage help, unlinked accounts, temporary provider/database failures, unsupported input, and success. Load secrets from the deployment environment and non-secret behavior settings from validated configuration; fail startup when required settings are missing or invalid. Do not print message bodies, credentials, or complete provider responses in logs.

### Tests

Use Vitest unit tests around domain rules and service flows, with fake repositories and fake Telegram/model adapters. Cover each success and failure scenario in the specs, including invalid model output, provider/database failure, owner mismatch, pagination validation, and duplicate update IDs. Keep external services out of unit tests; integration checks for Supabase local, Telegram, and the live model are separate and outside the unit-test requirement.

## Risks / Trade-offs

- [The bot service credential grants access to all bot API routes] → Keep it only in backend environment configuration, use HTTPS outside local development, compare it safely, and rotate it through deployment secrets.
- [A Telegram sender can exist without an internal user association] → Reject the operation before transaction access and provision associations out of band.
- [The model may misread natural language or return invalid data] → Validate every extracted field and never persist until required fields pass domain validation.
- [Keyword pre-checks can miss valid phrasing] → Keep cues configurable, test expected Spanish phrases, and return a correction prompt without spending a model request.
- [Telegram may retry after the database commit but before a reply is delivered] → Enforce uniqueness on the update identifier; duplicate replies remain possible.
- [One configured currency does not cover multi-currency users] → Make currency explicit in configuration and add a transaction currency field only when multi-currency behavior is required.

## Migration Plan

This is a greenfield backend, so no existing application clients or transaction records need migration. Create the internal user association table and owner-scoped transaction schema, provision Telegram-to-user associations, configure the service credential in backend-only environment secrets, and configure local development against Supabase local. Rollback consists of disabling the webhook/API deployment; if transactions have already been recorded, retain the table and data unless an explicit data-retention decision says otherwise.

## Open Questions

- Which exact DeepSeek model/API identifier is meant by “DeepSeek Flash” in the deployment?
- Is the initial configured currency COP, and what timezone should format the displayed registration date and time?
