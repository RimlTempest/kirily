import { describe, expect, test } from 'bun:test'
import type { Ask, Pin } from './check-action-pins.ts'
import { checkPin, parsePins } from './check-action-pins.ts'

const parse = (source: string) => parsePins('w.yml', source)

describe('parsePins', () => {
  test('takes a pin that names its release', () => {
    const { pins, problems } = parse('      - uses: actions/checkout@' + 'a'.repeat(40) + ' # v5')
    expect(problems).toEqual([])
    expect(pins[0]).toEqual({
      file: 'w.yml',
      line: 1,
      owner: 'actions',
      repo: 'checkout',
      sha: 'a'.repeat(40),
      tag: 'v5',
    })
  })

  test('refuses a tag, because tags move', () => {
    const { pins, problems } = parse('      - uses: actions/checkout@v5')
    expect(pins).toEqual([])
    expect(problems[0]?.message).toContain('Tags move')
  })

  test('refuses a branch', () => {
    expect(parse('      - uses: some/action@main').problems).toHaveLength(1)
  })

  test('refuses a SHA with nothing saying which release it is', () => {
    const { pins, problems } = parse('      - uses: actions/checkout@' + 'a'.repeat(40))
    expect(pins).toEqual([])
    expect(problems[0]?.message).toContain('no trailing')
  })

  test('refuses a short SHA, which is not a pin', () => {
    expect(parse('      - uses: actions/checkout@abc1234 # v5').problems).toHaveLength(1)
  })

  /** A local action is this repository's own code; there is nothing to pin. */
  test('leaves a local action alone', () => {
    expect(parse('      - uses: ./.github/actions/setup')).toEqual({ pins: [], problems: [] })
  })

  test('leaves a container action alone', () => {
    expect(parse('      - uses: docker://alpine:3.20')).toEqual({ pins: [], problems: [] })
  })

  test('reads the line number, so the error lands on the right line', () => {
    const source = ['steps:', '  - run: true', '  - uses: a/b@' + 'c'.repeat(40) + ' # v1'].join(
      '\n',
    )
    expect(parse(source).pins[0]?.line).toBe(3)
  })

  test('finds every pin in a file, not just the first', () => {
    const source = [
      '      - uses: a/b@' + 'c'.repeat(40) + ' # v1',
      '      - uses: d/e@' + 'f'.repeat(40) + ' # v2',
    ].join('\n')
    expect(parse(source).pins).toHaveLength(2)
  })
})

const pin: Pin = {
  file: 'w.yml',
  line: 1,
  owner: 'o',
  repo: 'r',
  sha: 'a'.repeat(40),
  tag: 'v4',
}

/** A GitHub that answers whatever the test says. */
const answering = (routes: Record<string, { status: number; body?: unknown }>): Ask => {
  return async (path) => {
    const found = Object.entries(routes).find(([key]) => path.includes(key))
    return found === undefined
      ? { status: 500, body: null }
      : { status: found[1].status, body: found[1].body ?? null }
  }
}

describe('checkPin', () => {
  test('accepts a pin that is exactly the tag', async () => {
    const ask = answering({
      commits: { status: 200 },
      compare: { status: 200, body: { status: 'identical' } },
    })
    expect(await checkPin(pin, ask)).toBeNull()
  })

  /** The normal state of a deliberate pin: the tag has moved on without it. */
  test('accepts a pin the tag has since moved past', async () => {
    const ask = answering({
      commits: { status: 200 },
      compare: { status: 200, body: { status: 'behind' } },
    })
    expect(await checkPin(pin, ask)).toBeNull()
  })

  test('refuses a SHA the repository has never had', async () => {
    const ask = answering({ commits: { status: 422 } })
    expect((await checkPin(pin, ask))?.message).toContain('does not exist')
  })

  test('refuses one from a repository that is not there', async () => {
    const ask = answering({ commits: { status: 404 } })
    expect((await checkPin(pin, ask))?.message).toContain('does not exist')
  })

  test('refuses a real SHA whose comment names a different release', async () => {
    const ask = answering({
      commits: { status: 200 },
      compare: { status: 200, body: { status: 'diverged' } },
    })
    expect((await checkPin(pin, ask))?.message).toContain('does not describe the pin')
  })

  test('refuses a pin newer than the release it claims to be', async () => {
    const ask = answering({
      commits: { status: 200 },
      compare: { status: 200, body: { status: 'ahead' } },
    })
    expect((await checkPin(pin, ask))?.message).toContain('does not describe the pin')
  })

  test('refuses a comment naming a tag that does not exist', async () => {
    const ask = answering({ commits: { status: 200 }, compare: { status: 404 } })
    expect((await checkPin(pin, ask))?.message).toContain('has no ref')
  })

  /** Rate limiting and outages must fail the check, not quietly pass it. */
  test('refuses to guess when GitHub will not answer', async () => {
    const ask = answering({ commits: { status: 403 } })
    expect((await checkPin(pin, ask))?.message).toContain('403')
  })
})
