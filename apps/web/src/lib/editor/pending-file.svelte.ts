/**
 * Hands the chosen file from the landing page to the editor route.
 *
 * Module state rather than a URL parameter or storage: the file is the user's
 * photo, and Kirily does not keep a copy of it anywhere it would outlive the
 * tab (kirily-design.md §22).
 */
let file: File | null = null

export const pendingFile = {
  set: (value: File): void => {
    file = value
  },
  /** Reading clears it: a reload must not silently re-open the old image. */
  take: (): File | null => {
    const taken = file
    file = null
    return taken
  },
}
