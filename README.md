# Voice to Text

A browser-based speech-to-text app that uses **Groq's API** with the **Whisper-large-v3-turbo** model for fast, accurate transcriptions.

## Features

- Real-time audio recording from the browser microphone
- Transcriptions via Groq's Whisper endpoint
- Editable transcript with copy & clear actions
- Optional context prompt to improve accuracy
- API key stored locally in the browser

## Usage

> **Important:** Microphone permissions persist across page reloads only when served over HTTP/HTTPS, not via `file://`. Use the local server below.

```bash
node server.js
# → http://localhost:3000
```

Then open `http://localhost:3000` in a modern browser.

1. Click the gear icon to open settings and enter your [Groq API key](https://console.groq.com/keys).
2. (Optional) Add a context prompt for domain-specific vocabulary.
3. Tap the record button, speak, then tap again to stop and transcribe.

## Tech

- Vanilla HTML / CSS / JS — no build step required (Node.js only for the dev server).
- [Groq Audio Transcription API](https://console.groq.com/docs/speech-text)
- Model: `whisper-large-v3-turbo`
