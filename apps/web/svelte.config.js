import adapter from '@sveltejs/adapter-cloudflare'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    csp: {
      // Image data never leaves the browser on the default path, and a strict
      // policy is what keeps it that way even if a dependency misbehaves
      // (IMPLEMENTATION.md §63).
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        'img-src': ['self', 'blob:', 'data:'],
        'worker-src': ['self', 'blob:'],
        'connect-src': ['self'],
        'object-src': ['none'],
        'base-uri': ['self'],
      },
    },
  },
}
