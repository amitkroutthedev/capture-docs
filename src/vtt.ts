import type { Segment } from "./types";

function stamp(ms: number, sep: "." | ","): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const f = Math.floor(ms % 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(f, 3)}`;
}

export function buildVtt(segments: Segment[]): string {
  const cues = segments.map(
    (seg, i) =>
      `${i + 1}\n${stamp(seg.startMs, ".")} --> ${stamp(seg.endMs, ".")}\n${seg.text.trim()}`,
  );
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

export function buildSrt(segments: Segment[]): string {
  return (
    segments
      .map(
        (seg, i) =>
          `${i + 1}\n${stamp(seg.startMs, ",")} --> ${stamp(seg.endMs, ",")}\n${seg.text.trim()}`,
      )
      .join("\n\n") + "\n"
  );
}
