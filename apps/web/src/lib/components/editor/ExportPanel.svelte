<script lang="ts">
  /**
   * Choosing what the file will be.
   *
   * Three formats, and the two lossy ones need an answer before they can be
   * written. The options appear only for the format that uses them: a quality
   * slider next to PNG would be a control that does nothing, and a background
   * colour next to WebP would suggest the transparency is about to be thrown
   * away when it is not.
   *
   * The button says which format it will write, so the choice is readable
   * without opening anything.
   */
  import type { Rgb } from '@kirily/image-core/composite'
  import { ExportFormat } from '$lib/editor/export.ts'
  import type { ExportSettings } from '$lib/editor/export-settings.ts'
  import {
    BACKGROUND_PRESETS,
    fromHex,
    isLossy,
    needsBackground,
    toHex,
  } from '$lib/editor/export-settings.ts'

  type Props = {
    settings: ExportSettings
    busy: boolean
    onformat: (format: ExportFormat) => void
    onquality: (quality: number) => void
    onbackground: (background: Rgb) => void
    onexport: () => void
  }

  const { settings, busy, onformat, onquality, onbackground, onexport }: Props = $props()

  const FORMATS: readonly { readonly value: ExportFormat; readonly label: string }[] = [
    { value: ExportFormat.Png, label: 'PNG' },
    { value: ExportFormat.WebP, label: 'WebP' },
    { value: ExportFormat.Jpeg, label: 'JPEG' },
  ]

  const label = $derived(FORMATS.find((entry) => entry.value === settings.format)?.label ?? 'PNG')
  const lossy = $derived(isLossy(settings.format))
  const flattens = $derived(needsBackground(settings.format))
  const percent = $derived(Math.round(settings.quality * 100))

  const same = (a: Rgb, b: Rgb): boolean => a.r === b.r && a.g === b.g && a.b === b.b

  const readColour = (event: Event): void => {
    const target = event.currentTarget
    if (target instanceof HTMLInputElement) onbackground(fromHex(target.value, settings.background))
  }
</script>

<div class="flex flex-wrap items-center justify-end gap-3">
  <div
    role="group"
    aria-label="書き出す形式"
    class="flex items-center gap-1 rounded-full bg-surface-raised p-1 text-xs"
  >
    {#each FORMATS as entry (entry.value)}
      <button
        type="button"
        class="rounded-full px-3 py-1.5 {settings.format === entry.value
          ? 'bg-accent font-bold text-surface'
          : 'text-ink-muted hover:bg-line'}"
        aria-pressed={settings.format === entry.value}
        onclick={() => onformat(entry.value)}
      >
        {entry.label}
      </button>
    {/each}
  </div>

  {#if lossy}
    <label class="flex items-center gap-2 text-xs text-ink-muted">
      品質
      <input
        type="range"
        min="10"
        max="100"
        step="1"
        value={percent}
        class="w-28 accent-accent"
        oninput={(event) => onquality(Number(event.currentTarget.value) / 100)}
      />
      <span class="w-9 text-right tabular-nums">{percent}%</span>
    </label>
  {/if}

  {#if flattens}
    <div role="group" aria-label="透明部分の色" class="flex items-center gap-1 text-xs">
      <!-- JPEG has no alpha, so the cut-out is about to be composited onto
           this. Saying so is shorter than explaining why it looks different. -->
      <span class="text-ink-muted">透明部分</span>
      {#each BACKGROUND_PRESETS as preset (preset.label)}
        <button
          type="button"
          class="h-6 w-6 rounded-full border-2 {same(settings.background, preset.rgb)
            ? 'border-accent'
            : 'border-line'}"
          style:background={toHex(preset.rgb)}
          aria-label={preset.label}
          aria-pressed={same(settings.background, preset.rgb)}
          onclick={() => onbackground(preset.rgb)}
        ></button>
      {/each}
      <input
        type="color"
        value={toHex(settings.background)}
        class="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
        aria-label="透明部分の色を選ぶ"
        oninput={readColour}
      />
    </div>
  {/if}

  <button
    type="button"
    class="rounded-full bg-ink px-6 py-3 font-bold text-surface transition-opacity hover:opacity-85 disabled:opacity-50"
    disabled={busy}
    onclick={onexport}
  >
    ⬇️ {label} で書き出す
  </button>
</div>
