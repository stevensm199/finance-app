## Purpose

Lets a Telegram user record a transaction by sending a short voice note or audio message. Eligible speech is transcribed and handled using the existing transaction capture rules, with limits that prevent unsupported, oversized, or speech-free files from reaching transaction extraction.

## ADDED Requirements

### Requirement: Accept supported Telegram audio
The system MUST accept Telegram voice notes and audio messages from authenticated webhook updates when the sender and chat are present. Audio documents and other media types are unsupported unless explicitly added later.

#### Scenario: Receive a voice note
- **WHEN** Telegram delivers an authenticated voice note with a sender and chat
- **THEN** the system validates its duration, size, and supported audio format before queueing it

#### Scenario: Receive an audio message
- **WHEN** Telegram delivers an authenticated audio message with a sender and chat
- **THEN** the system validates its duration, size, and supported audio format before queueing it

#### Scenario: Reject unsupported media
- **WHEN** Telegram delivers an audio document, a different media type, or audio in an unsupported format
- **THEN** the system does not queue or transcribe it and sends the configured unsupported-audio guidance

### Requirement: Enforce audio duration, size, and format limits before transcription
The system MUST reject audio with a declared duration greater than 30 seconds, missing or invalid duration metadata, a resolved file size greater than the configured limit, missing or invalid size metadata, or a format outside the configured supported formats. File size MUST be resolved from the Telegram update or `getFile` metadata before downloading. The configured size limit MUST NOT exceed Telegram's cloud bot download limit. The system MUST verify the downloaded file's actual format before submitting it to transcription. Rejected files MUST NOT be sent to Groq.

#### Scenario: Reject audio longer than the limit
- **WHEN** Telegram reports that audio duration exceeds 30 seconds
- **THEN** the system sends the configured duration guidance without downloading or transcribing the file

#### Scenario: Reject invalid or oversized audio metadata
- **WHEN** duration is missing or invalid, or resolved file size is missing, invalid, or exceeds its configured bound
- **THEN** the system sends the configured audio validation guidance and does not download or call Groq

#### Scenario: Reject a file whose actual format is not allowed
- **WHEN** the downloaded content does not match a supported audio format
- **THEN** the system does not submit the content to Groq and sends the configured unsupported-audio guidance

#### Scenario: Accept valid short audio
- **WHEN** declared metadata and downloaded content meet the configured duration, size, and format limits
- **THEN** the system submits the file once to the configured Groq transcription model

### Requirement: Transcribe speech before transaction extraction
The system MUST transcribe eligible audio in its spoken language. It MUST reject empty transcripts and audio that the transcription result identifies as having no speech. It MUST NOT send rejected or empty transcripts to the transaction language model. A non-empty transcript MUST enter the existing transaction cue check and extraction flow unchanged.

#### Scenario: Transcribe speech and capture a transaction
- **WHEN** eligible audio contains speech describing a transaction and transcription returns usable text
- **THEN** the system passes the transcript through the existing cue check, transaction extraction, owner authorization, persistence, and success reply flow

#### Scenario: Audio contains no speech
- **WHEN** the transcription result is empty or identifies the audio as speech-free
- **THEN** the system stores no transaction, skips transaction extraction, and sends the configured no-speech guidance

#### Scenario: Speech does not describe a transaction
- **WHEN** eligible audio produces a transcript that does not pass the existing transaction cue check
- **THEN** the system does not call the transaction language model or store a transaction and sends the configured usage guidance

#### Scenario: Transcription provider fails
- **WHEN** Groq fails or times out while transcribing eligible audio
- **THEN** the system retries according to the configured worker policy and, after retries are exhausted, stores no transaction and sends the configured temporary-failure guidance

### Requirement: Process accepted audio asynchronously and safely
The system MUST persist accepted audio work before acknowledging the webhook, and a background worker MUST process it without keeping the webhook request open for transcription. Each Telegram update MUST be queued at most once. Worker processing MUST be retryable after transient failures and MUST use the Telegram update identifier as the transaction idempotency key.

#### Scenario: Acknowledge queued audio
- **WHEN** valid audio is accepted and its job is durably queued
- **THEN** the webhook responds successfully without waiting for download, transcription, or transaction extraction

#### Scenario: Queue persistence fails
- **WHEN** the system cannot persist an accepted audio job
- **THEN** it does not acknowledge the webhook as accepted, allowing Telegram to retry delivery

#### Scenario: Telegram redelivers a queued update
- **WHEN** Telegram delivers the same update identifier more than once
- **THEN** the system reuses the existing job and does not queue duplicate transcription work

#### Scenario: Worker restarts with pending jobs
- **WHEN** the worker restarts while audio jobs are pending
- **THEN** it resumes eligible jobs without losing the accepted Telegram update

#### Scenario: Transient worker failure
- **WHEN** a download or provider request fails temporarily
- **THEN** the worker retries within a configured bounded attempt policy and does not create duplicate transactions

### Requirement: Notify the user about audio processing and its result
After an audio job is durably queued, the system MUST send the user a configured receipt that processing has started. When processing finishes, it MUST send the same configured outcome messages used by text capture: a transaction summary only after persistence succeeds, or the appropriate configured guidance when no transaction is created.

#### Scenario: Audio is accepted for processing
- **WHEN** valid audio is durably queued
- **THEN** the bot sends the configured audio-processing receipt while the webhook acknowledges the update

#### Scenario: Audio describes a valid transaction
- **WHEN** transcription and transaction extraction produce a valid transaction and persistence succeeds
- **THEN** the bot sends the configured transaction summary after the transaction is stored

#### Scenario: Audio does not produce a transaction
- **WHEN** audio has no speech, its transcript does not describe a transaction, or it fails terminal processing
- **THEN** the bot sends the corresponding configured no-speech, usage, or temporary-failure guidance without reporting a successful transaction

### Requirement: Protect audio data and credentials
The system MUST keep Groq credentials server-side and MUST NOT log or expose credentials, Telegram user/chat identifiers, audio file identifiers, raw audio, transcripts, prompts, or financial transaction details. Persisted audio job metadata MUST be removed when it is no longer needed for processing and retry deduplication.

#### Scenario: Complete or reject an audio job
- **WHEN** an audio job reaches a terminal outcome
- **THEN** the system removes stored file and identity metadata according to the configured retention policy while preserving update deduplication for the retry window

#### Scenario: Record operational logs
- **WHEN** the system logs audio processing activity
- **THEN** it records safe operational fields such as update ID, processing stage, duration, attempt number, and outcome without sensitive payload data
