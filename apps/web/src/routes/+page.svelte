<script lang="ts">
  import { goto } from '$app/navigation'
  import Dropzone from '$lib/components/upload/Dropzone.svelte'
  import { pendingFile } from '$lib/editor/pending-file.svelte.ts'

  const start = (file: File): void => {
    // The file is handed over in memory. Putting an image in the URL or in
    // storage would mean keeping a copy of it (IMPLEMENTATION.md §6).
    pendingFile.set(file)
    void goto('/editor')
  }
</script>

<svelte:head>
  <title>Kirily — 画像を、きりり。</title>
  <meta name="description" content="ブラウザだけで背景透過。元画像の解像度のまま書き出せます。" />
</svelte:head>

<main class="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center gap-10 px-4 py-16">
  <header class="text-center">
    <p class="text-sm font-bold tracking-[0.2em] text-ink-muted">KIRILY</p>
    <h1 class="mt-6 text-5xl leading-tight font-black tracking-tight sm:text-6xl">
      画像を、きりり。
    </h1>
    <p class="mx-auto mt-6 max-w-lg text-base leading-relaxed text-ink-muted">
      背景を自動で切り抜いて、気になるところはブラシで直す。 元画像の解像度のまま書き出せます。
    </p>
  </header>

  <Dropzone onfile={start} />

  <p class="text-center text-sm text-ink-muted">
    画像はブラウザの中だけで処理されます。サーバーへは送信されません。
  </p>
</main>
