# AttentionNudge

LLM-powered browser focus assistant. A Chrome/Edge extension that gently nudges you back on track when you drift away from your current task.

## Features

- **Context-aware**: Uses LLM to compare current page with your stated goal
- **Non-intrusive**: Flexible intervention — soft nudge to gentle reminder, never blocking
- **Privacy-first**: BYOK mode — your data goes directly to your LLM provider, not through any server
- **Per-tab state**: Each tab maintains its own state, LLM responses are queued and shown when you switch to that tab
- **Debounced batch**: Rapid page opens are batched together to save API calls

## Setup

```bash
cd app
npm install
npm run dev
```

Load the extension in Chrome:
1. Open `chrome://extensions/`
2. Enable **Developer Mode**
3. Click **Load unpacked**
4. Select `app/build/chrome-mv3-dev/`

## Configuration

1. Click the extension icon
2. Enter your **Current Task** (e.g., "learn LLM")
3. Fill in your **API URL**, **API Key**, and **Model** (OpenAI-compatible)
4. Enable **Debug Mode** to see detailed logs in the Service Worker console

## Architecture

- `content.tsx`: Injected into every page, extracts title/meta, sends to background
- `background.ts`: Per-tab state machine, debounced batch LLM calls, routes interventions
- `popup.tsx`: Settings panel
- `components/InterventionToast.tsx`: Non-blocking reminder UI
- `lib/llm.ts`: OpenAI-compatible API caller

## Debug

1. Open `chrome://extensions/`
2. Find AttentionNudge → click **Service Worker** link
3. Enable **Debug Mode** in popup settings

## License

GPL v3
