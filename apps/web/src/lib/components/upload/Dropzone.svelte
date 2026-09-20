<script lang="ts">
  import { SupportedMimeType } from '@kirily/contract/image'

  type Props = {
    onfile: (file: File) => void
    disabled?: boolean
  }

  const { onfile, disabled = false }: Props = $props()

  let dragging = $state(false)
  let input: HTMLInputElement | null = $state(null)

  const accept = Object.values(SupportedMimeType).join(',')

  const take = (files: FileList | null | undefined): void => {
    const file = files?.[0]
    if (file !== undefined) onfile(file)
  }

  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    dragging = false
    take(event.dataTransfer?.files)
  }
</script>

<!--
  The whole region is a drop target, but the *control* is the button: a drop
  zone alone is unreachable by keyboard and invisible to a screen reader.
-->
<div
  class="checkerboard grid place-items-center rounded-[var(--radius-panel)] border-2 border-dashed p-10 transition-colors sm:p-16"
  class:border-accent={dragging}
  class:border-line={!dragging}
  ondragover={(event) => {
    event.preventDefault()
    dragging = true
  }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
  role="presentation"
>
  <div
    class="flex flex-col items-center gap-4 rounded-2xl bg-surface-raised/90 px-6 py-8 text-center"
  >
    <p class="text-lg font-bold">
      {dragging ? 'ここにドロップ ✨' : 'ここに画像をドロップ'}
    </p>
    <p class="text-sm text-ink-muted">または</p>
    <button
      type="button"
      class="rounded-full bg-accent px-6 py-3 font-bold text-accent-ink transition-opacity hover:opacity-85 disabled:opacity-50"
      {disabled}
      onclick={() => input?.click()}
    >
      画像を選択
    </button>
    <p class="text-xs text-ink-muted">PNG / JPEG / WebP</p>
  </div>

  <input
    bind:this={input}
    type="file"
    class="sr-only"
    {accept}
    aria-label="編集する画像を選ぶ"
    onchange={(event) => take(event.currentTarget.files)}
  />
</div>
