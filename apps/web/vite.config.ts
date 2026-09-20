import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  worker: {
    // Workers are ES modules so they can import the same packages the app does.
    format: 'es',
  },
})
