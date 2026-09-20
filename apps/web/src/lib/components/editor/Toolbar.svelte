<script lang="ts">
  /**
   * One toolbar for both layouts. Desktop puts it down the left edge, mobile
   * across the bottom where a thumb reaches (kirily-design.md §15) — the
   * controls and their labels are the same, so there is one thing to keep
   * accessible rather than two.
   */
  import { EditorTool } from '@kirily/editor-core/state'

  type Props = {
    tool: EditorTool
    brushSize: number
    busy: boolean
    canUndo: boolean
    canRedo: boolean
    ontool: (tool: EditorTool) => void
    onbrushsize: (size: number) => void
    onauto: () => void
    onundo: () => void
    onredo: () => void
  }

  const {
    tool,
    brushSize,
    busy,
    canUndo,
    canRedo,
    ontool,
    onbrushsize,
    onauto,
    onundo,
    onredo,
  }: Props = $props()

  const tools = [
    { id: EditorTool.BrushRemove, icon: '🧹', label: '消す' },
    { id: EditorTool.BrushKeep, icon: '🖌', label: '残す' },
  ] as const
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

  <div class="h-8 w-px shrink-0 bg-line md:h-px md:w-full" role="separator"></div>

  <div class="flex shrink-0 gap-1">
    <button
      type="button"
      class="rounded-xl px-4 py-3 disabled:opacity-40"
      disabled={!canUndo}
      onclick={onundo}
    >
      <span aria-hidden="true">↶</span>
      <span class="sr-only">取り消す</span>
    </button>
    <button
      type="button"
      class="rounded-xl px-4 py-3 disabled:opacity-40"
      disabled={!canRedo}
      onclick={onredo}
    >
      <span aria-hidden="true">↷</span>
      <span class="sr-only">やり直す</span>
    </button>
  </div>
</div>
