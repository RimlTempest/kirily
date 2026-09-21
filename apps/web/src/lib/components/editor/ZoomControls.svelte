<script lang="ts">
  import type { Quarter } from '@kirily/contract/geometry'
  /**
   * Zoom presets and the current level (kirily-design.md §14).
   *
   * Shown as real buttons rather than a slider: the useful zooms in an editor
   * are a handful of named levels, and "100%" has to be reachable exactly —
   * that is where one image pixel is one screen pixel.
   */
  import { ZOOM_STEPS } from '@kirily/contract/geometry'

  type Props = {
    scale: number
    /** Clockwise quarter turns the view is currently at. */
    rotation: Quarter
    onzoom: (scale: number) => void
    onfit: () => void
    onrotate: () => void
  }

  const { scale, rotation, onzoom, onfit, onrotate }: Props = $props()

  const percent = $derived(Math.round(scale * 100))
</script>

<!--
  Wraps rather than overflowing. On a phone the row did not fit, and what fell
  off the end was the rotate button — unclickable on the one device it exists
  for. `rounded-2xl` rather than `rounded-full`, because a pill with two rows
  in it is not a pill.
-->
<div
  role="group"
  aria-label="表示倍率"
  class="flex max-w-full flex-wrap items-center justify-center gap-1 rounded-2xl bg-surface-raised px-2 py-1 text-xs text-ink-muted"
>
  <button
    type="button"
    class="rounded-full px-2 py-1 hover:bg-line"
    onclick={() => onzoom(scale / 2)}
  >
    <span aria-hidden="true">−</span>
    <span class="sr-only">縮小</span>
  </button>

  <!-- Labelled because the presets below carry the same text; without it the
       readout and the "100%" button are indistinguishable to a screen reader
       (and to a test). -->
  <span class="w-12 text-center tabular-nums" aria-label="現在の倍率" aria-live="polite"
    >{percent}%</span
  >

  <button
    type="button"
    class="rounded-full px-2 py-1 hover:bg-line"
    onclick={() => onzoom(scale * 2)}
  >
    <span aria-hidden="true">+</span>
    <span class="sr-only">拡大</span>
  </button>

  <span class="mx-1 h-4 w-px bg-line" role="separator"></span>

  {#each ZOOM_STEPS as step (step)}
    <button
      type="button"
      class="rounded-full px-2 py-1 tabular-nums hover:bg-line"
      class:bg-accent={percent === Math.round(step * 100)}
      class:text-accent-ink={percent === Math.round(step * 100)}
      aria-pressed={percent === Math.round(step * 100)}
      onclick={() => onzoom(step)}
    >
      {Math.round(step * 100)}%
    </button>
  {/each}

  <button type="button" class="rounded-full px-2 py-1 hover:bg-line" onclick={onfit}> 全体 </button>

  <span class="mx-1 h-4 w-px bg-line" role="separator"></span>

  <!-- Beside the zoom because it is the same kind of thing: how the picture is
       being looked at, not what is being done to it. The label says so, since
       a rotate button in an image editor usually means the other one. -->
  <button
    type="button"
    class="rounded-full px-2 py-1 tabular-nums hover:bg-line"
    class:bg-accent={rotation !== 0}
    class:text-accent-ink={rotation !== 0}
    aria-label="表示を回す（書き出しの向きは変わりません）"
    onclick={onrotate}
  >
    ↻{rotation === 0 ? '' : ` ${rotation}°`}
  </button>
</div>
