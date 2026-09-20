/**
 * A failure that a caller is expected to handle is a value, not a thrown
 * error: a `throw` is invisible in the signature, so callers forget it exists.
 * `throw` stays for programmer errors — a broken invariant, an impossible
 * branch — which should abort rather than be recovered from.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly error: E
    }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

/** Applies `f` to the success value, leaving a failure untouched. */
export const mapResult = <T, U, E>(result: Result<T, E>, f: (value: T) => U): Result<U, E> =>
  result.ok ? ok(f(result.value)) : result

/** Chains another fallible step. */
export const andThen = <T, U, E>(
  result: Result<T, E>,
  f: (value: T) => Result<U, E>,
): Result<U, E> => (result.ok ? f(result.value) : result)

/**
 * Collects a list of results into a result of a list, stopping at the first
 * failure. Useful where a batch must not half-succeed.
 */
export const allOk = <T, E>(results: readonly Result<T, E>[]): Result<T[], E> => {
  const values: T[] = []
  for (const result of results) {
    if (!result.ok) return result
    values.push(result.value)
  }
  return ok(values)
}

/**
 * Marks a branch the type system has proved unreachable. Adding a member to a
 * union turns every `switch` that forgot it into a compile error.
 */
export const assertNever = (value: never): never => {
  throw new Error(`Unreachable case: ${JSON.stringify(value)}`)
}
