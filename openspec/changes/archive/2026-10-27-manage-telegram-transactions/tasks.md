## 1. Backend foundation

- [x] 1.1 Set up Express, TypeScript ESM, Vitest, and the presentation/service/domain/infrastructure module boundaries; verify the app starts and the test runner discovers a passing unit test.
- [x] 1.2 Add validated configuration for Supabase, Telegram, the language model provider/model, prompts, pre-check cues, messages, currency, locale/timezone, and pagination limits; verify startup rejects missing or invalid required settings and no secrets/default messages are embedded in handlers.
- [x] 1.3 Add shared Zod request schemas and centralized HTTP error mapping; verify unit tests cover valid input and validation, authentication, not-found, provider, and persistence error responses without leaking internal details.

## 2. Transaction domain and persistence

- [x] 2.1 Define transaction types, exact decimal amount rules, optional description fallback, immutable owner and registration timestamp rules; verify unit tests cover valid creation and every invalid-field case.
- [x] 2.2 Create the Supabase migration for owner-scoped transactions, UTC registration timestamp, exact numeric amount, and unique Telegram update identifier; verify the migration applies against Supabase local and enforces the intended constraints.
- [x] 2.3 Implement the transaction repository with owner-scoped create, update, delete, and paginated query operations; verify unit tests cover successful persistence, database errors, owner isolation, stable ordering, and duplicate update IDs.
- [x] 2.4 Implement transaction use cases and owner-context checks; verify unit tests cover create, edit, delete, list, invalid data, missing/foreign records, and persistence failures.
- [x] 2.5 Add the internal users table and migrate transaction ownership to a user UUID foreign key; verify the local migration succeeds and refuses to discard existing transactions.

## 3. HTTP transaction API

- [x] 3.1 Add `POST /api/transactions`, `PATCH /api/transactions/:id`, `DELETE /api/transactions/:id`, and `GET /api/transactions` handlers with Zod validation; verify handler tests cover success and error responses for every route.
- [x] 3.2 Require a backend-only service bearer credential, then resolve the validated Telegram sender ID to an internal user UUID; verify missing credentials fail before database access and missing associations are rejected.
- [x] 3.3 Implement configured page defaults/maximums and deterministic newest-first ordering; verify unit tests cover valid pages, invalid parameters, and isolation between owners.

## 4. Telegram transaction capture

- [x] 4.1 Add an authenticated Telegram webhook adapter that normalizes update ID, sender ID, chat ID, and text; verify tests cover accepted text, rejected webhook authentication, and unsupported update types.
- [x] 4.2 Implement the configurable transaction cue pre-check and provider-neutral extraction contract with the configured DeepSeek adapter; verify tests prove non-matching text skips the provider and matching text reaches it.
- [x] 4.3 Validate model output and call the transaction use case only for valid type and positive amount; verify tests cover valid extraction, missing fields, malformed output, provider timeout, and no persistence on failure.
- [x] 4.4 Add configured Telegram replies for success, usage guidance, and temporary failures, formatting the amount and server timestamp with configured currency/locale; verify tests assert each reply and that success follows persistence.
- [x] 4.5 Enforce update-ID idempotency through the database uniqueness constraint; verify tests simulate duplicate and concurrent delivery and confirm at most one transaction is created.
- [x] 4.6 Add a server-side bot API client that sends the service credential and validated Telegram sender ID separately; verify secrets never appear in Telegram payloads, responses, or logs.

## 5. End-to-end readiness

- [x] 5.1 Add deployment and local Supabase configuration documentation, including required environment variables, backend service credential handling, user association provisioning, and webhook setup; verify documented settings match startup validation and local/cloud environments.
- [x] 5.2 Review every domain/service function for unit coverage of success and failure paths, and run the full Vitest suite; verify all required behavior scenarios in both capability specs have corresponding tests.
- [x] 5.3 Verify the API accepts only authenticated bot service calls, derives owners from valid Telegram associations, and scopes every operation; verify unknown or cross-owner requests cannot access transaction data.
