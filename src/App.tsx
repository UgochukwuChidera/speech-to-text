import { useState, useRef, useCallback, useEffect } from 'react'
import { useTheme } from '@/components/theme-provider'
import { AgentAudioVisualizerAura } from '@/components/agents-ui/agent-audio-visualizer-aura'
import type { AgentState } from '@livekit/components-react'

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = 'whisper-large-v3-turbo'
const BASE_COLOR = '#1FD5F9'

function hslToHex(h: number, s: number, l: number): `#${string}` {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)))
  }
  return `#${[f(0), f(8), f(4)].map(n => n.toString(16).padStart(2, '0')).join('')}`
}

const AGENT_STATE: Record<string, AgentState> = {
  idle: 'connecting',
  recording: 'listening',
  processing: 'speaking',
  complete: 'speaking',
}

function getKey() { return localStorage.getItem('groq_api_key') || '' }
function getContext() { return localStorage.getItem('groq_context_prompt') || '' }

export default function App() {
  const { resolvedTheme } = useTheme()
  const [mode, setMode] = useState<'idle' | 'recording' | 'processing' | 'complete'>('idle')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [apiKey, setApiKey] = useState(getKey)
  const [contextPrompt, setContextPrompt] = useState(getContext)
  const [copied, setCopied] = useState(false)
  const [processingHue, setProcessingHue] = useState(0)

  useEffect(() => {
    if (mode !== 'processing') return
    let id: number
    let start = performance.now()
    function frame(now: number) {
      setProcessingHue(((now - start) * 0.06) % 360)
      id = requestAnimationFrame(frame)
    }
    id = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(id)
  }, [mode])

  const auraColor = mode === 'processing'
    ? hslToHex(processingHue, 85, 55)
    : BASE_COLOR

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  useEffect(() => { localStorage.setItem('groq_api_key', apiKey) }, [apiKey])
  useEffect(() => { localStorage.setItem('groq_context_prompt', contextPrompt) }, [contextPrompt])

  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0

  const getMic = useCallback(async () => {
    if (streamRef.current) return streamRef.current
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Your browser does not support audio recording.')
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: { ideal: 16000 }, channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true },
    })
    streamRef.current = stream
    return stream
  }, [])

  const handleClick = useCallback(async () => {
    if (mode === 'processing') return

    if (mode === 'recording') {
      recorderRef.current?.stop()
      return
    }

    const key = apiKey.trim()
    if (!key) {
      setError('Enter your Groq API key in the settings first.')
      setSettingsOpen(true)
      return
    }
    setError('')

    try {
      const stream = await getMic()
      chunksRef.current = []
      setMode('recording')

      const type = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const ext = type === 'audio/webm' ? 'webm' : 'mp4'
      const recorder = new MediaRecorder(stream, { mimeType: type })
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        if (chunksRef.current.length === 0) {
          setMode('idle')
          return
        }
        setMode('processing')

        const blob = new Blob(chunksRef.current, { type })
        const fd = new FormData()
        fd.append('file', blob, `recording.${ext}`)
        fd.append('model', MODEL)
        fd.append('temperature', '0')
        const ctx = contextPrompt.trim()
        if (ctx) fd.append('prompt', ctx)

        try {
          const res = await fetch(GROQ_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey.trim()}` },
            body: fd,
          })
          if (!res.ok) {
            let msg = `Error ${res.status}`
            try { const err = await res.json(); msg = err.error?.message || msg } catch {}
            throw new Error(msg)
          }
          const data = await res.json()
          const text = data.text || ''
          if (text) {
            setTranscript(prev => prev ? prev.trim() + ' ' + text : text)
            setMode('complete')
          } else {
            setMode('idle')
          }
        } catch (err) {
          setError((err as Error).message)
          setMode('idle')
        }
      }

      recorder.start()
    } catch (err) {
      if ((err as Error).name === 'NotAllowedError' || (err as Error).name === 'PermissionDeniedError') {
        setError('Microphone access denied.')
      } else {
        setError((err as Error).message || 'Microphone not available.')
      }
      setMode('idle')
    }
  }, [mode, apiKey, contextPrompt, getMic])

  const handleCopy = useCallback(async () => {
    if (!transcript.trim()) return
    try {
      await navigator.clipboard.writeText(transcript.trim())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Failed to copy.')
    }
  }, [transcript])

  const handleClear = useCallback(() => {
    setTranscript('')
    setMode('idle')
    setError('')
  }, [])

  const statusText = mode === 'idle' ? 'Tap the aura to start recording'
    : mode === 'recording' ? 'Recording... tap to stop'
    : mode === 'processing' ? 'Transcribing...'
    : 'Transcription complete'

  const statusClass = mode === 'recording' ? 'text-cyan-400'
    : mode === 'processing' ? 'text-cyan-400'
    : 'text-zinc-500'

  return (
    <div className="grid min-h-svh place-items-center bg-zinc-950 p-4 sm:p-8">
      <div className="flex w-full max-w-lg flex-col items-center gap-6">
        <div className="text-center">
          <h1 className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-2xl font-semibold tracking-tight text-transparent">
            Voice to Text
          </h1>
          <p className="mt-1 text-sm font-light text-zinc-500">Speak &mdash; get instant transcriptions</p>
        </div>

        <div className="flex w-full flex-col items-center gap-5 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 backdrop-blur-xl sm:p-8">
          <button
            onClick={handleClick}
            className="relative cursor-pointer appearance-none border-none bg-transparent p-0 outline-none"
            title={mode === 'idle' ? 'Start recording' : 'Stop recording'}
          >
            <AgentAudioVisualizerAura
              size="xl"
              color={auraColor}
              colorShift={mode === 'processing' ? 0.6 : 0.3}
              state={AGENT_STATE[mode]}
              themeMode={resolvedTheme}
              className="aspect-square size-auto w-36 sm:w-44"
            />
          </button>

          <p className={`min-h-5 text-center text-xs transition-colors ${statusClass}`}>{statusText}</p>

          {error && <p className="text-center text-xs text-red-400">{error}</p>}

          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Your transcription will appear here..."
            className="min-h-[100px] w-full resize-none overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm leading-relaxed text-zinc-200 caret-cyan-400 outline-none transition-colors focus:border-cyan-400/50"
          />

          <div className="flex w-full gap-2.5">
            <button
              onClick={handleCopy}
              disabled={!transcript.trim()}
              className="flex-1 cursor-pointer rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-xs font-medium text-zinc-500 transition-colors hover:border-cyan-400/50 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={handleClear}
              disabled={!transcript.trim() && mode === 'idle'}
              className="flex-1 cursor-pointer rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-xs font-medium text-zinc-500 transition-colors hover:border-cyan-400/50 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear
            </button>
          </div>

          <div className="flex w-full items-center justify-between">
            <span className="text-xs text-zinc-600">{wordCount} word{wordCount !== 1 ? 's' : ''}</span>
            <button
              onClick={() => setSettingsOpen(o => !o)}
              className="flex cursor-pointer items-center gap-1.5 border-none bg-transparent text-xs text-zinc-600 transition-colors hover:text-zinc-400"
            >
              {settingsOpen ? '\u2715 Close' : '\u2699 API Key'}
            </button>
          </div>

          {settingsOpen && (
            <div className="flex w-full flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">Groq API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="gsk_..."
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-200 outline-none transition-colors focus:border-cyan-400/50"
                />
                <p className="text-[11px] text-zinc-600">
                  Get yours free at{' '}
                  <a href="https://console.groq.com/keys" target="_blank" className="text-cyan-400 no-underline hover:underline">console.groq.com</a>
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">Context (optional)</label>
                <input
                  type="text"
                  value={contextPrompt}
                  onChange={(e) => setContextPrompt(e.target.value)}
                  placeholder="e.g. medical terminology, tech talk..."
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-200 outline-none transition-colors focus:border-cyan-400/50"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
