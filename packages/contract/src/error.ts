/**
 * Every failure Kirily shows a user has a code here. The code is what logs and
 * analytics record; the Japanese sentence is what the UI shows. Keeping them
 * apart is what lets the message be rewritten without breaking a dashboard —
 * and keeps a user's file name out of the logs (IMPLEMENTATION.md §46, §57).
 */
export const KirilyErrorCode = {
  InvalidFile: 'INVALID_FILE',
  UnsupportedFormat: 'UNSUPPORTED_FORMAT',
  ImageDecodeFailed: 'IMAGE_DECODE_FAILED',
  ImageTooLarge: 'IMAGE_TOO_LARGE',
  OutOfMemory: 'OUT_OF_MEMORY',
  AiInitializationFailed: 'AI_INITIALIZATION_FAILED',
  AiInferenceFailed: 'AI_INFERENCE_FAILED',
  WasmFailed: 'WASM_FAILED',
  ExportFailed: 'EXPORT_FAILED',
  /** A buffer did not match the image size it was used with. */
  SizeMismatch: 'SIZE_MISMATCH',
} as const

export type KirilyErrorCode = (typeof KirilyErrorCode)[keyof typeof KirilyErrorCode]

export type KirilyError = {
  readonly code: KirilyErrorCode
  /** Developer-facing detail. Never contains image data or a file name. */
  readonly detail?: string
}

export const kirilyError = (code: KirilyErrorCode, detail?: string): KirilyError =>
  detail === undefined ? { code } : { code, detail }

const MESSAGES: Record<KirilyErrorCode, string> = {
  INVALID_FILE: 'このファイルは画像として読み込めませんでした。',
  UNSUPPORTED_FORMAT: '対応していない画像形式です。PNG / JPEG / WebP を選んでください。',
  IMAGE_DECODE_FAILED: '画像を展開できませんでした。ファイルが壊れている可能性があります。',
  IMAGE_TOO_LARGE: '画像が大きすぎます。サイズを小さくしてからお試しください。',
  OUT_OF_MEMORY: 'メモリが足りませんでした。他のタブを閉じてからお試しください。',
  AI_INITIALIZATION_FAILED: 'AI を読み込めませんでした。手動ツールは引き続き使えます。',
  AI_INFERENCE_FAILED: '自動透過に失敗しました。もう一度お試しください。',
  WASM_FAILED: 'このブラウザでは高速処理を使えませんでした。',
  EXPORT_FAILED: '書き出しに失敗しました。形式を変えてお試しください。',
  SIZE_MISMATCH: '画像とマスクのサイズが一致しません。',
}

/** The sentence shown to the user. */
export const userMessage = (error: KirilyError): string => MESSAGES[error.code]
