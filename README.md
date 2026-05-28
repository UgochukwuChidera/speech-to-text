# Voice to Text

Browser-based speech-to-text using **Groq's Whisper API** with a **LiveKit Agents UI** aura visualizer.

Built with **React + TypeScript + Vite + shadcn/ui + Tailwind CSS v4**.

## Setup

```bash
npm install
npm run dev
# → http://localhost:5173
```

## Usage

1. Open the app, enter your [Groq API key](https://console.groq.com/keys) in settings.
2. Toggle **Live** for streaming mode or leave off for standard record-and-transcribe.
3. Tap the aura to start recording, tap again to stop.

### Standard mode

Records the entire audio, then transcribes in one shot when you stop.

### Live mode

Records continuously and transcribes in **5-second chunks** (12 req/min — well under Groq's 25/min limit). Each chunk's result streams into the text area **word by word** with a typewriter effect. Overlap detection prevents word duplication across chunk boundaries.

## Stack

- **Vite** + **React 19** + **TypeScript**
- **shadcn/ui** + **Tailwind CSS v4**
- **LiveKit Agents UI** — `AgentAudioVisualizerAura` component
- **Groq API** — `whisper-large-v3-turbo` model
