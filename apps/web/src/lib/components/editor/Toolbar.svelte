<script lang="ts">
  /**
   * One toolbar for both layouts. Desktop puts it down the left edge, mobile
   * across the bottom where a thumb reaches (kirily-design.md §15) — the
   * controls and their labels are the same, so there is one thing to keep
   * accessible rather than two.
   */
  import { ASPECT_PRESETS } from '@kirily/editor-core/crop'
  import { EditorTool } from '@kirily/editor-core/state'

  type Props = {
    tool: EditorTool
    brushSize: number
    tolerance: number
    ratio: number | null
    busy: boolean
    canUndo: boolean
    canRedo: boolean
    ontool: (tool: EditorTool) => void
    onbrushsize: (size: number) => void
    ontolerance: (tolerance: number) => void
    onratio: (ratio: number | null) => void
    onauto: () => void
    onundo: () => void
    onredo: () => void
  }

  const {
    tool,
    brushSize,
    tolerance,
    ratio,
    busy,
    canUndo,
    canRedo,
    ontool,
    onbrushsize,
    ontolerance,
    onratio,
    onauto,
    onundo,
    onredo,
  }: Props = $props()

  const tools = [
    { id: EditorTool.BrushRemove, icon: '🧹', label: '消す' },
    { id: EditorTool.BrushKeep, icon: '🖌', label: '残す' },
    { id: EditorTool.BucketRemove, icon: '🪣', label: 'まとめて消す' },
    { id: EditorTool.BucketKeep, icon: '🫗', label: 'まとめて残す' },
    { id: EditorTool.Crop, icon: '✂️', label: 'トリミング' },
  ] as const

  const usingBucket = $derived(tool === EditorTool.BucketKeep || tool === EditorTool.BucketRemove)
  const usingCrop = $derived(tool === EditorTool.Crop)
</script>

<div
  class="flex items-center gap-2 overflow-x-auto rounded-[var(--radius-panel)] bg-surface-raised p-2 md:flex-col md:items-stretch md:overflow-visible"
>
  <button
    type="button"
    class="flex shrink-0 items-center gap-2 rounded-xl bg-accent px-4 py-3 font-bold text-accent-ink transition-opacity hover:opacity-85 disabled:opacity-50"
    disabled={busy}
    onclick={onauto}
  >
    <span aria-hidden="true">✨</span>
    背景をきりり
  </button>

  <div class="h-8 w-px shrink-0 bg-line md:h-px md:w-full" role="separator"></div>

  {#each tools as item (item.id)}
    <button
      type="button"
      class="flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 transition-colors"
      class:bg-accent={tool === item.id}
      class:text-accent-ink={tool === item.id}
      aria-pressed={tool === item.id}
      onclick={() => ontool(item.id)}
    >
      <span aria-hidden="true">{item.icon}</span>
      {item.label}
    </button>
  {/each}

  {#if usingCrop}
    <div class="flex shrink-0 flex-wrap gap-1 px-2 md:px-4" role="group" aria-label="縦横比">
      {#each ASPECT_PRESETS as preset (preset.label)}
        <button
          type="button"
          class="rounded-lg px-2 py-1 text-xs"
          class:bg-accent={ratio === preset.ratio}
          class:text-accent-ink={ratio === preset.ratio}
          aria-pressed={ratio === preset.ratio}
          onclick={() => onratio(preset.ratio)}
        >
          {preset.label}
        </button>
      {/each}
    </div>
  {:else if usingBucket}
    <label class="flex shrink-0 items-center gap-2 px-2 text-sm text-ink-muted md:px-4">
      <span class="whitespace-nowrap">色の幅</span>
      <input
        type="range"
        min="0.002"
        max="0.08"
        step="0.002"
        value={tolerance}
        class="w-28 accent-[var(--color-accent)] md:w-full"
        oninput={(event) => ontolerance(event.currentTarget.valueAsNumber)}
      />
    </label>
  {:else}
    <label class="flex shrink-0 items-center gap-2 px-2 text-sm text-ink-muted md:px-4">
      <span class="whitespace-nowrap">太さ</span>
      <input
        type="range"
        min="1"
        max="200"
        step="1"
        value={brushSize}
        class="w-28 accent-[var(--color-accent)] md:w-full"
        oninput={(event) => onbrushsize(event.currentTarget.valueAsNumber)}
      />
    </label>
  {/if}

  <div class="h-8 w-px shrink-0 bg-line md:h-px md:w-full" role="separator"></div>

  <!-- Labelled, not icon-only: the arrow glyphs render as near-invisible
       hairlines in the system stack, and these are the two controls a user
       reaches for most while correcting a mask. -->
  <div class="flex shrink-0 gap-1">
    <button
      type="button"
      class="flex items-center gap-1.5 rounded-xl px-3 py-3 text-sm disabled:opacity-40"
      disabled={!canUndo}
      onclick={onundo}
    >
      <span aria-hidden="true">◀</span>
      取り消す
    </button>
    <button
      type="button"
      class="flex items-center gap-1.5 rounded-xl px-3 py-3 text-sm disabled:opacity-40"
      disabled={!canRedo}
      onclick={onredo}
    >
      やり直す
      <span aria-hidden="true">▶</span>
    </button>
  </div>
</div>
