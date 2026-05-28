import { useTheme } from '@/components/theme-provider'
import { AgentAudioVisualizerAura } from '@/components/agents-ui/agent-audio-visualizer-aura'

export default function App() {
  const { resolvedTheme } = useTheme()

  return (
    <div className="grid min-h-svh place-items-center bg-neutral-950 p-8">
      <AgentAudioVisualizerAura
        size="xl"
        color="#1FD5F9"
        colorShift={0.3}
        state="speaking"
        themeMode={resolvedTheme}
        className="aspect-square size-auto w-full max-w-md"
      />
    </div>
  )
}
