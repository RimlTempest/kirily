<script lang="ts">
  /**
   * Where the time went, for whoever is measuring.
   *
   * Off unless `?timings=1` is in the URL. It is a developer's instrument, not
   * a feature: showing a user "ai_inference 812ms" tells them nothing they can
   * act on, and the panel would be one more thing covering their image.
   *
   * Everything here is a stage name and a duration. No file name, no pixel —
   * the same rule the error codes follow (IMPLEMENTATION.md §57).
   */
  import type { Timings } from '@kirily/contract/timing'
  import { formatTimings } from '@kirily/contract/timing'

  type Props = { timings: Timings }
  const { timings }: Props = $props()

  const line = $derived(formatTimings(timings))
</script>

{#if line !== ''}
  <p
    class="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-surface-raised/95 px-3 py-1 font-mono text-xs text-ink-muted"
    data-testid="timings"
  >
    {line}
  </p>
{/if}
