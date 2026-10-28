## Why

The finance app needs a reliable backend foundation for recording and managing personal transactions through Telegram. Defining ownership, parsing failures, and persistence behavior before implementation will protect each user's data and make it possible to change the messaging or language model provider without changing the transaction rules.

## What Changes

- Add transaction create, update, delete, and paginated list operations, scoped to the authenticated or Telegram-derived owner.
- Authenticate CRUD calls with a server-only bot service credential and resolve the validated Telegram sender through an internal user association before choosing the transaction owner.
- Add Telegram message intake that filters likely transaction messages, extracts transaction fields through a replaceable language model provider, persists valid transactions, and replies with a localized summary or usage guidance.
- Specify validation, error handling, timestamps, money representation, pagination, and behavior when database or language model calls fail.
- Define a layered Express and TypeScript ESM backend using Supabase, Zod, and Vitest, with messages, prompts, provider settings, and secrets supplied through configuration rather than hard-coded values.
- Require unit tests for successful and unsuccessful behavior in the transaction and Telegram intake flows.

## Capabilities

### New Capabilities
- `transaction-management`: Owner-scoped transaction CRUD and paginated retrieval.
- `telegram-transaction-capture`: Telegram message parsing, transaction creation, and user-facing replies.

### Modified Capabilities

## Impact

- New backend modules across presentation, service, domain, and infrastructure layers; there is no existing application code in this repository.
- Supabase local and cloud environments, a Telegram bot webhook, a server-to-server bot API client, and a DeepSeek language model adapter.
- Configuration for database, Telegram, language model, locale, prompts, and user-facing messages. Provider-specific details must stay behind adapters.
- Unit test coverage using Vitest. No existing API consumers or stored data need migration in this greenfield repository.
