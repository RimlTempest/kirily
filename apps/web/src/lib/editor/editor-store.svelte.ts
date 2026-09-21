/**
 * The bridge between Svelte and the editor core.
 *
 * Everything that decides *what* an edit means lives in `@kirily/editor-core`.
 * This file owns only what Svelte needs: reactive references, the decoded
 * pixels, and the buffers the renderer reuses. Components call these actions;
 * they never reach for the mask or the canvas themselves (Rule 1, Rule 6).
 */
import type { BackgroundRemovalProvider } from '@kirily/ai/provider'
import type { KirilyError } from '@kirily/contract/error'
import { exportFileName } from '@kirily/contract/image'
import type { ImagePoint, Rect, ScreenPoint, Viewport } from '@kirily/contract/geometry'
import {
  IDENTITY_VIEWPORT,
  fitViewport,
  nextQuarter,
  panBy,
  zoomAt,
} from '@kirily/contract/geometry'
import type { BrushMode, BucketSettings } from '@kirily/contract/mask'
import type { EditorState, EditorStatus } from '@kirily/editor-core/state'
import {
  createEditorState,
  dispatch,
  exportRect,
  redoState,
  undoState,
  withBrush,
  withBucket,
  withStatus,
  withViewport,
} from '@kirily/editor-core/state'
import { canRedo, canUndo } from '@kirily/editor-core/history'
import { resample } from '@kirily/editor-core/commands'
import { cropToSubject, fullCrop } from '@kirily/editor-core/crop'
import { composeMask } from '@kirily/image-core/mask'
import type { Rgb } from '@kirily/image-core/composite'
import { budgetFor } from '@kirily/image-core/preview'
import type { ImageEngine } from '@kirily/wasm'
import { loadImageEngine } from '@kirily/wasm'
import { createWorkerProvider, spawnAiWorker } from './ai-client.ts'
import type { DecodedImage } from './decode.ts'
import type { ColourField } from '@kirily/image-core/field'
import type { EdgeSettings } from '@kirily/image-core/edge'
import { DEFAULT_EDGE, adjustEdge, clampEdge, isNeutral } from '@kirily/image-core/edge'
import type { Stage, Timings } from '@kirily/contract/timing'
import { Stage as Stages, createStopwatch, replayTimings } from '@kirily/contract/timing'
import { removeBackground as removeBackgroundFlow } from './remove-background.ts'
import { decodeBackdrop, decodeFile } from './decode.ts'
import type { ExportFormat } from './export.ts'
import { canCopy, writeImage } from './clipboard.ts'
import { downloadBlob, exportImage, extensionFor } from './export.ts'
import type { Backdrop as BackdropImage } from '@kirily/image-core/backdrop'
import type { Placement } from '@kirily/image-core/placement'
import { DEFAULT_PLACEMENT, moveBy, zoomBy } from '@kirily/image-core/placement'
import type { Backdrop, ExportSettings } from './export-settings.ts'
import {
  Backdrop as Backdrops,
  DEFAULT_EXPORT,
  effectiveBackdrop,
  withBackdrop,
  withBackground,
  withFormat,
  withQuality,
} from './export-settings.ts'

export type EditorStore = ReturnType<typeof createEditorStore>

