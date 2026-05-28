# Voice to Text

A browser-based speech-to-text app using **Groq's Whisper API** with a **LiveKit Agents UI** visualizer.

Built with **React + TypeScript + Vite + shadcn/ui + Tailwind CSS v4**.

## Setup

```bash
npm install
npm run dev
# → http://localhost:5173
```

## Usage

1. Open the app in a modern browser.
2. Enter your [Groq API key](https://console.groq.com/keys) in settings.
3. Tap the aura to start recording, tap again to stop and transcribe.

## Stack

- **Vite** + **React 19** + **TypeScript**
- **shadcn/ui** + **Tailwind CSS v4**
- **LiveKit Agents UI** — `AgentAudioVisualizerAura` component
- **Groq API** — `whisper-large-v3-turbo` model
