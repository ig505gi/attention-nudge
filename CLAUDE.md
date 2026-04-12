# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AttentionNudge — LLM-powered browser focus assistant (Chrome/Edge extension).

## Tech Stack

- **Framework**: Plasmo (MV3 browser extension)
- **Language**: TypeScript + React
- **Styling**: Inline styles (no CSS framework)

## Dev Commands

```bash
cd app
npm install       # install dependencies
npm run dev       # development mode with hot reload
npm run build     # production build → app/build/chrome-mv3-prod/
```

## Load Extension

1. `chrome://extensions/`
2. Enable **Developer Mode**
3. Click **Load unpacked**
4. Select `app/build/chrome-mv3-dev/` (dev) or `app/build/chrome-mv3-prod/` (build)

## Key Files

- `popup.tsx` — Settings panel (API key, URL, model, debug mode)
- `background.ts` — Service Worker (state machine, LLM calls, message routing)
- `content.tsx` — Injected into every page (extract title/meta)
- `components/InterventionToast.tsx` — Non-blocking reminder UI
- `lib/llm.ts` — OpenAI-compatible API caller
- `lib/storage.ts` — chrome.storage.local wrapper + debug utils
- `lib/types.ts` — TypeScript interfaces

## Debug

1. Open popup → enable **Debug Mode** → Save
2. Open `chrome://extensions/` → click **Service Worker** link for background logs
3. On any page → F12 for content script logs

## Notes

- Extension runs in **BYOK mode** — no backend server, data goes directly to user's LLM provider
- LLM calls use **OpenAI-compatible format** (any API URL + key + model name works)
- Markdown code blocks in LLM responses are stripped before JSON parsing