export const createEditorStore = (
  /**
   * Built inside rather than defaulted in the parameter list: the default one
   * reports its timings to this store's own clock, which does not exist yet
   * when the parameters are evaluated.
   */
  injected: BackgroundRemovalProvider | null = null,
) => {
  // `$state.raw`, not `$state`: both hold multi-megabyte pixel and mask
  // buffers and are always replaced wholesale, never mutated field by field.
  // Deep proxying them would cost on every read and buy nothing.
  let decoded = $state.raw<DecodedImage | null>(null)
  let editor = $state.raw<EditorState | null>(null)
  /** Set when a file could not be opened at all — before there is any state. */
  let lastError = $state<KirilyError | null>(null)
  /**
   * Which model last produced a mask. Mirrored into reactive state because the
   * provider's own `info` is a plain object: the chain updates it when it
   * falls back, and nothing would re-render.
   */
  let providerId = $state('')
  let engine: ImageEngine | null = null

  /**
   * Composed mask at original resolution. Reused; never reallocated per edit.
   * Raw and mutated in place — `maskVersion` is what the renderer watches,
   * because comparing several megabytes of mask on every edit is the thing to
   * avoid.
   */
  let fullMask = $state.raw(new Uint8Array(0))
  let maskVersion = $state(0)

  /**
   * The old background, measured once from the AI's own mask.
   *
   * Not recomputed per stroke: it describes the photograph, which does not
   * change while the user paints, and a full-image scan on every dab would be
   * the most expensive thing in the editor. Null until the AI has run — a
   * hand-painted mask gives no basis for saying what was behind the subject.
   */
  let backgroundField = $state.raw<ColourField | null>(null)

  /**
   * Kept for the session rather than per export: someone who picked WebP at
   * 80% means it for the next one too.
   */
  let exportSettings = $state.raw<ExportSettings>(DEFAULT_EXPORT)

  /**
   * A view of the mask, not an edit to it — the same standing as the crop.
   * Applied while composing, so the renderer and the exporter see one thing
   * and undo has nothing to do with it.
   */
  let edge = $state.raw<EdgeSettings>(DEFAULT_EDGE)

  /** The picture chosen to go behind, decoded once and kept. */
  let backdropImage = $state.raw<BackdropImage | null>(null)

  /**
   * Where the two movable layers sit.
   *
   * Views, like the crop and the edge: applied when something is drawn or
   * written, never folded into the mask, so undo stays about the mask.
   */
  let subjectPlacement = $state.raw<Placement>(DEFAULT_PLACEMENT)
  let backdropPlacement = $state.raw<Placement>(DEFAULT_PLACEMENT)

  /**
   * Where the time went, for the run the user is looking at.
   *
   * "The AI is slow" and "the encoder is slow" need opposite work and look
   * identical from outside (IMPLEMENTATION.md §59). Cleared when a new file is
   * opened, so the numbers always describe one image.
   */
  const clock = createStopwatch(() => performance.now())
  let timings = $state.raw<Timings>({})
  const record = (stage: Stage, ms: number): void => {
    clock.record(stage, ms)
    timings = clock.timings()
  }

  const provider: BackgroundRemovalProvider =
    injected
    ?? createWorkerProvider({
      createWorker: spawnAiWorker,
      onTimings: (taken) => replayTimings(taken, record),
    })

  const engineOrLoad = async (): Promise<ImageEngine> => {
    engine ??= await loadImageEngine()
    return engine
  }

  const recompose = (): void => {
    if (editor === null) return
    composeMask(editor.mask, fullMask)
    if (!isNeutral(edge)) adjustEdge(fullMask, editor.mask, edge)
    maskVersion += 1
  }

  /**
   * Encodes what is on screen, once, for whoever asked.
   *
   * Download and copy differ only in where the blob goes, and having them
   * share this is what stops one of them quietly getting a different picture.
   */
  const render = async (): Promise<Blob | null> => {
    if (editor === null || decoded === null) return null
    editor = withStatus(editor, { kind: 'exporting' })

    // The engine is loaded outside the measurement: on a first export that
    // is a WASM compile, and folding it in would make encoding look slow.
    const ready = await engineOrLoad()
    const behind = effectiveBackdrop(exportSettings)
    const source = {
      width: decoded.source.width,
      height: decoded.source.height,
      rgba: decoded.rgba,
      mask: fullMask,
      background: backgroundField,
    }
    const request = {
      format: exportSettings.format,
      quality: exportSettings.quality,
      background: exportSettings.background,
      backdrop: behind === Backdrops.Image ? backdropImage : null,
      backdropPlacement,
      subjectPlacement,
      flatten: behind === Backdrops.Colour,
      rect: exportRect(editor),
    }
    const result = await clock.measureAsync(Stages.Export, () =>
      exportImage(ready, source, request),
    )
    timings = clock.timings()
    if (!result.ok) {
      fail(result.error)
      return null
    }
    return result.value
  }

  const fail = (error: KirilyError): void => {
    if (editor === null) return
    editor = withStatus(editor, { kind: 'error', error })
  }

  return {
    get image(): DecodedImage | null {
      return decoded
    },
    get state(): EditorState | null {
      return editor
    },
    /** The composed mask, at the original resolution. */
    get mask(): Uint8Array {
      return fullMask
    },
    /** Bumped on every mask change so the canvas knows to redraw. */
    get maskVersion(): number {
      return maskVersion
    },
    /** The old background, once the AI has measured it. */
    get background(): ColourField | null {
      return backgroundField
    },
    get edge(): EdgeSettings {
      return edge
    },
    setEdge(next: EdgeSettings): void {
      edge = clampEdge(next)
      recompose()
    },
    /** Trims the crop to what is actually visible. */
    trimToSubject(): void {
      if (editor === null || decoded === null) return
      const next = dispatch(editor, {
        kind: 'set-crop',
        rect: cropToSubject(fullMask, decoded.source),
      })
      if (!next.ok) return fail(next.error)
      editor = next.value
    },
    /**
     * Turns the view a quarter, and refits so the whole picture is on screen
     * in its new shape.
     *
     * Refitting rather than keeping the zoom: the point of turning is that a
     * wide photograph fills a tall screen, and holding the old zoom throws
     * that away. Someone who had zoomed in was looking at a detail, and after
     * a turn they have to find it again anyway.
     */
    rotateView(container: { readonly width: number; readonly height: number }): void {
      if (editor === null) return
      const rotation = nextQuarter(editor.viewport.rotation)
      editor = withViewport(editor, fitViewport(editor.source, container, rotation))
    },

    /** True once the AI has produced a mask, so the bucket has something to follow. */
    get hasMask(): boolean {
      return backgroundField !== null
    },
    /** Where the time went. Empty until something has been measured. */
    get timings(): Timings {
      return timings
    },
    /** Called by the canvas after each composite. */
    recordRender(ms: number): void {
      record(Stages.PreviewRender, ms)
    },

    get exportSettings(): ExportSettings {
      return exportSettings
    },
    setExportFormat(format: ExportFormat): void {
      exportSettings = withFormat(exportSettings, format)
    },
    setExportQuality(quality: number): void {
      exportSettings = withQuality(exportSettings, quality)
    },
    setExportBackground(background: Rgb): void {
      exportSettings = withBackground(exportSettings, background)
    },
    setBackdrop(backdrop: Backdrop): void {
      exportSettings = withBackdrop(exportSettings, backdrop)
    },
    get backdropImage(): BackdropImage | null {
      return backdropImage
    },

    get subjectPlacement(): Placement {
      return subjectPlacement
    },
    get backdropPlacement(): Placement {
      return backdropPlacement
    },
    /** `dx`/`dy` are image pixels, so a drag has to divide by the zoom first. */
    moveSubject(dx: number, dy: number): void {
      subjectPlacement = moveBy(subjectPlacement, dx, dy)
    },
    moveBackdrop(dx: number, dy: number): void {
      backdropPlacement = moveBy(backdropPlacement, dx, dy)
    },
    zoomSubject(factor: number, atX: number, atY: number): void {
      if (decoded === null) return
      subjectPlacement = zoomBy(subjectPlacement, factor, atX, atY, decoded.source)
    },
    zoomBackdrop(factor: number, atX: number, atY: number): void {
      if (decoded === null) return
      backdropPlacement = zoomBy(backdropPlacement, factor, atX, atY, decoded.source)
    },
    resetPlacements(): void {
      subjectPlacement = DEFAULT_PLACEMENT
      backdropPlacement = DEFAULT_PLACEMENT
    },
    /** Decodes a picture to put behind, and switches to it. */
    chooseBackdrop: async (file: File): Promise<void> => {
      const decodedBackdrop = await decodeBackdrop(file)
      if (!decodedBackdrop.ok) {
        lastError = decodedBackdrop.error
        return
      }
      backdropImage = decodedBackdrop.value
      exportSettings = withBackdrop(exportSettings, Backdrops.Image)
    },
    get viewport(): Viewport {
      return editor?.viewport ?? IDENTITY_VIEWPORT
    },
    get status(): EditorStatus {
      return editor?.status ?? { kind: 'idle' }
    },
    get canUndo(): boolean {
      return editor !== null && canUndo(editor.history)
    },
    get canRedo(): boolean {
      return editor !== null && canRedo(editor.history)
    },
    /** What the UI tells the user about where their image goes. */
    get privacyLabel(): string {
      return provider.info.label
    },
    /** Which model actually ran. Surfaced so "why is this coarse?" is answerable. */
    get providerId(): string {
      return providerId
    },

    open: async (file: File): Promise<void> => {
      const budget = budgetFor({
        isMobile: globalThis.matchMedia?.('(pointer: coarse)').matches ?? false,
        deviceMemoryGb: readDeviceMemory(),
      })

      clock.clear()
      timings = {}
      const result = await decodeFile(file, budget, record)
      if (!result.ok) {
        decoded = null
        editor = null
        lastError = result.error
        return
      }

      lastError = null
      decoded = result.value
      editor = createEditorState(result.value.source)
      fullMask = new Uint8Array(result.value.source.width * result.value.source.height)
      recompose()
    },

    /** "背景をきりり" — runs the provider and replaces the AI layer. */
    removeBackground: async (): Promise<void> => {
      if (editor === null || decoded === null) return
      editor = withStatus(editor, { kind: 'ai-loading', progress: 0 })

      const result = await removeBackgroundFlow(
        {
          provider,
          engine: engineOrLoad,
          onLoadProgress: (progress) => {
            if (editor !== null) editor = withStatus(editor, { kind: 'ai-loading', progress })
          },
          onInferenceStart: () => {
            if (editor !== null) editor = withStatus(editor, { kind: 'ai-processing' })
          },
          onRefineSkipped: (error) => console.warn('[kirily] mask refinement skipped:', error.code),
          record,
        },
        decoded,
      )
      providerId = provider.info.id
      if (!result.ok) return fail(result.error)

      const next = dispatch(editor, { kind: 'replace-base-mask', alpha: result.value.alpha })
      if (!next.ok) return fail(next.error)

      editor = withStatus(next.value, { kind: 'idle' })
      recompose()
      backgroundField = result.value.background
    },

    paint: (points: readonly ImagePoint[], mode: BrushMode): void => {
      if (editor === null) return
      const brush = editor.brush
      const resampled = resample(points, brush)
      if (resampled.length === 0) return

      const next = dispatch(editor, { kind: 'brush-stroke', mode, brush, points: resampled })
      if (!next.ok) return fail(next.error)
      editor = next.value
      recompose()
    },

    /** One click takes the whole region in or out. */
    bucketFill: (at: ImagePoint, mode: BrushMode): void => {
      if (editor === null || decoded === null) return

      const next = dispatch(editor, {
        kind: 'bucket-fill',
        // The AI's own layer, not the composed mask: the composed one already
        // has the user's corrections in it, so a fill would be guided by its
        // own earlier fills.
        guide: editor.mask.base.length === fullMask.length ? editor.mask.base : null,
        mode,
        at,
        settings: editor.bucket,
        // The original pixels, not the preview: a click at 25% zoom has to
        // pick the same region as one at 100%.
        rgba: decoded.rgba,
      })
      if (!next.ok) return fail(next.error)
      editor = next.value
      recompose()
    },

    /** The crop the export will read, or the whole image when unset. */
    get crop(): Rect | null {
      return editor?.crop ?? null
    },

    setCrop: (rect: Rect | null): void => {
      if (editor === null) return
      const next = dispatch(editor, { kind: 'set-crop', rect })
      if (!next.ok) return fail(next.error)
      editor = next.value
    },

    /** Starts cropping with the whole image selected. */
    beginCrop: (): void => {
      if (editor === null) return
      const next = dispatch(editor, { kind: 'set-crop', rect: fullCrop(editor.source) })
      if (!next.ok) return fail(next.error)
      editor = next.value
    },

    setBucket: (bucket: BucketSettings): void => {
      if (editor === null) return
      editor = withBucket(editor, bucket)
    },

    /** Zooms around a point on screen, keeping what is under it in place. */
    zoomAt: (anchor: ScreenPoint, scale: number): void => {
      if (editor === null) return
      editor = withViewport(editor, zoomAt(editor.viewport, anchor, scale))
    },

    pan: (dx: number, dy: number): void => {
      if (editor === null) return
      editor = withViewport(editor, panBy(editor.viewport, dx, dy))
    },

    /** Shows the whole image, centred. Also the starting view. */
    fit: (container: { readonly width: number; readonly height: number }): void => {
      if (editor === null) return
      // Keeps the turn. Fitting is about the frame, not about which way up the
      // picture is being looked at.
      editor = withViewport(editor, fitViewport(editor.source, container, editor.viewport.rotation))
    },

    /** Jumps to a preset zoom, keeping the centre of the view still. */
    setZoom: (scale: number, centre: ScreenPoint): void => {
      if (editor === null) return
      editor = withViewport(editor, zoomAt(editor.viewport, centre, scale))
    },

    setBrushSize: (size: number): void => {
      if (editor === null) return
      editor = withBrush(editor, { ...editor.brush, size: Math.max(1, Math.min(400, size)) })
    },

    undo: (): void => {
      if (editor === null) return
      editor = undoState(editor)
      recompose()
    },

    redo: (): void => {
      if (editor === null) return
      editor = redoState(editor)
      recompose()
    },

    /** True when this browser will let the result be copied. */
    get canCopy(): boolean {
      return canCopy()
    },

    /** Encodes and puts the result on the clipboard instead of on disk. */
    copy: async (): Promise<void> => {
      const encoded = await render()
      if (encoded === null) return
      const written = await writeImage(encoded)
      if (!written.ok) return fail(written.error)
      if (editor !== null) editor = withStatus(editor, { kind: 'idle' })
    },

    download: async (): Promise<void> => {
      const { format } = exportSettings
      const encoded = await render()
      if (encoded === null || decoded === null || editor === null) return
      downloadBlob(encoded, exportFileName(decoded.source.fileName, extensionFor(format)))
      editor = withStatus(editor, { kind: 'idle' })
    },

    reset: (): void => {
      decoded = null
      editor = null
      lastError = null
      fullMask = new Uint8Array(0)
      backgroundField = null
      backdropImage = null
      subjectPlacement = DEFAULT_PLACEMENT
      backdropPlacement = DEFAULT_PLACEMENT
    },

    get lastError(): KirilyError | null {
      return lastError
    },
  }
}

/**
 * `navigator.deviceMemory` is Chromium-only. Read defensively rather than
 * assuming a shape the type definitions do not promise.
 */
const readDeviceMemory = (): number | undefined => {
  const value = Reflect.get(globalThis.navigator ?? {}, 'deviceMemory')
  return typeof value === 'number' ? value : undefined
}
