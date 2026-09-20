<script lang="ts">
  /**
   * The rendering surface and the pointer surface — and nothing else.
   *
   * It converts pointer positions into image coordinates and hands them up. It
   * does not know what a mask is, what undo means, or which tool is active
   * beyond whether the gesture paints (IMPLEMENTATION.md §28).
   */
  import type { ImagePoint, Viewport } from '@kirily/contract/geometry'
  import { centred, fitScale, screenPoint, toImagePoint } from '@kirily/contract/geometry'

  type Props = {
    preview: { width: number; height: number; rgba: Uint8ClampedArray }
    mask: Uint8Array
    /** Changes whenever the mask changes; used to trigger a redraw. */
    version: number
    painting: boolean
    brushSize: number
    onstroke: (points: readonly ImagePoint[]) => void
    /** Preview pixels per original-image pixel. */
    previewScale: number
  }

  const { preview, mask, version, painting, brushSize, onstroke, previewScale }: Props = $props()

  let canvas: HTMLCanvasElement | null = $state(null)
  let frame: HTMLDivElement | null = $state(null)
  let viewport = $state<Viewport>({ scale: 1, offsetX: 0, offsetY: 0 })
  let stroke: ImagePoint[] = []
  let strokePointer: number | null = null

  /** Composited preview pixels. Allocated once per image, not per frame. */
  let composited: ImageData | null = null

  const fit = (): void => {
    if (frame === null) return
    const box = frame.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return
    const scale = Math.min(1, fitScale(preview, box))
    viewport = centred(preview, box, scale)
  }

  const draw = (): void => {
    if (canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return

    composited ??= new ImageData(preview.width, preview.height)
    const pixels = preview.width * preview.height
    for (let i = 0; i < pixels; i++) {
      const base = i * 4
      composited.data[base] = preview.rgba[base] ?? 0
      composited.data[base + 1] = preview.rgba[base + 1] ?? 0
      composited.data[base + 2] = preview.rgba[base + 2] ?? 0
      composited.data[base + 3] = mask[i] ?? 255
    }
    context.putImageData(composited, 0, 0)
  }

  $effect(() => {
    // Re-read both so the effect re-runs when either the pixels or the mask
    // change; `version` is the cheap stand-in for diffing 8 MB of mask.
    void version
    void preview
    composited = null
    draw()
  })

  $effect(() => {
    if (frame === null) return
    const observer = new ResizeObserver(fit)
    observer.observe(frame)
    fit()
    return () => observer.disconnect()
  })

  const pointAt = (event: PointerEvent): ImagePoint | null => {
    if (canvas === null) return null
    const box = canvas.getBoundingClientRect()
    const inPreview = toImagePoint(screenPoint(event.clientX - box.left, event.clientY - box.top), {
      scale: box.width / preview.width,
      offsetX: 0,
      offsetY: 0,
    })
    // Preview coordinates are not image coordinates: the mask lives at the
    // original resolution (IMPLEMENTATION.md §11).
    return { space: 'image', x: inPreview.x / previewScale, y: inPreview.y / previewScale }
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (!painting || event.button !== 0) return
    const point = pointAt(event)
    if (point === null) return
    strokePointer = event.pointerId
    stroke = [point]
    canvas?.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (strokePointer !== event.pointerId) return
    const point = pointAt(event)
    if (point !== null) stroke.push(point)
  }

  const endStroke = (event: PointerEvent): void => {
    if (strokePointer !== event.pointerId) return
    strokePointer = null
    if (stroke.length > 0) onstroke(stroke)
    stroke = []
  }
</script>

<div
  bind:this={frame}
  class="checkerboard relative grid h-full w-full place-items-center overflow-hidden rounded-[var(--radius-panel)]"
>
  <canvas
    bind:this={canvas}
    width={preview.width}
    height={preview.height}
    class="max-h-full max-w-full touch-none"
    style:width={`${preview.width * viewport.scale}px`}
    style:height={`${preview.height * viewport.scale}px`}
    style:cursor={painting ? 'crosshair' : 'default'}
    aria-label="編集中の画像"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={endStroke}
    onpointercancel={endStroke}
  ></canvas>

  {#if painting}
    <p
      class="pointer-events-none absolute bottom-3 rounded-full bg-surface-raised/90 px-3 py-1 text-xs text-ink-muted"
    >
      ブラシ {Math.round(brushSize)}px
    </p>
  {/if}
</div>
