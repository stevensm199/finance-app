## Context

See [proposal.md](proposal.md) for the motivation and [the change specs](specs/telegram-audio-capture/spec.md) for behavior. The webhook currently validates a Telegram update and awaits `processTelegramUpdate`; that use case only accepts text. The project already has `groq-sdk`, an environment-based configuration schema, configured user messages, Supabase migrations, and an audio transcription example in `speech_to_text.js`.

## Goals / Non-Goals

**Goals:**
- Accept Telegram voice notes and audio messages, reject unsuitable media before Groq, and send usable speech through existing transaction capture.
- Acknowledge accepted webhook updates promptly while preserving audio work across process restarts.
- Keep audio credentials, file metadata, and user data out of logs and Telegram responses.

**Non-Goals:**
- Accept audio sent as a generic Telegram document, video, or other media type.
- Store audio binaries or transcripts after processing.
- Run CPU-heavy audio conversion or build a general-purpose job platform.

## Decisions

### Use a durable Supabase job queue and an async worker loop

Add a `telegram_audio_jobs` table keyed uniquely by Telegram `update_id`. Persist only the file reference and the chat/sender data required to fetch and process an accepted update; do not persist the binary audio. The webhook writes the job before sending the configured processing receipt, claims a short receipt lease so concurrent redeliveries do not send the same notice, marks that receipt as delivered, then acknowledges the update. The worker claims only jobs whose receipt has been marked delivered, avoiding a race where the final result arrives before the processing notice. A background loop claims jobs using a database function with an expiring lease and row locking, so pending work can resume after a restart and two server instances cannot claim the same job at once. Use bounded attempts with backoff for transient download/provider failures; terminal failures send configured replies. A successful job sends the existing transaction summary only after persistence succeeds. Keep the update key for a configured deduplication period, and clear file and identity metadata once a job is terminal.

The work is dominated by Telegram and Groq network I/O. Node's async I/O keeps the event loop responsive, so a `worker_threads` worker adds complexity without making those requests non-blocking. A durable queue also avoids losing accepted updates if the server restarts, unlike an in-memory promise queue.

### Validate before downloading and again before transcription

Accept only Telegram `voice` and `audio` message objects. Reject duration over 30 seconds using Telegram's duration metadata before `getFile` or Groq. Resolve file size from update metadata or Telegram `getFile` and enforce the configured maximum before downloading. Limit formats to those supported by Groq transcription and verify the downloaded content signature before upload. Telegram's cloud Bot API currently limits bot downloads to 20 MB, so validation must prevent the configured size limit from exceeding that transport limit. [Telegram `getFile`](https://core.telegram.org/bots/api#getfile)

Groq currently documents `flac`, `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `ogg`, `wav`, and `webm` for transcription, with a 25 MB free-tier request limit. Telegram's lower download limit therefore controls the default file cap. [Groq speech-to-text documentation](https://console.groq.com/docs/speech-to-text)

### Transcribe in the spoken language, then reuse the text pipeline

Use the existing `groq-sdk` with the transcription endpoint and configured `whisper-large-v3-turbo` model by default. Do not use the translation endpoint or force English: the transcript must remain in the user's spoken language so the existing cues and transaction extractor can process it. Request `verbose_json` and reject empty transcripts or segments that indicate no speech using a configurable confidence threshold. Audio over the limit according to transcript timestamps is rejected as a defense-in-depth check, although Telegram duration metadata is the pre-transcription cost guard.

The worker passes accepted transcript text and the original `update_id` into the existing capture use case. This preserves cue filtering, DeepSeek extraction, owner resolution in the transaction API, transaction validation, idempotency, and localized success replies without coupling those rules to audio formats.

### Keep new limits and messages configurable

Add validated environment settings for `GROQ_API_KEY`, transcription model, maximum duration, maximum file size, speech threshold, queue polling, retry attempts, and deduplication retention. Add configured messages for queued, too-long, unsupported/oversized, no-speech, and exhausted-failure outcomes. Never log or return the Groq key, Telegram file URL, sender/chat ID, file ID, audio bytes, transcript, or transaction data.

## Risks / Trade-offs

- [Audio job rows contain temporary Telegram identifiers and file references] → Restrict table access to the service role, clear processing fields at terminal state, and delete deduplication rows after the configured window.
- [Whisper may mistake noise for speech or omit useful confidence metadata] → Reject empty output and no-speech segments before transaction extraction; cue filtering and structured extraction remain additional checks.
- [A queued job may outlive the Telegram download URL] → Persist Telegram `file_id`, not a download URL, and call `getFile` when the worker claims the job.
- [A transient Telegram send failure can leave a terminal job without a user reply] → Log a safe terminal error and allow bounded reply retry without rerunning transcription or transaction creation.
- [A 30-second limit depends first on Telegram-provided duration] → Validate returned transcription timestamps too; no audio is sent to Groq when the trusted webhook metadata already exceeds the bound.

## Migration Plan

1. Apply the Supabase migration adding the job table, claim/cleanup functions, indexes, and service-role-only permissions in local and production environments.
2. Configure the Groq API key and audio/worker limits before deploying the application version that starts the worker.
3. Roll back by disabling the audio worker and webhook audio acceptance, then revert the database migration only after pending jobs are drained or intentionally discarded. Text transaction processing remains available throughout.
