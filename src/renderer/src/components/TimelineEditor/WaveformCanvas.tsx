import { useEffect, useRef } from 'react'

interface WaveformCanvasProps {
  peaks: Array<[number, number]>
  width: number
  height: number
  color: string
}

function WaveformCanvas({ peaks, width, height, color }: WaveformCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const pixelWidth = Math.max(1, Math.round(width))
    canvas.width = pixelWidth
    canvas.height = height
    ctx.clearRect(0, 0, pixelWidth, height)
    ctx.fillStyle = color

    const mid = height / 2
    const pxPerPeak = pixelWidth / Math.max(1, peaks.length)
    for (let i = 0; i < peaks.length; i++) {
      const [min, max] = peaks[i]
      const x = i * pxPerPeak
      const y1 = mid + min * mid
      const y2 = mid + max * mid
      ctx.fillRect(x, y1, Math.max(1, pxPerPeak), Math.max(1, y2 - y1))
    }
  }, [peaks, width, height, color])

  return <canvas ref={canvasRef} className="waveform-canvas" style={{ width, height }} />
}

export default WaveformCanvas
