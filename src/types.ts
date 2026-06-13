export type WebcamPosition =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left";
export type WebcamShape = "circle" | "rounded";

export interface Segment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface Chapter {
  title: string;
  startMs: number;
}

export type RecordingStatus = "ready" | "transcribing" | "chaptering" | "failed";

export interface RecordingRecord {
  id: string;
  title: string;
  createdAt: number;
  durationMs: number;
  mimeType: string;
  resolution: string;
  blob: Blob;
  webcamBlob: Blob | null;
  webcamMimeType: string | null;
  /** Webcam recorder start time minus screen recorder start time, in ms. */
  webcamOffsetMs: number | null;
  webcamPosition: WebcamPosition;
  webcamShape: WebcamShape;
  status: RecordingStatus;
  statusError?: string;
  segments?: Segment[];
  chapters?: Chapter[];
  summary?: string;
  language?: string;
}
