export interface AudioTranscriptionSegment {
  start: number;
  end: number;
  text: string;
  noSpeechProbability?: number;
}

export interface AudioTranscription {
  text: string;
  durationSeconds?: number;
  segments: AudioTranscriptionSegment[];
}

export interface AudioTranscriber {
  transcribe(audio: Uint8Array, fileName: string): Promise<AudioTranscription>;
}
