<script lang="ts">
  /**
   * One toolbar for both layouts. Desktop puts it down the left edge, mobile
   * across the bottom where a thumb reaches (kirily-design.md §15) — the
   * controls and their labels are the same, so there is one thing to keep
   * accessible rather than two.
   */
  import { ASPECT_PRESETS } from '@kirily/editor-core/crop'
  import type { EdgeSettings } from '@kirily/image-core/edge'
  import EdgePanel from './EdgePanel.svelte'
  import { EditorTool } from '@kirily/editor-core/state'

  type Props = {
    tool: EditorTool
    brushSize: number
    tolerance: number
    /** Whether the bucket may use the AI's mask to stay on one side of the subject. */
    guided: boolean
    /** True once a mask exists; without one there is nothing to be guided by. */
    hasMask: boolean
    edge: EdgeSettings
    ontrim: () => void
    ratio: number | null
    busy: boolean
    canUndo: boolean
    canRedo: boolean
    ontool: (tool: EditorTool) => void
    onbrushsize: (size: number) => void
    ontolerance: (tolerance: number) => void
    onguided: (guided: boolean) => void
    onedge: (edge: EdgeSettings) => void
    onratio: (ratio: number | null) => void
    onauto: () => void
    onundo: () => void
    onredo: () => void
  }

  const {
    tool,
    brushSize,
    tolerance,
    guided,
    hasMask,
    edge,
    ratio,
    busy,
    canUndo,
    canRedo,
    ontool,
    onbrushsize,
    ontolerance,
    onguided,
    onedge,
    ontrim,
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
    {#if hasMask}
      <!-- Next to the ratios because it *is* a crop: it picks the rectangle
           the subject actually occupies, which is the one a cut-out almost
           always wants and nobody wants to drag by hand. -->
      <button
        type="button"
        class="shrink-0 rounded-lg px-2 py-2 text-left text-sm text-ink-muted hover:bg-line md:px-4"
        onclick={ontrim}
      >
        ⤡ 余白を詰める
      </button>
    {/if}
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
    <!-- Offered only once there is a mask: a switch that cannot do anything
         is worse than no switch. Off is for correcting the mask itself, which
         is the one job the mask is no help with. -->
    {#if hasMask}
      <label class="flex shrink-0 items-center gap-2 px-2 text-sm text-ink-muted md:px-4">
        <input
          type="checkbox"
          checked={guided}
          class="accent-[var(--color-accent)]"
          oninput={(event) => onguided(event.currentTarget.checked)}
        />
        <span class="whitespace-nowrap">AI の輪郭で止める</span>
      </label>
    {/if}
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

  {#if hasMask}
    <div class="shrink-0 border-t border-line pt-1">
      <EdgePanel {edge} {onedge} />
    </div>
  {/if}

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
