<script lang="ts">
  import { onMount } from 'svelte'
  import { userMessage } from '@kirily/contract/error'
  import { EditorTool, isBucket, modeOf } from '@kirily/editor-core/state'
  import type { ImagePoint, ScreenPoint } from '@kirily/contract/geometry'
  import { screenPoint } from '@kirily/contract/geometry'
  import { DEFAULT_BUCKET } from '@kirily/contract/mask'
  import Dropzone from '$lib/components/upload/Dropzone.svelte'
  import EditorCanvas from '$lib/components/editor/EditorCanvas.svelte'
  import CropOverlay from '$lib/components/editor/CropOverlay.svelte'
  import ZoomControls from '$lib/components/editor/ZoomControls.svelte'
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
  const filling = $derived(isBucket(tool))
  const cropping = $derived(tool === EditorTool.Crop)

  let ratio = $state<number | null>(null)

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
    const mode = modeOf(tool)
    if (mode !== null) store.paint(points, mode)
  }

  const onFill = (at: ImagePoint): void => {
    const mode = modeOf(tool)
    if (mode !== null) store.bucketFill(at, mode)
  }

  /** The canvas' own size, so zoom presets can aim at its centre. */
  let canvasSize = $state({ width: 0, height: 0 })
  const centre = (): ScreenPoint => screenPoint(canvasSize.width / 2, canvasSize.height / 2)

  const onResize = (size: { width: number; height: number }): void => {
    const first = canvasSize.width === 0
    canvasSize = size
    // The starting view shows the whole image; later resizes must not yank
    // the user's zoom away from them.
    if (first) store.fit(size)
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

    // The shortcuts every editor has. Without them, zooming means reaching for
    // the toolbar on every correction.
    if (meta && (event.key === '+' || event.key === '=')) {
      event.preventDefault()
      store.setZoom((store.viewport.scale ?? 1) * 2, centre())
    }
    if (meta && event.key === '-') {
      event.preventDefault()
      store.setZoom((store.viewport.scale ?? 1) / 2, centre())
    }
    if (meta && event.key === '0') {
      event.preventDefault()
      store.fit(canvasSize)
    }
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
      <section class="relative min-h-[50vh] flex-1">
        <EditorCanvas
          image={{ ...store.image.source, rgba: store.image.rgba }}
          preview={store.image.preview}
          mask={store.mask}
          version={store.maskVersion}
          viewport={store.viewport}
          {painting}
          {filling}
          brushSize={store.state.brush.size}
          onstroke={onStroke}
          onfill={onFill}
          onzoom={(anchor, scale) => store.zoomAt(anchor, scale)}
          onpan={(dx, dy) => store.pan(dx, dy)}
          onresize={onResize}
        />

        {#if cropping && store.crop !== null && store.image !== null}
          <CropOverlay
            crop={store.crop}
            image={store.image.source}
            viewport={store.viewport}
            {ratio}
            oncrop={(rect) => store.setCrop(rect)}
          />
        {/if}
        <div class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <div class="pointer-events-auto">
            <ZoomControls
              scale={store.viewport.scale}
              onzoom={(scale) => store.setZoom(scale, centre())}
              onfit={() => store.fit(canvasSize)}
            />
          </div>
        </div>
      </section>

      <div class="md:w-56">
        <Toolbar
          {tool}
          brushSize={store.state.brush.size}
          tolerance={store.state.bucket.tolerance}
          {ratio}
          {busy}
          canUndo={store.canUndo}
          canRedo={store.canRedo}
          ontool={(next) => {
            tool = next
            // Entering the crop tool with nothing selected would show an
            // invisible rectangle; start from the whole image instead.
            if (next === EditorTool.Crop && store.crop === null) store.beginCrop()
          }}
          onbrushsize={(size) => store.setBrushSize(size)}
          ontolerance={(value) =>
            store.setBucket({ ...(store.state?.bucket ?? DEFAULT_BUCKET), tolerance: value })}
          onratio={(value) => (ratio = value)}
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
