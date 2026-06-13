# CaptureDocs

CaptureDocs (formerly Reelnote) — web screen recorder for product demos: high-resolution tab/window/screen capture, optional mic + webcam bubble, then AI subtitles, a searchable click-to-seek transcript, and auto-generated chapters.

It is **not** a click/flow tracker. There is no DOM event capture and no claim of native-recorder performance — browser capture goes through software-encoded `MediaRecorder`. The product is the combined artifact: clean recording + accurate subtitles + searchable chapters in one place.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 — use a Chromium browser to record
npm run build      # type-check + production bundle
```

Recording requires Chromium (Chrome/Edge/Arc/Brave); unsupported browsers get an explicit message, not a silent failure.

## What's implemented (spec build order)

| Step | Status |
|---|---|
| 1. Capture: `getDisplayMedia` + mic mix (Web Audio) + webcam as second stream with stored sync offset + chunked `MediaRecorder` + codec fallback (`mp4/avc1` → `vp9` → `vp8`) + quality/fps selector with 4K/60 warnings + pause/resume + native "Stop sharing" handling + partial-permission handling + local download | ✅ |
| 2. Upload + recordings list + playback with CSS webcam overlay | ✅ local-first: IndexedDB stands in for R2/S3 + Postgres (see roadmap) |
| 3. Transcription → WebVTT → toggleable `<track>` captions, SRT export, inline transcript editing that re-renders captions | ✅ |
| 4. Searchable transcript: click-to-seek, live current-line highlight + autoscroll, search with match highlighting | ✅ |
| 5. Auto-chapters (3–8, titled, click-to-seek, editable titles) + AI summary | ✅ |
| 6. Share links + visibility | ❌ requires deployed backend (roadmap below) |
| 7. Server-side ffmpeg: trim, burn-in, webcam composite | ❌ Phase 2 by spec; worker design below |

## Choices made where the spec was silent or unservable

- **No backend in this build.** Auth (Clerk), object storage, Postgres, and a job queue all require provisioned infrastructure and secrets. Per the spec's own build order ("ship each before the next", step 1 explicitly has no backend), this delivers the capture and playback/edit product fully, local-first. `db.ts` is the single persistence seam to replace.
- **Multi-provider AI layer** (`ai.ts`) behind the §4 interface. Transcription: OpenAI Whisper, Groq Whisper, or Deepgram. Chapters/summary: OpenAI, Groq, or Anthropic. Per-platform keys and the provider choice are stored in `localStorage` (`reelnote.ai_settings`) — browser-only, sent only to the chosen provider. localStorage is readable by any script on the page (XSS, extensions): acceptable for a localhost dev build, never for deployment. In production the same interface moves behind the worker and keys live in server secrets. Browser-direct calls also depend on each provider permitting CORS.
- **25 MB Whisper limit is surfaced, not hidden.** A 1080p recording exceeds it in ~3–4 minutes. The fix (extract the audio track server-side with ffmpeg before transcription) belongs to the worker; doing audio extraction client-side without ffmpeg.wasm produces WAVs that are usually *larger* than the video.
- **Drift handling:** the stored start offset (`webcamOffsetMs`) corrects initial skew only. Actual drift over long recordings is handled at playback by slaving the bubble's clock to the main video with a 1 s resync loop (>150 ms tolerance). The ffmpeg composite export should likewise treat the offset as an anchor (`-itsoffset`), and long-session drift there needs measurement before trusting it — the spec's own §11 caveat stands.
- **Vanilla CSS tokens instead of Tailwind/shadcn** (spec lists them as *suggested*): fewer moving parts, full control over the two hero screens, 7 kB of CSS total.
- **Hand-rolled 30-line hash router** instead of react-router for three routes.
- **Webcam offset measurement** is `performance.now()` delta between the two `MediaRecorder.start()` calls. It cannot observe encoder start latency inside the browser; treat it as an anchor, which the resync loop then corrects against.

## Routing & settings

Routing uses **React Router v7** (`react-router-dom`) with **HashRouter** — deliberate, not BrowserRouter: this is a static client-side app with no server to serve `index.html` on deep links, so hash routing is what survives a refresh on `/settings` or `/r/:id`. Routes: `/` (Library), `/record`, `/r/:id` (Playback), `/settings`. For four routes this is more dependency than the routing strictly needs (~13 kB gzipped); it's here for standardization over the previous hand-rolled hash router.

AI provider keys are managed centrally on the **Settings** page (`/settings`), not per-recording. When a recording's "Generate" is clicked without keys set, the user is routed to `/settings?next=/r/<id>` and returned after saving. Keys still live in `localStorage` — centralizing them changes the UX, not the security posture; production keeps them server-side.

## Backend roadmap (steps 2/6/7)

The data model in the spec maps directly: `RecordingRecord` here splits into `Recording` (metadata + `fileKey`/`webcamFileKey` instead of Blobs), `Transcript` (segments → VTT in storage), `Chapter`, `Job`.

1. **Uploads:** presigned PUT to R2/S3 from the browser on stop (screen + webcam files), `Recording.status: uploading → processing`.
2. **Worker:** a real queue (e.g. BullMQ + Redis) on a dedicated host — not serverless; ffmpeg and long transcriptions exceed serverless time/size limits. Jobs: `transcription` (ffmpeg audio extract → Whisper or self-hosted faster-whisper via the same `TranscriptionProvider` shape), `chapters`, `export` (trim, subtitle burn-in, webcam composite via `overlay` filter with a circular alpha mask, aligned by `webcamOffsetMs`).
3. **Auth + sharing:** Clerk or Auth.js; `visibility: private | unlisted | public`; the unlisted share page is the existing playback page minus edit controls, fetching by token without auth.

## Honest limitations (by design, per §11)

- Software encoding: 4K/60 may drop frames on modest hardware — warned in the UI, never claimed otherwise.
- Tab audio capture is Chromium-solid; full system audio varies by OS — the recording degrades to mic-only and tells you.
- Output container depends on `isTypeSupported`; most Chromium builds produce WebM.
- Three separate permissions (screen/mic/camera): partial denials are handled and named, never a half-configured state.

## Storage: how much, and how you know it's full

There is no fixed limit — IndexedDB quota is decided per browser, per origin: Chromium up to ~60% of free disk, Firefox ~10% capped near 10 GB, Safari much less (and Safari can wipe site data after 7 days without a visit). At ~600 MB per 10 min of 1080p, this matters fast.

The app surfaces it three ways:
1. **Storage meter** on the Library page (`navigator.storage.estimate()`): used vs. quota, with a red warning at 80%.
2. **"Protect from eviction"** button (`navigator.storage.persist()`): by default IndexedDB data is *best-effort* and the browser may delete it under disk pressure; persistence, when granted, exempts it. The browser can decline — the UI says so honestly instead of pretending.
3. **Rescue path:** if a save fails (`QuotaExceededError` or otherwise), the capture is kept in memory and offered as a direct download — a full disk never destroys a take.

None of this changes the underlying fact: a browser is not durable storage for video. The real fix is step 2 of the roadmap (presigned uploads to object storage).
