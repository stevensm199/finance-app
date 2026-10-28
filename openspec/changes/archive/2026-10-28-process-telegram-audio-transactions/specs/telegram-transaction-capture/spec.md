## MODIFIED Requirements

### Requirement: Accept trusted Telegram updates
The system MUST accept transaction text and supported audio only from authenticated Telegram webhook updates. After webhook authentication, it MUST pass the sender identity to the server-side bot API client, which authenticates with the service credential. The transaction API MUST resolve that Telegram identity to a pre-existing internal user association; the raw sender identifier is not itself the transaction owner.

#### Scenario: Receive a valid Telegram message with an associated user
- **WHEN** Telegram delivers an authenticated text message whose sender has a valid internal user association
- **THEN** the system processes it under the associated internal owner identifier

#### Scenario: Receive supported Telegram audio with an associated user
- **WHEN** Telegram delivers an authenticated supported voice note or audio message whose sender has a valid internal user association
- **THEN** the system transcribes the audio and processes its text under the associated internal owner identifier

#### Scenario: Reject an unauthenticated update
- **WHEN** a webhook request does not pass the configured Telegram authentication check
- **THEN** the system rejects it without invoking the language model or changing transaction data

#### Scenario: Ignore unsupported update content
- **WHEN** an authenticated update does not contain supported text or audio content
- **THEN** the system does not create a transaction and responds according to the configured unsupported-message behavior

#### Scenario: Reject a Telegram sender without an association
- **WHEN** an authenticated Telegram sender has no valid internal user association
- **THEN** the system creates no transaction and responds with the configured unlinked-account message
