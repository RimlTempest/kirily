<script lang="ts">
  /**
   * The two controls every cutout tool has.
   *
   * Offered only once a mask exists, because there is no edge to adjust
   * before that. Both read in pixels rather than as a fraction: "pull it in
   * two pixels" is a thing someone can decide by looking, and a percentage of
   * an image they cannot see the size of is not.
   */
  import type { EdgeSettings } from '@kirily/image-core/edge'
  import { EDGE_LIMIT } from '@kirily/image-core/edge'

  type Props = {
    edge: EdgeSettings
    onedge: (edge: EdgeSettings) => void
  }

  const { edge, onedge }: Props = $props()

  const neutral = $derived(edge.shrink === 0 && edge.feather === 0)
</script>

<div class="flex flex-col gap-2 px-2 py-2 text-sm text-ink-muted md:px-4">
  <div class="flex items-center justify-between">
    <span class="font-bold">縁の調整</span>
    <button
      type="button"
      class="rounded-full px-2 py-0.5 text-xs hover:bg-line disabled:opacity-40"
      disabled={neutral}
      onclick={() => onedge({ shrink: 0, feather: 0 })}
    >
      戻す
    </button>
  </div>

  <label class="flex items-center gap-2">
    <span class="w-12 shrink-0 whitespace-nowrap">締める</span>
    <input
      type="range"
      min={-EDGE_LIMIT}
      max={EDGE_LIMIT}
      step="0.5"
      value={edge.shrink}
      class="w-full accent-[var(--color-accent)]"
      oninput={(event) => onedge({ ...edge, shrink: event.currentTarget.valueAsNumber })}
    />
    <span class="w-10 shrink-0 text-right tabular-nums">{edge.shrink}px</span>
  </label>

  <label class="flex items-center gap-2">
    <span class="w-12 shrink-0 whitespace-nowrap">ぼかし</span>
    <input
      type="range"
      min="0"
      max={EDGE_LIMIT}
      step="0.5"
      value={edge.feather}
      class="w-full accent-[var(--color-accent)]"
      oninput={(event) => onedge({ ...edge, feather: event.currentTarget.valueAsNumber })}
    />
    <span class="w-10 shrink-0 text-right tabular-nums">{edge.feather}px</span>
  </label>
</div>
