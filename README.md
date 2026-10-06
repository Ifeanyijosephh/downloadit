# DownloadIt — save any public video · Built by Ifeco Digitals

DownloadIt is built and powered by **Ifeco Digitals**. It turns a public video URL
into a downloadable MP4 or MP3 file. One input, one button, no account, no ads,
nothing stored on the server.

- **Frontend:** vanilla HTML/CSS/ESM, self-hosted Poppins, light + dark themes.
- **Backend:** Node.js ≥ 20 with Express 4 + zod request validation and an
  in-process job queue (BullMQ-shaped status surface; Redis-free in this build).
- **Engine:** shells out to `yt-dlp` (or a compatible binary) and `ffmpeg`. With no
  engine installed the app degrades gracefully to `503 ENGINE_UNAVAILABLE`.

## Run

```bash
npm install
cp .env.example .env        # optional; defaults are safe
npm start                   # http://localhost:3000
```

Regenerate the bundled assets (all produced in-repo, no stock, no CDN):

```bash
npm run assets:fonts        # Poppins woff2 from @fontsource (OFL-1.1)
npm run assets:video        # raymarched CGI hero loop -> H.264 (<= 2 MB)
npm run assets:icons        # 14 software-rendered 3D icons (@1x + @2x)
node tools/make-brand-assets.mjs   # favicons + og-cover
```

## Configuration (`.env`, git-ignored)

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Bind address |
| `PUBLIC_DIR` | `public` | Static root |
| `TRUST_PROXY` | `0` | Trust `X-Forwarded-For` + send HSTS |
| `YT_DLP_PATH` | auto | Engine path; falls back to `yt-dlp` then `python3 -m yt_dlp` |
| `FFMPEG_PATH` | auto | Without it MP3 is unavailable (`503 FFMPEG_REQUIRED`) |
| `RESOLVE_TIMEOUT_MS` | `45000` | Resolve watchdog |
| `DOWNLOAD_TIMEOUT_MS` | `300000` | Download total watchdog |
| `DOWNLOAD_IDLE_TIMEOUT_MS` | `75000` | Download stall watchdog |
| `MAX_BODY_BYTES` | `16384` | JSON body cap -> `413` |
| `RATE_LIMIT_RESOLVE` | `20` | per-IP resolves / minute |
| `RATE_LIMIT_DOWNLOAD` | `10` | per-IP downloads / minute |
| `APP_VERSION` | `2.0.0` | Reported by `/api/health` |

Numeric values must be plain digits (`4_000` parses to `NaN`).

## Tests

```bash
npm test            # node --test: server, engine e2e, frontend, theme
npm run typecheck   # tsc --noEmit
npm run lint:assets # no .svg, budgets, referenced paths resolve
npm run check       # all of the above + node --check + git diff --check
```

`test-support/fake-engine.js` is an executable yt-dlp stand-in that simulates
success, slow, fail, private, empty, midfail and hang so the engine flows are
deterministic without network access.

## Known limitations & scaling notes

- No resumable downloads and no server-side queue/retry; each download is one
  engine process. Move to a worker queue + object storage before scaling.
- Per-IP rate limits are in-memory and single-node only.
- No CAPTCHA / anti-bot evasion; platforms may block datacenter IPs.
- MP3 requires `ffmpeg`; without it only MP4 is offered.
- Legal: only download content you have the rights to save. Platform Terms of
  Service apply; DownloadIt does not circumvent DRM or private media.

## Credits

Poppins © the Indian Type Foundry (SIL OFL 1.1). The hero video and 3D icons are
original renders generated in this repository; see `public/assets/CREDITS.md`.
© Ifeco Digitals 2026 — MIT.
