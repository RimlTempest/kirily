import { describe, expect, test } from 'bun:test'
import { Stage, createStopwatch, formatTimings, replayTimings } from './timing.ts'

/** A clock the test moves by hand, so a duration is an assertion not a guess. */
const clock = (): { now: () => number; advance: (ms: number) => void } => {
  let at = 0
  return { now: () => at, advance: (ms) => (at += ms) }
}

describe('createStopwatch', () => {
  test('records how long a step took', () => {
    const time = clock()
    const watch = createStopwatch(time.now)
    watch.measure(Stage.Decode, () => time.advance(40))
    expect(watch.timings()).toEqual({ decode: 40 })
  })

  test('returns what the step returned', () => {
    const watch = createStopwatch(clock().now)
    expect(watch.measure(Stage.Decode, () => 7)).toBe(7)
  })

  test('times an async step', async () => {
    const time = clock()
    const watch = createStopwatch(time.now)
    const value = await watch.measureAsync(Stage.AiInference, async () => {
      time.advance(900)
      return 'mask'
    })
    expect(value).toBe('mask')
    expect(watch.timings()).toEqual({ ai_inference: 900 })
  })

  /** A render's cost is the second of them, not the first frame. */
  test('adds up a stage that runs more than once', () => {
    const time = clock()
    const watch = createStopwatch(time.now)
    watch.measure(Stage.PreviewRender, () => time.advance(8))
    watch.measure(Stage.PreviewRender, () => time.advance(12))
    expect(watch.timings()).toEqual({ preview_render: 20 })
  })

  test('accepts a duration measured somewhere else', () => {
    const watch = createStopwatch(clock().now)
    watch.record(Stage.AiLoad, 4200)
    expect(watch.timings()).toEqual({ ai_load: 4200 })
  })

  test('hands back a copy, so a later step cannot change a reading', () => {
    const time = clock()
    const watch = createStopwatch(time.now)
    watch.measure(Stage.Decode, () => time.advance(40))
    const taken = watch.timings()
    watch.measure(Stage.Decode, () => time.advance(10))
    expect(taken).toEqual({ decode: 40 })
  })

  test('forgets everything on clear', () => {
    const time = clock()
    const watch = createStopwatch(time.now)
    watch.measure(Stage.Decode, () => time.advance(40))
    watch.clear()
    expect(watch.timings()).toEqual({})
  })
})

describe('formatTimings', () => {
  test('puts the slowest stage first', () => {
    expect(formatTimings({ decode: 40, ai_inference: 900, export: 120 })).toBe(
      'ai_inference 900ms · export 120ms · decode 40ms',
    )
  })

  test('is empty when nothing was measured', () => {
    expect(formatTimings({})).toBe('')
  })
})

describe('replayTimings', () => {
  test('hands every reading to the recorder', () => {
    const seen: [string, number][] = []
    replayTimings({ decode: 40, export: 120 }, (stage, ms) => seen.push([stage, ms]))
    expect(seen).toEqual([
      ['decode', 40],
      ['export', 120],
    ])
  })

  test('skips a stage that was never measured', () => {
    const seen: string[] = []
    replayTimings({}, (stage) => seen.push(stage))
    expect(seen).toEqual([])
  })
})
