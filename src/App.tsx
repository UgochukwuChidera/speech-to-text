import { useState, useRef, useCallback, useEffect } from 'react'
import { useTheme } from '@/components/theme-provider'
import { AgentAudioVisualizerAura } from '@/components/agents-ui/agent-audio-visualizer-aura'

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = 'whisper-large-v3-turbo'
const BASE_COLOR = '#1FD5F9'
const CHUNK_MS = 5000

function hslToHex(h: number, s: number, l: number): `#${string}` {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)))
  }
  return `#${[f(0), f(8), f(4)].map(n => n.toString(16).padStart(2, '0')).join('')}`
}

function mergeText(prev: string, incoming: string): string {
  const prevW = prev.trim().split(/\s+/)
  const incW = incoming.trim().split(/\s+/)
  if (prevW.length === 0 || prevW[0] === '') return incoming.trim()
  for (let i = Math.min(prevW.length, incW.length); i > 0; i--) {
    if (prevW.slice(-i).join(' ').toLowerCase() === incW.slice(0, i).join(' ').toLowerCase()) {
      const rest = incW.slice(i).join(' ')
      return rest ? prev.trim() + ' ' + rest : prev.trim()
    }
  }
  return prev.trim() + ' ' + incoming.trim()
}

function getNewWords(prev: string, merged: string): string {
  const pw = prev.trim().split(/\s+/).filter(Boolean)
  const mw = merged.trim().split(/\s+/).filter(Boolean)
  if (pw.length === 0 || pw[0] === '') return merged.trim()
  return mw.slice(pw.length).join(' ')
}

async function transcribeChunk(blob: Blob, ext: string, apiKey: string, prompt: string): Promise<string> {
  const fd = new FormData()
  fd.append('file', blob, `chunk.${ext}`)
  fd.append('model', MODEL)
  fd.append('temperature', '0')
  fd.append('response_format', 'text')
  if (prompt) fd.append('prompt', prompt)
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  })
  if (!res.ok) {
    let msg = `Error ${res.status}`
    try { const e = await res.json(); msg = e.error?.message || msg } catch {}
    throw new Error(msg)
  }
  return res.text()
}

function streamWords(words: string, onWord: (w: string) => void): Promise<void> {
  return new Promise(resolve => {
    const tokens = words.match(/\S+\s*/g) || [words]
    if (tokens.length === 0) { resolve(); return }
    let i = 0
    function next() {
      if (i >= tokens.length) { resolve(); return }
      onWord(tokens[i])
      i++
      setTimeout(next, 50 + Math.random() * 40)
    }
    next()
  })
}

