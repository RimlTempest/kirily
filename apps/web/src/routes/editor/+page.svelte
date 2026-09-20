<script lang="ts">
  import { onMount } from 'svelte'
  import { userMessage } from '@kirily/contract/error'
  import { EditorTool } from '@kirily/editor-core/state'
  import type { ImagePoint } from '@kirily/contract/geometry'
  import Dropzone from '$lib/components/upload/Dropzone.svelte'
  import EditorCanvas from '$lib/components/editor/EditorCanvas.svelte'
  import Toolbar from '$lib/components/editor/Toolbar.svelte'
  import { createEditorStore } from '$lib/editor/editor-store.svelte.ts'
  import { ExportFormat } from '$lib/editor/export.ts'
  import { pendingFile } from '$lib/editor/pending-file.svelte.ts'

  const store = createEditorStore()

  let tool = $state<EditorTool>(EditorTool.BrushRemove)

  const busy = $derived(store.status.kind !== 'idle' && store.status.kind !== 'error')

  /**
   * Naming the model that ran is what makes a coarse result explainable
   * instead of feeling like a bug — and it is the only place the user can see
   * that their device fell back.
   */
  const MODEL_LABELS: Record<string, string> = {
    'birefnet-lite': '高精度モデル',
    'isnet-general-use': '高精度モデル',
    u2netp: '軽量モデル',
    'local-threshold': '簡易処理',
  }
  const modelLabel = $derived(MODEL_LABELS[store.providerId] ?? '')
  const painting = $derived(tool === EditorTool.BrushKeep || tool === EditorTool.BrushRemove)

  const statusText = $derived.by(() => {
    switch (store.status.kind) {
      case 'decoding':
        return '読み込み中…'
      case 'ai-loading':
        return store.status.progress > 0
          ? `AI を準備しています… ${Math.round(store.status.progress * 100)}%`
          : 'AI を準備しています…'
      case 'ai-processing':
        return 'きりり中…'
      case 'exporting':
        return '書き出し中…'
      case 'error':
        return userMessage(store.status.error)
      case 'idle':
        return ''
    }
  })

  onMount(() => {
    const file = pendingFile.take()
    if (file !== null) void store.open(file)
  })

  const onStroke = (points: readonly ImagePoint[]): void => {
    store.paint(points, tool === EditorTool.BrushKeep ? 'keep' : 'remove')
  }

  const onKeydown = (event: KeyboardEvent): void => {
    const meta = event.metaKey || event.ctrlKey
    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) store.redo()
      else store.undo()
    }
    if (event.key === '[') store.setBrushSize((store.state?.brush.size ?? 32) - 4)
    if (event.key === ']') store.setBrushSize((store.state?.brush.size ?? 32) + 4)
  }
</script>

<svelte:head>
  <title>編集 — Kirily</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<main class="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-4 px-3 py-4">
  <header class="flex items-center justify-between gap-4">
    <a href="/" class="text-sm font-bold tracking-[0.2em] text-ink-muted">← KIRILY</a>
    {#if store.image !== null}
      <p class="truncate text-xs text-ink-muted">
        {store.image.source.width} × {store.image.source.height}
      </p>
    {/if}
  </header>

  {#if store.image === null || store.state === null}
    <section class="flex flex-1 flex-col justify-center gap-4">
      {#if store.lastError !== null}
        <p role="alert" class="text-center text-sm text-danger">
          {userMessage(store.lastError)}
        </p>
      {/if}
      <Dropzone onfile={(file) => void store.open(file)} />
    </section>
  {:else}
    <div class="flex flex-1 flex-col gap-3 md:flex-row-reverse">
      <section class="min-h-[50vh] flex-1">
        <EditorCanvas
          preview={store.image.preview}
          mask={store.previewMask}
          version={store.previewVersion}
          {painting}
          brushSize={store.state.brush.size}
          previewScale={store.image.preview.width / store.image.source.width}
          onstroke={onStroke}
        />
      </section>

      <div class="md:w-56">
        <Toolbar
          {tool}
          brushSize={store.state.brush.size}
          {busy}
          canUndo={store.canUndo}
          canRedo={store.canRedo}
          ontool={(next) => (tool = next)}
          onbrushsize={(size) => store.setBrushSize(size)}
          onauto={() => void store.removeBackground()}
          onundo={() => store.undo()}
          onredo={() => store.redo()}
        />
      </div>
    </div>

    <footer class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-xs text-ink-muted" aria-live="polite">
        {statusText === '' ? store.privacyLabel : statusText}
        {#if statusText === '' && modelLabel !== ''}
          <span class="opacity-70">· {modelLabel}</span>
        {/if}
      </p>
      <button
        type="button"
        class="rounded-full bg-ink px-6 py-3 font-bold text-surface transition-opacity hover:opacity-85 disabled:opacity-50"
        disabled={busy}
        onclick={() => void store.download(ExportFormat.Png)}
      >
        ⬇️ PNG で書き出す
      </button>
    </footer>
  {/if}
</main>
