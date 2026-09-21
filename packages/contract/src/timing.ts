/**
 * Where the time went.
 *
 * "The AI is slow" and "the encoder is slow" call for opposite work, and
 * without numbers they look the same from the outside — a spinner
 * (IMPLEMENTATION.md §59). Every optimisation in Kirily has to name the stage
 * it is shortening and show it afterwards.
 *
 * Only durations, stage names and sizes are ever recorded. Never a file name,
 * never a pixel: this is the same rule the error codes follow, and it is what
 * makes it safe to show these numbers or send them anywhere.
 */
export const Stage = {
  /** File bytes to RGBA at the original resolution. */
  Decode: 'decode',
  /** Building the downscaled copy the screen reads. */
  Preview: 'preview',
  /** Fetching, verifying and compiling the model. Zero once it is cached. */
  AiLoad: 'ai_load',
  /** The forward pass itself. */
  AiInference: 'ai_inference',
  /** Guided filter, pulling the mask's edge onto the image's. */
  MaskRefine: 'mask_refine',
  /** Colour matting, deciding the edge from the pixels. */
  MaskMatte: 'mask_matte',
  /** One composite of what is on screen. */
  PreviewRender: 'preview_render',
  /** Crop, mask, decontaminate and encode. */
  Export: 'export',
} as const

export type Stage = (typeof Stage)[keyof typeof Stage]

export type Timings = Readonly<Partial<Record<Stage, number>>>

/** What a module that does not own the stopwatch is handed. */
export type Recorder = (stage: Stage, ms: number) => void

export type Stopwatch = {
  /** Times a synchronous step and returns what it returned. */
  readonly measure: <T>(stage: Stage, run: () => T) => T
  readonly measureAsync: <T>(stage: Stage, run: () => Promise<T>) => Promise<T>
  /** For a step timed somewhere else — inside the worker, say. */
  readonly record: (stage: Stage, ms: number) => void
  readonly timings: () => Timings
  readonly clear: () => void
}

/**
 * `now` is a parameter rather than `performance.now`: this package may not
 * touch the DOM, the worker and the main thread have different clocks, and a
 * test that cannot control time cannot assert anything about it.
 *
 * A stage that runs more than once accumulates. Rendering is the case that
 * matters — one frame's cost says nothing, a second of them says plenty.
 */
export const createStopwatch = (now: () => number): Stopwatch => {
  let collected: Partial<Record<Stage, number>> = {}

  const record = (stage: Stage, ms: number): void => {
    collected[stage] = (collected[stage] ?? 0) + ms
  }

  return {
    record,
    measure: <T>(stage: Stage, run: () => T): T => {
      const started = now()
      const value = run()
      record(stage, now() - started)
      return value
    },
    measureAsync: async <T>(stage: Stage, run: () => Promise<T>): Promise<T> => {
      const started = now()
      const value = await run()
      record(stage, now() - started)
      return value
    },
    timings: (): Timings => ({ ...collected }),
    clear: (): void => {
      collected = {}
    },
  }
}

/**
 * Hands every reading to `record`.
 *
 * Iterating `Object.entries` would widen the key to `string`, and narrowing it
 * back would take an assertion; the stage list is right here, so walking it is
 * both shorter and typed.
 */
export const replayTimings = (timings: Timings, record: Recorder): void => {
  for (const stage of Object.values(Stage)) {
    const ms = timings[stage]
    if (ms !== undefined) record(stage, ms)
  }
}

/** One line per stage, longest first. Safe to log. */
export const formatTimings = (timings: Timings): string =>
  Object.entries(timings)
    .toSorted(([, a], [, b]) => b - a)
    .map(([stage, ms]) => `${stage} ${Math.round(ms)}ms`)
    .join(' · ')
