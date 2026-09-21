import { describe, expect, test } from 'bun:test'
import { checkWorkflow, splitJobs } from './check-workflow-tools.ts'

const workflow = (...jobs: string[]): string =>
  `name: w\n\non:\n  push:\n\njobs:\n${jobs.join('\n')}`

const job = (name: string, ...steps: string[]): string =>
  `  ${name}:\n    runs-on: ubuntu-latest\n    steps:\n${steps.map((step) => `      - run: ${step}`).join('\n')}\n`

describe('splitJobs', () => {
  test('finds each job and where it starts', () => {
    const jobs = splitJobs(workflow(job('build', 'echo one'), job('deploy', 'echo two')))
    expect(jobs.map((found) => found.name)).toEqual(['build', 'deploy'])
    expect(jobs[0]?.line).toBe(7)
  })

  test('stops at the end of the jobs mapping', () => {
    const source = `${workflow(job('build', 'echo one'))}\npermissions:\n  contents: read\n`
    expect(splitJobs(source).map((found) => found.name)).toEqual(['build'])
  })

  test('says nothing about a file with no jobs at all', () => {
    expect(splitJobs('name: w\non:\n  push:\n')).toEqual([])
  })
})

describe('checkWorkflow', () => {
  test('passes a job that installs before it builds', () => {
    const source = workflow(job('b', 'cargo install wasm-pack --locked', 'bun run wasm:build'))
    expect(checkWorkflow('w.yml', source)).toEqual([])
  })

  test('catches the build with no install — the deploy job that exited 127', () => {
    const source = workflow(job('b', 'bun install --frozen-lockfile', 'bun run wasm:build'))
    const problems = checkWorkflow('w.yml', source)
    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toContain('exit 127')
  })

  test('catches an install that comes too late to help', () => {
    const source = workflow(job('b', 'bun run wasm:build', 'cargo install wasm-pack --locked'))
    expect(checkWorkflow('w.yml', source)[0]?.message).toContain('too late')
  })

  /** The reason this is scoped to the job: a sibling job is a different runner. */
  test('does not let one job borrow another job’s install', () => {
    const source = workflow(
      job('a', 'cargo install wasm-pack --locked'),
      job('b', 'bun run wasm:build'),
    )
    const problems = checkWorkflow('w.yml', source)
    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toContain('"b"')
  })

  test('leaves a job that never builds the wasm alone', () => {
    expect(checkWorkflow('w.yml', workflow(job('b', 'bun run test')))).toEqual([])
  })
})