export default function App() {
  const { resolvedTheme } = useTheme()
  const [mode, setMode] = useState<'idle' | 'recording' | 'processing' | 'complete'>('idle')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('groq_api_key') || '')
  const [contextPrompt, setContextPrompt] = useState(() => localStorage.getItem('groq_context_prompt') || '')
  const [copied, setCopied] = useState(false)
  const [processingHue, setProcessingHue] = useState(0)
  const [liveMode, setLiveMode] = useState(false)
  const [liveActive, setLiveActive] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const liveChunkingRef = useRef(false)
  const streamingRef = useRef(false)
  const extRef = useRef('webm')
  const typeRef = useRef('audio/webm')
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (mode !== 'recording' || !streamRef.current) {
      setAudioLevel(0)
      return
    }
    let id: number
    const ctx = audioCtxRef.current
    const analyser = analyserRef.current
    if (!ctx || !analyser) return
    const data = new Uint8Array(analyser.frequencyBinCount)
    function frame() {
      analyser!.getByteFrequencyData(data)
      const avg = data.reduce((a, b) => a + b, 0) / data.length / 255
      setAudioLevel(Math.min(avg * 2.5, 1))
      id = requestAnimationFrame(frame)
    }
    id = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(id); setAudioLevel(0) }
  }, [mode])

  useEffect(() => { localStorage.setItem('groq_api_key', apiKey) }, [apiKey])
  useEffect(() => { localStorage.setItem('groq_context_prompt', contextPrompt) }, [contextPrompt])

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

  const auraColor = mode === 'processing' ? hslToHex(processingHue, 85, 55) : BASE_COLOR
  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0

  const getMic = useCallback(async () => {
    if (streamRef.current) return streamRef.current
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Your browser does not support audio recording.')
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: { ideal: 16000 }, channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true },
    })
    streamRef.current = stream
    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    analyserRef.current = analyser
    return stream
  }, [])

  const processAndStream = useCallback(async (chunks: Blob[], type: string, ext: string, key: string) => {
    if (chunks.length === 0) return
    streamingRef.current = true
    try {
      const blob = new Blob(chunks, { type })
      const ctx = contextPrompt.trim()
      const prompt = [ctx, transcript.trim()].filter(Boolean).join('\n')
      const text = await transcribeChunk(blob, ext, key, prompt)
      if (!text) return
      const merged = mergeText(transcript.trim(), text)
      const newPart = getNewWords(transcript.trim(), merged)
      if (!newPart) return
      let acc = transcript.trim()
      await streamWords(newPart, (w) => {
        acc += w
        setTranscript(acc)
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      streamingRef.current = false
    }
  }, [contextPrompt, transcript])

  const sendChunk = useCallback(async (chunks: Blob[], type: string, ext: string) => {
    const key = apiKey.trim()
    if (!key) return
    liveChunkingRef.current = true
    setMode('processing')
    await processAndStream(chunks, type, ext, key)
    liveChunkingRef.current = false
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      setMode('recording')
    } else {
      setMode('idle')
    }
  }, [apiKey, processAndStream])

  const handleClick = useCallback(async () => {
    if (mode === 'processing' && liveMode) return
    if (mode === 'recording' || liveActive) {
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
      const type = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const ext = type === 'audio/webm' ? 'webm' : 'mp4'
      typeRef.current = type
      extRef.current = ext

      if (liveMode) {
        chunksRef.current = []
        setLiveActive(true)
        setTranscript('')
        setMode('recording')

        const recorder = new MediaRecorder(stream, { mimeType: type })
        recorderRef.current = recorder

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data)
            if (!liveChunkingRef.current && !streamingRef.current) {
              const snapshot = [...chunksRef.current]
              chunksRef.current = []
              sendChunk(snapshot, type, ext)
            }
          }
        }

        recorder.onstop = async () => {
          setLiveActive(false)
          while (streamingRef.current) {
            await new Promise(r => setTimeout(r, 100))
          }
          if (chunksRef.current.length > 0 && !liveChunkingRef.current) {
            const snapshot = [...chunksRef.current]
            chunksRef.current = []
            setMode('processing')
            await processAndStream(snapshot, type, ext, key)
          }
          setMode('complete')
        }

        recorder.start(CHUNK_MS)
      } else {
        chunksRef.current = []
        setMode('recording')

        const recorder = new MediaRecorder(stream, { mimeType: type })
        recorderRef.current = recorder

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }

        recorder.onstop = async () => {
          if (chunksRef.current.length === 0) { setMode('idle'); return }
          setMode('processing')
          await processAndStream(chunksRef.current, type, ext, key)
          setMode('complete')
        }

        recorder.start()
      }
    } catch (err) {
      if ((err as Error).name === 'NotAllowedError' || (err as Error).name === 'PermissionDeniedError') {
        setError('Microphone access denied.')
      } else {
        setError((err as Error).message || 'Microphone not available.')
      }
      setMode('idle')
    }
  }, [mode, liveMode, liveActive, apiKey, contextPrompt, getMic, sendChunk, processAndStream])

  const handleCopy = useCallback(async () => {
    if (!transcript.trim()) return
    try {
      await navigator.clipboard.writeText(transcript.trim())
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    } catch { setError('Failed to copy.') }
  }, [transcript])

  const handleClear = useCallback(() => {
    setTranscript(''); setMode('idle'); setError(''); setLiveActive(false)
  }, [])

  const isRecording = mode === 'recording'
  const statusText = !isRecording && mode === 'processing' ? 'Transcribing...'
    : mode === 'complete' ? 'Transcription complete'
    : isRecording && liveMode ? 'Live — tap to stop'
    : isRecording ? 'Recording... tap to stop'
    : 'Tap the aura to start recording'

  const statusClass = isRecording || mode === 'processing' ? 'text-cyan-400' : 'text-zinc-500'

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
            disabled={mode === 'processing' && !liveMode}
            className="relative cursor-pointer appearance-none border-none bg-transparent p-0 outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRecording && (
              <div
                className="pointer-events-none absolute inset-0 -m-4 rounded-full transition-[transform,opacity] duration-75"
                style={{
                  background: `radial-gradient(circle, rgba(31,213,249,${audioLevel * 0.12}) 0%, transparent 70%)`,
                  transform: `scale(${1 + audioLevel * 0.08})`,
                }}
              />
            )}
            <AgentAudioVisualizerAura
              size="xl"
              color={auraColor}
              colorShift={mode === 'processing' ? 0.6 : isRecording ? 0.2 + audioLevel * 0.5 : 0.3}
              state={mode === 'idle' ? 'connecting' : mode === 'processing' ? 'speaking' : isRecording ? 'listening' : 'speaking'}
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
            rows={4}
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
            <div className="flex items-center gap-3">
              <button
                onClick={() => { if (mode === 'idle' || mode === 'complete') setLiveMode(p => !p) }}
                className={`relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full border-none p-0.5 transition-colors ${liveMode ? 'bg-cyan-500' : 'bg-zinc-700'} ${(mode !== 'idle' && mode !== 'complete') ? 'cursor-not-allowed opacity-40' : ''}`}
                disabled={mode !== 'idle' && mode !== 'complete'}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${liveMode ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
              <span className={`text-xs ${liveMode ? 'text-cyan-400' : 'text-zinc-600'}`}>Live</span>
              <span className="ml-2 text-xs text-zinc-600">{wordCount} word{wordCount !== 1 ? 's' : ''}</span>
            </div>
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
