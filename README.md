# Voice to Text

A browser-based speech-to-text app that uses **Groq's API** with the **Whisper-large-v3-turbo** model for fast, accurate transcriptions.

## Features

- Real-time audio recording from the browser microphone
- Transcriptions via Groq's Whisper endpoint
- Editable transcript with copy & clear actions
- Optional context prompt to improve accuracy
- API key stored locally in the browser

## Usage

1. Open `index.html` in a modern browser.
2. Click the gear icon to open settings and enter your [Groq API key](https://console.groq.com/keys).
3. (Optional) Add a context prompt for domain-specific vocabulary.
4. Tap the record button, speak, then tap again to stop and transcribe.

## Tech

- Vanilla HTML / CSS / JS — no build step required.
- [Groq Audio Transcription API](https://console.groq.com/docs/speech-text)
- Model: `whisper-large-v3-turbo`
