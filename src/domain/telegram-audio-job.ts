export type TelegramAudioJobStatus = 'queued' | 'processing' | 'retry' | 'reply_pending' | 'completed' | 'failed';

export interface NewTelegramAudioJob {
  updateId: number;
  telegramFileId: string;
  telegramUserId: string;
  chatId: number;
  durationSeconds: number;
  fileSizeBytes: number;
  mimeType?: string;
  fileName?: string;
  deduplicateUntil: string;
}

export interface TelegramAudioJob {
  updateId: number;
  telegramFileId: string;
  telegramUserId: string;
  chatId: number;
  durationSeconds: number;
  fileSizeBytes: number;
  mimeType: string | null;
  fileName: string | null;
  deduplicateUntil: string;
  status: TelegramAudioJobStatus;
  attemptCount: number;
  replyAttemptCount: number;
  outboundMessage: string | null;
  outboundType: string | null;
  lastErrorCode: string | null;
}
