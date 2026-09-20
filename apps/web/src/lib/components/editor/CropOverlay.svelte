<script lang="ts">
  /**
   * The crop rectangle, drawn over the canvas.
   *
   * It works in screen coordinates because that is what a pointer gives, and
   * converts at the edges — the rectangle it reports is always in image
   * coordinates, because that is what the export reads (kirily-design.md §16).
   */
  import type { ImagePoint, Rect, Viewport } from '@kirily/contract/geometry'
  import { screenPoint, toImagePoint, toScreenPoint } from '@kirily/contract/geometry'
  import type { CropHandle } from '@kirily/editor-core/crop'
  import { cropFromDrag, resizeCrop } from '@kirily/editor-core/crop'

  type Props = {
    crop: Rect
    image: { width: number; height: number }
    viewport: Viewport
    ratio: number | null
    oncrop: (rect: Rect) => void
  }

  const { crop, image, viewport, ratio, oncrop }: Props = $props()

  let surface: HTMLDivElement | null = $state(null)
  let dragging: { handle: CropHandle; start: ImagePoint; origin: Rect } | null = null

  const topLeft = $derived(toScreenPoint({ space: 'image', x: crop.x, y: crop.y }, viewport))
  const bottomRight = $derived(
    toScreenPoint({ space: 'image', x: crop.x + crop.width, y: crop.y + crop.height }, viewport),
  )

  const pointAt = (event: PointerEvent): ImagePoint | null => {
    if (surface === null) return null
    const box = surface.getBoundingClientRect()
    return toImagePoint(screenPoint(event.clientX - box.left, event.clientY - box.top), viewport)
  }

  /**
   * Keeps the pointer with the element that started the drag, so a fast drag
   * that leaves the handle does not simply stop.
   */
  const capture = (event: PointerEvent): void => {
    const target = event.currentTarget
    if (target instanceof Element) target.setPointerCapture(event.pointerId)
  }

  const start =
    (handle: CropHandle) =>
    (event: PointerEvent): void => {
      event.stopPropagation()
      const point = pointAt(event)
      if (point === null) return
      dragging = { handle, start: point, origin: crop }
      capture(event)
    }

  const move = (event: PointerEvent): void => {
    if (dragging === null) return
    const point = pointAt(event)
    if (point === null) return

    if (dragging.handle === 'move') {
      oncrop(
        resizeCrop(
          dragging.origin,
          'move',
          {
            space: 'image',
            x: dragging.origin.x + (point.x - dragging.start.x),
            y: dragging.origin.y + (point.y - dragging.start.y),
          },
          image,
          ratio,
        ),
      )
      return
    }
    oncrop(resizeCrop(dragging.origin, dragging.handle, point, image, ratio))
  }

  const end = (): void => {
    dragging = null
  }

  /** A drag on the empty area draws a new rectangle from scratch. */
  const startNew = (event: PointerEvent): void => {
    const point = pointAt(event)
    if (point === null) return
    dragging = { handle: 'bottom-right', start: point, origin: crop }
    oncrop(cropFromDrag(point, point, image, ratio))
    capture(event)
  }

  const handles: readonly { id: CropHandle; label: string; style: string }[] = [
    { id: 'top-left', label: '左上', style: 'left:-7px;top:-7px;cursor:nwse-resize' },
    { id: 'top-right', label: '右上', style: 'right:-7px;top:-7px;cursor:nesw-resize' },
    { id: 'bottom-left', label: '左下', style: 'left:-7px;bottom:-7px;cursor:nesw-resize' },
    {
      id: 'bottom-right',
      label: '右下',
      style: 'right:-7px;bottom:-7px;cursor:nwse-resize',
    },
  ]
</script>

<div
  bind:this={surface}
  class="absolute inset-0"
  role="application"
  aria-label="トリミング範囲"
  onpointerdown={startNew}
  onpointermove={move}
  onpointerup={end}
  onpointercancel={end}
>
  <!-- Everything outside the crop is dimmed, so the rectangle reads as the
       part that survives rather than as a decoration.

       A fixed dark scrim, not a theme colour: `--color-ink` is near-white in
       dark mode, so tying it to the theme brightened the discarded area
       instead of dimming it. -->
  <div
    class="pointer-events-none absolute inset-0"
    style:background="rgb(0 0 0 / 0.55)"
    style:clip-path={`polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0,
      ${topLeft.x}px ${topLeft.y}px,
      ${topLeft.x}px ${bottomRight.y}px,
      ${bottomRight.x}px ${bottomRight.y}px,
      ${bottomRight.x}px ${topLeft.y}px,
      ${topLeft.x}px ${topLeft.y}px)`}
  ></div>

  <div
    class="absolute border-2 border-accent"
    style:left={`${topLeft.x}px`}
    style:top={`${topLeft.y}px`}
    style:width={`${bottomRight.x - topLeft.x}px`}
    style:height={`${bottomRight.y - topLeft.y}px`}
    style:cursor="move"
    role="presentation"
    onpointerdown={start('move')}
  >
    {#each handles as handle (handle.id)}
      <button
        type="button"
        class="absolute h-3.5 w-3.5 rounded-sm border-2 border-accent bg-surface-raised"
        style={handle.style}
        aria-label={`${handle.label}を動かす`}
        onpointerdown={start(handle.id)}
      ></button>
    {/each}
  </div>
</div>
