/**
 * Capture engine.
 *
 * Screen + (optional) mic are mixed via Web Audio into one MediaStream and
 * recorded with one MediaRecorder. The webcam, when enabled, is captured as a
 * video-only track and recorded with its own MediaRecorder — no canvas
 * compositing during capture. The two recorders' start skew is stored as
 * webcamOffsetMs; playback slaves the webcam clock to the main video (see
 * Playback page), which also corrects drift over long sessions.
 */

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

export function browserSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    pickMimeType() !== null
  );
}

export interface QualityPreset {
  label: string;
  width: number;
  height: number;
  bitsPerSecond: number;
  warn?: boolean;
}

export const QUALITY_PRESETS: Record<string, QualityPreset> = {
  "720p": { label: "720p", width: 1280, height: 720, bitsPerSecond: 5_000_000 },
  "1080p": { label: "1080p", width: 1920, height: 1080, bitsPerSecond: 8_000_000 },
  "1440p": { label: "1440p", width: 2560, height: 1440, bitsPerSecond: 16_000_000 },
  "4K": { label: "4K", width: 3840, height: 2160, bitsPerSecond: 40_000_000, warn: true },
};

export interface CaptureOptions {
  quality: keyof typeof QUALITY_PRESETS;
  frameRate: 30 | 60;
  mic: boolean;
  webcam: boolean;
  webcamDeviceId?: string;
}

export interface CaptureResult {
  screenBlob: Blob;
  mimeType: string;
  webcamBlob: Blob | null;
  webcamMimeType: string | null;
  webcamOffsetMs: number | null;
  durationMs: number;
  resolution: string;
  micGranted: boolean;
  systemAudioCaptured: boolean;
}

interface SessionEvents {
  onTick?: (elapsedMs: number) => void;
  /** Fired when the user hits the browser's native "Stop sharing". */
  onSurfaceEnded?: () => void;
}

export class CaptureSession {
  private displayStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private camStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private screenRecorder: MediaRecorder | null = null;
  private camRecorder: MediaRecorder | null = null;
  private screenChunks: Blob[] = [];
  private camChunks: Blob[] = [];
  private mimeType = "";
  private webcamOffsetMs: number | null = null;
  private startedAt = 0;
  private accumulatedMs = 0; // elapsed excluding pauses
  private pausedAt: number | null = null;
  private ticker: number | null = null;
  private stopped = false;
  private micGranted = false;
  private systemAudioCaptured = false;
  paused = false;

  constructor(
    private opts: CaptureOptions,
    private events: SessionEvents = {},
  ) {}

