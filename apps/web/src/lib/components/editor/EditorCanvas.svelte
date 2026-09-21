<script lang="ts">
  /**
   * The rendering surface and the pointer surface — and nothing else.
   *
   * It converts pointer positions into image coordinates and hands them up. It
   * does not know what a mask is, what undo means, or which tool is active
   * beyond whether the gesture paints (IMPLEMENTATION.md §28).
   *
   * It draws only what is on screen, sampled through the viewport, so the cost
   * follows the size of the canvas rather than the size of the image and a
   * zoomed-in view shows the original pixels.
   */
  import type { ImagePoint, ScreenPoint, Viewport } from '@kirily/contract/geometry'
  import { screenPoint, toImagePoint } from '@kirily/contract/geometry'
  import type { ColourField } from '@kirily/image-core/field'
  import type { Placement } from '@kirily/image-core/placement'
  import type { ColorSource } from '@kirily/image-core/viewport'
  import { renderViewport } from '@kirily/image-core/viewport'
  import type { Renderer } from '$lib/render/webgl.ts'
  import { createWebglRenderer } from '$lib/render/webgl.ts'

  type Props = {
    /** Full-resolution pixels. */
    image: { width: number; height: number; rgba: Uint8ClampedArray }
    /** Downscaled copy, used while zoomed out so shrinking does not alias. */
    preview: { width: number; height: number; rgba: Uint8ClampedArray }
    /** The composed mask, at the image's resolution. */
    mask: Uint8Array
    /** Changes whenever the mask changes; used to trigger a redraw. */
    version: number
    /** The old background, once the AI has measured it. Null disables the correction. */
    background: ColourField | null
    /** Where the cut-out has been moved to, in image pixels. */
    placement: Placement
    viewport: Viewport
    painting: boolean
    /** True when a single click fills a region instead of painting a stroke. */
    filling: boolean
    brushSize: number
    onstroke: (points: readonly ImagePoint[]) => void
    onfill: (at: ImagePoint) => void
    onzoom: (anchor: ScreenPoint, scale: number) => void
    onpan: (dx: number, dy: number) => void
    /**
     * A drag meant for a layer rather than the view, already divided by the
     * zoom so it arrives in image pixels. Null when no layer is being moved.
     */
    ondragging: ((dx: number, dy: number) => void) | null
    onresize: (size: { width: number; height: number }) => void
    /** How long one composite took. A single frame says nothing; a second of them says plenty. */
    onrendered: (ms: number) => void
    /** Forces the CPU path. Only the renderer equality test sets this. */
    forceCanvas?: boolean
    /**
     * What sits behind the transparency, as a CSS colour, or null for the
     * checkerboard.
     *
     * JPEG has no alpha, so the file will have this baked in. Showing a
     * checkerboard while the user picks the colour would mean picking it
     * blind, and the preview would stop being what the export writes
     * (kirily-design.md §16).
     */
    backdrop?: string | null
    /**
     * A picture to show behind, as an object URL, framed to cover the image.
     *
     * Drawn as the frame's CSS background rather than through the renderer.
     * The browser's `cover` is the same framing `coverTransform` computes, and
     * a backdrop is the one layer where its resampling standing in for ours
     * changes nothing a user can judge (ADR-0022).
     */
    backdropUrl?: string | null
    /** Where the image sits in the frame, so the backdrop covers the same rectangle. */
    imageRect?: { x: number; y: number; width: number; height: number } | null
  }

  const {
    image,
    preview,
    mask,
    version,
    background,
    placement,
    viewport,
    painting,
    filling,
    brushSize,
    onstroke,
    onfill,
    onzoom,
    onpan,
    ondragging,
    onresize,
    onrendered,
    forceCanvas = false,
    backdrop = null,
    backdropUrl = null,
    imageRect = null,
  }: Props = $props()

  let canvas: HTMLCanvasElement | null = $state(null)
  let frame: HTMLDivElement | null = $state(null)
  let size = $state({ width: 0, height: 0 })

  let stroke: ImagePoint[] = []
  let strokePointer: number | null = null
  let panPointer: number | null = null
  let lastPan: { x: number; y: number } | null = null
  /** Pointer id → last position, so two fingers can pinch. */
  const touches = new Map<number, { x: number; y: number }>()
  let pinchDistance = 0
  /** Where the two fingers were centred, so a pinch can also drag. */
  let pinchCentre: { x: number; y: number } | null = null

  /** Reused across frames: at 1200x800 this is 3.8 MB. */
  let framebuffer: ImageData | null = null

  /**
   * Chosen once, on the first draw, and never revisited.
   *
   * A canvas hands out one kind of context for its lifetime: asking for `2d`
   * after `webgl2` returns null, so "try the GPU and fall back later" is not a
   * thing this API allows. Falling back means falling back before the first
   * frame, which is also when `createWebglRenderer` reports whether it can.
   */
  let gpu: Renderer | null = null
  let decided = false

  const draw = (): void => {
    if (canvas === null || size.width === 0 || size.height === 0) return

    if (!decided) {
      decided = true
      gpu = forceCanvas ? null : createWebglRenderer(canvas)
    }

    // Zoomed out, read the preview: it was downscaled by the browser with a
    // proper filter, so it stands in for a mip level. Zoomed in, read the
    // original — that is the whole point of zooming in.
    const previewScale = preview.width / image.width
    const source: ColorSource = viewport.scale > previewScale ? image : preview

    const started = performance.now()
    if (gpu !== null) {
      gpu.render(
        { color: source, mask, image, viewport, background, maskVersion: version, placement },
        size,
      )
      onrendered(performance.now() - started)
      return
    }

    const context = canvas.getContext('2d')
    if (context === null) return

    if (
      framebuffer === null ||
      framebuffer.width !== size.width ||
      framebuffer.height !== size.height
    ) {
      framebuffer = new ImageData(size.width, size.height)
    }
    renderViewport(source, mask, image, viewport, size, framebuffer.data, background, placement)
    context.putImageData(framebuffer, 0, 0)
    onrendered(performance.now() - started)
  }

  $effect(() => () => gpu?.dispose())

  $effect(() => {
    // Re-read each input so the effect runs when any of them changes.
    void version
    void background
    void placement
    void viewport
    void size
    void image
    draw()
  })

  $effect(() => {
    if (frame === null) return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box === undefined || box.width === 0 || box.height === 0) return
      const next = { width: Math.round(box.width), height: Math.round(box.height) }
      size = next
      onresize(next)
    })
    observer.observe(frame)
    return () => observer.disconnect()
  })

  const screenAt = (event: { clientX: number; clientY: number }): ScreenPoint | null => {
    if (canvas === null) return null
    const box = canvas.getBoundingClientRect()
    return screenPoint(event.clientX - box.left, event.clientY - box.top)
  }

  const pointAt = (event: PointerEvent): ImagePoint | null => {
    const screen = screenAt(event)
    return screen === null ? null : toImagePoint(screen, viewport)
  }

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const anchor = screenAt(event)
    if (anchor === null) return
    // Exponential, so each notch feels the same at every zoom level.
    onzoom(anchor, viewport.scale * Math.exp(-event.deltaY * 0.002))
  }

  const onPointerDown = (event: PointerEvent): void => {
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (touches.size === 2) {
      // A second finger turns the gesture into a pinch; abandon any stroke it
      // started, or the first finger would keep painting while zooming.
      stroke = []
      strokePointer = null
      pinchDistance = spread()
      pinchCentre = centre()
      return
    }

    const point = pointAt(event)
    if (point === null) return

    // Middle button, or space held, or the pan tool: drag the image.
    if (event.button === 1 || (!painting && !filling)) {
      panPointer = event.pointerId
      lastPan = { x: event.clientX, y: event.clientY }
      canvas?.setPointerCapture(event.pointerId)
      return
    }
    if (event.button !== 0) return

    // The bucket acts on press, not on release: it is one click, and waiting
    // for the release would make it feel like a drag that did nothing.
    if (filling) {
      onfill(point)
      return
    }

    strokePointer = event.pointerId
    stroke = [point]
    canvas?.setPointerCapture(event.pointerId)
  }

  const spread = (): number => {
    const [a, b] = [...touches.values()]
    if (a === undefined || b === undefined) return 0
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  /** The two fingers' centre, in page coordinates. */
  const centre = (): { x: number; y: number } | null => {
    const [a, b] = [...touches.values()]
    if (a === undefined || b === undefined) return null
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }

  const midpoint = (): ScreenPoint | null => {
    const [a, b] = [...touches.values()]
    if (a === undefined || b === undefined) return null
    return screenAt({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 })
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (touches.has(event.pointerId)) {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }

    if (touches.size === 2) {
      const next = spread()
      const anchor = midpoint()
      if (pinchDistance > 0 && next > 0 && anchor !== null) {
        onzoom(anchor, viewport.scale * (next / pinchDistance))
      }
      // Two fingers moving together is a drag, not a pinch of ratio 1. Without
      // this there is no way to move the picture on a touch screen at all.
      const moved = centre()
      if (pinchCentre !== null && moved !== null) {
        onpan(moved.x - pinchCentre.x, moved.y - pinchCentre.y)
      }
      pinchCentre = moved
      pinchDistance = next
      return
    }

    if (panPointer === event.pointerId && lastPan !== null) {
      const dx = event.clientX - lastPan.x
      const dy = event.clientY - lastPan.y
      lastPan = { x: event.clientX, y: event.clientY }
      if (ondragging === null) {
        onpan(dx, dy)
      } else {
        // Divided by the zoom here, so a drag moves the layer the same
        // distance on screen whatever the view is doing.
        const scale = viewport.scale === 0 ? 1 : viewport.scale
        ondragging(dx / scale, dy / scale)
      }
      return
    }

    if (strokePointer !== event.pointerId) return
    const point = pointAt(event)
    if (point !== null) stroke.push(point)
  }

  const endGesture = (event: PointerEvent): void => {
    touches.delete(event.pointerId)
    if (touches.size < 2) {
      pinchDistance = 0
      pinchCentre = null
    }

    if (panPointer === event.pointerId) {
      panPointer = null
      lastPan = null
      return
    }
    if (strokePointer !== event.pointerId) return

    strokePointer = null
    if (stroke.length > 0) onstroke(stroke)
    stroke = []
  }

  const cursor = $derived(
    filling
      ? 'cell'
      : painting
        ? 'crosshair'
        : ondragging !== null
          ? panPointer === null
            ? 'move'
            : 'grabbing'
          : panPointer === null
            ? 'grab'
            : 'grabbing',
  )
</script>

<!--
  `absolute inset-0`, not `h-full`: the section around it is sized by flex-grow
  and a min-height, and a percentage height has nothing definite to resolve
  against — the canvas came out 0x0 on a phone.
-->
<div
  bind:this={frame}
  class="absolute inset-0 overflow-hidden rounded-[var(--radius-panel)]"
  class:checkerboard={backdrop === null && backdropUrl === null}
  style:background={backdrop ?? undefined}
>
  {#if backdropUrl !== null && imageRect !== null}
    <div
      class="pointer-events-none absolute bg-cover bg-center"
      style:left={`${imageRect.x}px`}
      style:top={`${imageRect.y}px`}
      style:width={`${imageRect.width}px`}
      style:height={`${imageRect.height}px`}
      style:background-image={`url(${backdropUrl})`}
    ></div>
  {/if}
  <canvas
    bind:this={canvas}
    width={size.width}
    height={size.height}
    class="absolute inset-0 h-full w-full touch-none"
    style:cursor
    aria-label="編集中の画像"
    onwheel={onWheel}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={endGesture}
    onpointercancel={endGesture}
    onpointerleave={endGesture}
  ></canvas>

  {#if painting}
    <p
      class="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-surface-raised/90 px-3 py-1 text-xs text-ink-muted"
    >
      ブラシ {Math.round(brushSize)}px
    </p>
  {:else if filling}
    <p
      class="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-surface-raised/90 px-3 py-1 text-xs text-ink-muted"
    >
      クリックした色の範囲をまとめて
    </p>
  {/if}
</div>
