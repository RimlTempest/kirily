/**
 * The MVP never renders on the server: the image is decoded, edited and
 * encoded in the browser and is not uploaded anywhere
 * (kirily-design.md §20). Prerendering the shell keeps the first paint on
 * Cloudflare's edge without a Worker invocation.
 */
export const prerender = true
export const ssr = false
