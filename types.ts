
export interface SubtitleEntry {
  id: number;
  startTime: string;
  endTime: string;
  text: string;
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface FileTask {
  id: string;
  fileName: string;
  originalSubs: SubtitleEntry[];
  processedSubs: SubtitleEntry[];
  prompt: string;
  status: ProcessingStatus;
  progress: number;
  error?: string;
}
