## Purpose

Defines how Telegram messages become transactions, including inexpensive input filtering, language model extraction, safe persistence, duplicate delivery handling, and useful replies when a message cannot be recorded.

## ADDED Requirements

### Requirement: Accept trusted Telegram updates
The system MUST accept transaction messages only from authenticated Telegram webhook updates. After webhook authentication, it MUST pass the sender identity to the server-side bot API client, which authenticates with the service credential. The transaction API MUST resolve that Telegram identity to a pre-existing internal user association; the raw sender identifier is not itself the transaction owner.

#### Scenario: Receive a valid Telegram message with an associated user
- **WHEN** Telegram delivers an authenticated text message whose sender has a valid internal user association
- **THEN** the system processes it under the associated internal owner identifier

#### Scenario: Reject an unauthenticated update
- **WHEN** a webhook request does not pass the configured Telegram authentication check
- **THEN** the system rejects it without invoking the language model or changing transaction data

#### Scenario: Ignore unsupported update content
- **WHEN** an authenticated update does not contain a supported text message
- **THEN** the system does not create a transaction and responds according to the configured unsupported-message behavior

#### Scenario: Reject a Telegram sender without an association
- **WHEN** an authenticated Telegram sender has no valid internal user association
- **THEN** the system creates no transaction and responds with the configured unlinked-account message

### Requirement: Filter likely transaction text before extraction
The system MUST apply a configurable, inexpensive text pre-check before calling the language model. Text that does not pass the pre-check MUST NOT invoke the language model and MUST receive the configured transaction usage guidance. The pre-check MUST NOT itself create or change transactions.

#### Scenario: Text does not look like a transaction
- **WHEN** a message does not match configured transaction cues
- **THEN** the system skips the language model, stores nothing, and replies with the configured usage guidance

#### Scenario: Text passes the pre-check
- **WHEN** a message matches configured transaction cues
- **THEN** the system sends the text to the configured language model adapter for extraction

### Requirement: Extract and validate transaction details
The system MUST require the language model result to identify a supported transaction type and a positive amount. Description may be omitted, in which case it defaults to the transaction type. The system MUST validate the extracted structured result before persistence and MUST NOT treat model output as trusted input.

#### Scenario: Valid extraction
- **WHEN** the language model returns a valid type and positive amount, with or without a description
- **THEN** the system validates the fields and creates one transaction with server-assigned UTC registration time

#### Scenario: Insufficient or malformed extraction
- **WHEN** the language model cannot identify required fields or returns an invalid structured result
- **THEN** the system stores nothing and replies with configured guidance showing how to describe a transaction

#### Scenario: Language model unavailable
- **WHEN** the configured language model provider fails or times out
- **THEN** the system stores nothing and replies with a configured temporary-failure message

### Requirement: Confirm successful registration
After a transaction is persisted, the system MUST reply to the originating Telegram chat with a summary containing its type, description, and amount formatted using configured locale and currency settings. The success reply MUST NOT be sent before persistence succeeds.

#### Scenario: Transaction is stored successfully
- **WHEN** a valid extraction is persisted
- **THEN** the user receives a localized success summary for that transaction

#### Scenario: Database persistence fails
- **WHEN** a valid extraction cannot be persisted
- **THEN** the system does not send a success reply and returns or sends the configured failure response

### Requirement: Handle duplicate Telegram deliveries safely
The system MUST pass the Telegram update identifier as an idempotency key on transaction creation and make repeated or concurrent delivery of the same update safe. A previously processed update MUST NOT create a second transaction.

#### Scenario: Telegram retries a processed update
- **WHEN** Telegram delivers an update identifier that has already been processed successfully
- **THEN** the system does not create another transaction and acknowledges or repeats the prior result according to the configured retry behavior

#### Scenario: Telegram concurrently delivers the same update
- **WHEN** the same authenticated Telegram update reaches transaction creation concurrently
- **THEN** the system persists at most one transaction and returns the existing transaction for duplicate requests

#### Scenario: Processing previously failed
- **WHEN** processing an update failed before a transaction was persisted
- **THEN** a retry MUST NOT be mistaken for a successfully completed transaction and MUST NOT create duplicate records

### Requirement: Keep provider and user-facing settings replaceable
The system MUST obtain provider credentials, model selection, prompts, pre-check cues, locale, currency, and user-facing messages from configuration. Transaction behavior MUST depend on a provider-neutral language model contract so a provider can be replaced without changing domain transaction rules.

#### Scenario: Change language model provider
- **WHEN** deployment configuration selects another provider implementing the extraction contract
- **THEN** transaction validation, ownership, and persistence behavior remain unchanged

#### Scenario: Change reply language or wording
- **WHEN** configured user-facing messages or locale are changed
- **THEN** replies use the new settings without changing transaction ownership or parsing rules

### Requirement: Keep service credentials inside the backend
The bot API client MUST load the service credential from backend environment configuration and include it only in server-to-server authorization headers. It MUST NOT include that credential in Telegram messages, webhook responses, or logs.

#### Scenario: Make an authenticated bot API call
- **WHEN** the bot backend calls a transaction endpoint
- **THEN** it sends the configured service credential in the authorization header and the validated Telegram sender identity separately

#### Scenario: Protect the credential from Telegram users
- **WHEN** the bot sends a transaction reply or handles a webhook response
- **THEN** no service credential is present in the message, response body, or logged data