  /** Acquire all streams. Throws if screen capture itself is refused. */
  async acquire(): Promise<{ micDenied: boolean; camDenied: boolean }> {
    const preset = QUALITY_PRESETS[this.opts.quality];
    this.displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: this.opts.frameRate },
        width: { ideal: preset.width },
        height: { ideal: preset.height },
      },
      audio: true, // tab/system audio where the browser supports it
    });

    let micDenied = false;
    if (this.opts.mic) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        this.micGranted = true;
      } catch {
        micDenied = true; // partial denial: keep going without mic
      }
    }

    let camDenied = false;
    if (this.opts.webcam) {
      try {
        this.camStream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: this.opts.webcamDeviceId
              ? { exact: this.opts.webcamDeviceId }
              : undefined,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false, // mic audio lives only in the main mix
        });
      } catch {
        camDenied = true; // partial denial: record without the bubble
      }
    }
    return { micDenied, camDenied };
  }

  start(): void {
    if (!this.displayStream) throw new Error("acquire() must succeed first");
    const mime = pickMimeType();
    if (!mime) throw new Error("MediaRecorder unsupported in this browser");
    this.mimeType = mime;
    const preset = QUALITY_PRESETS[this.opts.quality];

    // --- Audio mix: system/tab audio + mic -> one destination track
    const tracks: MediaStreamTrack[] = [...this.displayStream.getVideoTracks()];
    const sysAudio = this.displayStream.getAudioTracks();
    const micAudio = this.micStream?.getAudioTracks() ?? [];
    this.systemAudioCaptured = sysAudio.length > 0;
    if (sysAudio.length > 0 || micAudio.length > 0) {
      this.audioCtx = new AudioContext();
      const dest = this.audioCtx.createMediaStreamDestination();
      if (sysAudio.length > 0) {
        this.audioCtx
          .createMediaStreamSource(new MediaStream(sysAudio))
          .connect(dest);
      }
      if (micAudio.length > 0) {
        this.audioCtx
          .createMediaStreamSource(new MediaStream(micAudio))
          .connect(dest);
      }
      tracks.push(...dest.stream.getAudioTracks());
    }

    const combined = new MediaStream(tracks);
    this.screenRecorder = new MediaRecorder(combined, {
      mimeType: mime,
      videoBitsPerSecond: preset.bitsPerSecond,
    });
    this.screenRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.screenChunks.push(e.data);
    };

    if (this.camStream) {
      this.camRecorder = new MediaRecorder(this.camStream, {
        mimeType: mime,
        videoBitsPerSecond: 2_500_000,
      });
      this.camRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.camChunks.push(e.data);
      };
    }

    // Native "Stop sharing" button -> finalize gracefully.
    this.displayStream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (!this.stopped) this.events.onSurfaceEnded?.();
    });

    // Chunked recording so long sessions don't hold one giant buffer.
    const t0 = performance.now();
    this.screenRecorder.start(1000);
    if (this.camRecorder) {
      const t1 = performance.now();
      this.camRecorder.start(1000);
      this.webcamOffsetMs = Math.round(t1 - t0);
    }

    this.startedAt = performance.now();
    this.ticker = window.setInterval(() => {
      this.events.onTick?.(this.elapsedMs());
    }, 200);
  }

  elapsedMs(): number {
    if (this.startedAt === 0) return 0;
    if (this.pausedAt !== null) return this.accumulatedMs;
    return this.accumulatedMs + (performance.now() - this.startedAt);
  }

  pause(): void {
    if (this.paused || !this.screenRecorder) return;
    this.screenRecorder.pause();
    this.camRecorder?.pause();
    this.accumulatedMs += performance.now() - this.startedAt;
    this.pausedAt = performance.now();
    this.paused = true;
  }

  resume(): void {
    if (!this.paused || !this.screenRecorder) return;
    this.screenRecorder.resume();
    this.camRecorder?.resume();
    this.startedAt = performance.now();
    this.pausedAt = null;
    this.paused = false;
  }

  async stop(): Promise<CaptureResult> {
    if (this.stopped) throw new Error("already stopped");
    this.stopped = true;
    if (this.ticker !== null) clearInterval(this.ticker);
    const durationMs = Math.round(this.elapsedMs());

    const flush = (rec: MediaRecorder | null) =>
      new Promise<void>((resolve) => {
        if (!rec || rec.state === "inactive") return resolve();
        rec.onstop = () => resolve();
        rec.stop();
      });
    await Promise.all([flush(this.screenRecorder), flush(this.camRecorder)]);

    const videoTrack = this.displayStream?.getVideoTracks()[0];
    const settings = videoTrack?.getSettings();
    const resolution = settings?.width
      ? `${settings.width}×${settings.height}`
      : "unknown";

    this.cleanup();

    const container = this.mimeType.split(";")[0];
    return {
      screenBlob: new Blob(this.screenChunks, { type: container }),
      mimeType: container,
      webcamBlob:
        this.camChunks.length > 0
          ? new Blob(this.camChunks, { type: container })
          : null,
      webcamMimeType: this.camChunks.length > 0 ? container : null,
      webcamOffsetMs: this.webcamOffsetMs,
      durationMs,
      resolution,
      micGranted: this.micGranted,
      systemAudioCaptured: this.systemAudioCaptured,
    };
  }

  abort(): void {
    this.stopped = true;
    if (this.ticker !== null) clearInterval(this.ticker);
    try {
      if (this.screenRecorder?.state !== "inactive") this.screenRecorder?.stop();
      if (this.camRecorder && this.camRecorder.state !== "inactive")
        this.camRecorder.stop();
    } catch {
      /* already stopped */
    }
    this.cleanup();
  }

  private cleanup(): void {
    for (const s of [this.displayStream, this.micStream, this.camStream]) {
      s?.getTracks().forEach((t) => t.stop());
    }
    this.audioCtx?.close().catch(() => undefined);
    this.displayStream = this.micStream = this.camStream = null;
  }
}

export function formatTimecode(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
