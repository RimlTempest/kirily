/**
 * Every GitHub Action is pinned to a commit SHA that exists, and to the one
 * the comment beside it names.
 *
 * The `guard` job already refused a tag. It could not refuse a SHA that was
 * simply made up: forty hex characters and a `# v3` next to them look exactly
 * like a correct pin, and that is what got committed once (ADR-0024).
 *
 * **Pinned and pinned to the right thing are different properties.** A
 * fabricated SHA is not a hypothetical — it is what an agent or a careless
 * rebase produces, and it fails at the worst moment: the next time the
 * workflow runs, on whatever it happens to be doing then.
 *
 * Run with: bun run tools/check-action-pins.ts
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type Pin = {
  readonly file: string
  readonly line: number
  readonly owner: string
  readonly repo: string
  readonly sha: string
  /** The version the trailing comment claims this is. */
  readonly tag: string
}

export type Problem = {
  readonly file: string
  readonly line: number
  readonly message: string
}

/** `uses: owner/repo@ref` with an optional trailing `# comment`. */
const USES = /^\s*-?\s*uses:\s*(?<ref>[^\s#]+)\s*(?:#\s*(?<comment>\S+))?/

const SHA = /^[\da-f]{40}$/

/**
 * Reads the pins out of one workflow, and says what is wrong with the rest.
 *
 * Pure, and separate from anything that talks to the network, because the
 * shapes it has to cope with — a local action, a docker action, a missing
 * comment — are all cheaper to pin down in a test than in CI.
 */
export const parsePins = (
  file: string,
  source: string,
): { readonly pins: readonly Pin[]; readonly problems: readonly Problem[] } => {
  const pins: Pin[] = []
  const problems: Problem[] = []

  source.split('\n').forEach((text, index) => {
    const found = USES.exec(text)
    const ref = found?.groups?.['ref']
    if (ref === undefined) return

    const line = index + 1
    // A path or a container image, not something fetched from a git ref.
    if (ref.startsWith('./') || ref.startsWith('docker://')) return

    const at = ref.lastIndexOf('@')
    if (at < 0) {
      problems.push({ file, line, message: `${ref} has no version at all` })
      return
    }

    const name = ref.slice(0, at)
    const version = ref.slice(at + 1)
    const [owner, repo] = name.split('/')
    if (owner === undefined || repo === undefined) {
      problems.push({ file, line, message: `${ref} is not owner/repo` })
      return
    }

    if (!SHA.test(version)) {
      problems.push({
        file,
        line,
        message: `${name} is pinned to '${version}'. Tags move; use a full commit SHA.`,
      })
      return
    }

    const tag = found?.groups?.['comment']
    if (tag === undefined) {
      problems.push({
        file,
        line,
        message: `${name} has no trailing '# <tag>' comment, so nothing says which release this is.`,
      })
      return
    }

    pins.push({ file, line, owner, repo, sha: version, tag })
  })

  return { pins, problems }
}

export type Ask = (path: string) => Promise<{ readonly status: number; readonly body: unknown }>

/**
 * Asks GitHub whether each pin is real.
 *
 * Two questions, because the answers mean different things. Does this commit
 * exist in this repository — a no means the SHA was invented or belongs to
 * somebody else. And is it the release the comment names — `identical` when
 * the tag has not moved, `behind` when it has moved on past a pin that is
 * still an ancestor of it, which is the normal state of a deliberate pin.
 */
export const checkPin = async (pin: Pin, ask: Ask): Promise<Problem | null> => {
  const where = `${pin.owner}/${pin.repo}`

  const commit = await ask(`/repos/${where}/commits/${pin.sha}`)
  // 404 when the repository is not there, 422 when it is and the commit is
  // not — "No commit found for SHA". Both mean the same thing here.
  if (commit.status === 404 || commit.status === 422) {
    return {
      file: pin.file,
      line: pin.line,
      message: `${where}@${pin.sha} does not exist. A pin that looks right and is not is worse than a tag.`,
    }
  }
  if (commit.status !== 200) {
    return { file: pin.file, line: pin.line, message: `${where}: GitHub said ${commit.status}` }
  }

  const compared = await ask(`/repos/${where}/compare/${pin.sha}...${pin.tag}`)
  if (compared.status === 404) {
    return {
      file: pin.file,
      line: pin.line,
      message: `${where} has no ref '${pin.tag}', so the comment names a release that is not there.`,
    }
  }
  if (compared.status !== 200) {
    return { file: pin.file, line: pin.line, message: `${where}: GitHub said ${compared.status}` }
  }

  const status =
    typeof compared.body === 'object' && compared.body !== null
      ? Reflect.get(compared.body, 'status')
      : undefined
  if (status === 'identical' || status === 'behind') return null

  return {
    file: pin.file,
    line: pin.line,
    message: `${where}@${pin.sha} is '${status}' relative to ${pin.tag}, so the comment does not describe the pin.`,
  }
}

/**
 * A token, from wherever one is.
 *
 * Unauthenticated GitHub allows sixty requests an hour, which this exhausts in
 * a few runs — and rate limiting is treated as a failure, correctly, so
 * without a token the check becomes noise a developer learns to ignore. CI has
 * `github.token`; a laptop usually has `gh`.
 */
const findToken = async (): Promise<string | undefined> => {
  const fromEnvironment = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN']
  if (fromEnvironment !== undefined && fromEnvironment !== '') return fromEnvironment

  try {
    const gh = Bun.spawn(['gh', 'auth', 'token'], { stdout: 'pipe', stderr: 'ignore' })
    const printed = (await new Response(gh.stdout).text()).trim()
    return (await gh.exited) === 0 && printed !== '' ? printed : undefined
  } catch {
    return undefined
  }
}

const github = (token: string | undefined): Ask => {
  return async (path) => {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'kirily-check-action-pins',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
    })
    const body: unknown = await response.json().catch(() => null)
    return { status: response.status, body }
  }
}

const main = async (): Promise<void> => {
  const directory = '.github/workflows'
  const files = (await readdir(directory)).filter((name) => name.endsWith('.yml'))

  const pins: Pin[] = []
  const problems: Problem[] = []
  for (const name of files) {
    const parsed = parsePins(join(directory, name), await readFile(join(directory, name), 'utf8'))
    pins.push(...parsed.pins)
    problems.push(...parsed.problems)
  }

  // One question per distinct pin, however many workflows use it.
  const ask = github(await findToken())
  const seen = new Map<string, Promise<Problem | null>>()
  const checked = await Promise.all(
    pins.map((pin) => {
      const key = `${pin.owner}/${pin.repo}@${pin.sha}#${pin.tag}`
      const existing = seen.get(key)
      if (existing !== undefined) {
        return existing.then((problem) =>
          problem === null ? null : { ...problem, file: pin.file, line: pin.line },
        )
      }
      const started = checkPin(pin, ask)
      seen.set(key, started)
      return started
    }),
  )

  for (const problem of [...problems, ...checked.filter((value) => value !== null)]) {
    console.error(`::error file=${problem.file},line=${problem.line}::${problem.message}`)
  }

  const total = problems.length + checked.filter((value) => value !== null).length
  if (total > 0) {
    console.error(`${total} action pin(s) are wrong.`)
    process.exit(1)
  }
  console.log(`${pins.length} action pin(s) check out.`)
}

if (import.meta.main) await main()
