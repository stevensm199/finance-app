## Why

Users should be able to record a transaction by speaking to the Telegram bot when typing is inconvenient. Audio must enter the same transaction validation and ownership flow as text, while rejecting unsupported or costly input before transcription.

## What Changes

- Accept Telegram voice notes and audio messages, validate their metadata and size, then transcribe eligible files with Groq Whisper.
- Run download, transcription, and transaction capture through a persistent background queue so webhook handling can acknowledge accepted work without waiting for the language model.
- Send the resulting transcript through the existing transaction cue check, extraction, persistence, and reply flow.
- Reject overlong, oversized, unsupported, empty, and speech-free audio with configured responses; retry transient provider failures without creating duplicate transactions.
- Add configurable Groq credentials/model and audio processing limits, plus safe lifecycle logs.

## Capabilities

### New Capabilities
- `telegram-audio-capture`: Validate Telegram audio, queue work, transcribe eligible audio, and pass speech through transaction capture.

### Modified Capabilities
- `telegram-transaction-capture`: Allow authenticated audio updates to reach the existing text transaction capture flow after transcription.

## Impact

- Telegram update parsing and webhook processing in `src/presentation/telegram` and `src/service`.
- Telegram file download and Groq transcription adapters in `src/infrastructure`.
- Supabase schema and repository support for queued audio jobs, including a migration and worker lifecycle.
- Environment and message configuration, logging, and unit tests.
- Existing `groq-sdk` dependency and `speech_to_text.js` reference; no new runtime provider is required.
