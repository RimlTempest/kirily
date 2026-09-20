<script lang="ts">
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
    onzoom: (scale: number) => void
    onfit: () => void
  }

  const { scale, onzoom, onfit }: Props = $props()

  const percent = $derived(Math.round(scale * 100))
</script>

<div
  role="group"
  aria-label="表示倍率"
  class="flex items-center gap-1 rounded-full bg-surface-raised px-2 py-1 text-xs text-ink-muted"
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
</div>
