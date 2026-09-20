/**
 * Branded primitives. A bare `string` for an image id is interchangeable with
 * every other string in the program, so the compiler cannot catch a swapped
 * argument. Branding costs nothing at runtime — the brand is a type-only
 * symbol.
 *
 * `as` is banned, so the only way to produce a branded value is through a
 * parse function built from a type guard that actually inspects the value.
 */
import type { Result } from './result.ts'
import { err, ok } from './result.ts'

declare const brand: unique symbol

export type Brand<T, B extends string> = T & { readonly [brand]: B }

/**
 * Builds a parse function from a guard and a failure constructor. This is the
 * single construction point for a branded type.
 *
 * @example
 * const parseImageId = makeParser(
 *   (v: string): v is ImageId => /^img_[0-9a-z]{16}$/.test(v),
 *   (v) => kirilyError(KirilyErrorCode.InvalidFile, `not an image id: ${v.length} chars`),
 * );
 */
export const makeParser =
  <Input, Output extends Input, Failure>(
    guard: (value: Input) => value is Output,
    onInvalid: (value: Input) => Failure,
  ) =>
  (value: Input): Result<Output, Failure> =>
    guard(value) ? ok(value) : err(onInvalid(value))
