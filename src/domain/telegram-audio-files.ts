export interface TelegramAudioFileGateway {
  getFile(fileId: string): Promise<{ filePath: string; fileSize?: number }>;
  download(filePath: string, maxBytes: number): Promise<Buffer>;
}
