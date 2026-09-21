/**
 * The same composite, on the GPU.
 *
 * `renderViewport` walks every pixel of the canvas in JavaScript: it samples
 * the colour, samples the mask, and where the edge is soft it solves the
 * compositing equation. Measured at about 20ns a pixel, which is 85ms a frame
 * on a full-screen retina canvas — twelve frames a second, while the user is
 * brushing (ADR-0015).
 *
 * That loop is a fragment shader with the serial numbers filed off, so this
 * hands it to the hardware built for it. The Canvas 2D path stays: a renderer
 * is a feature that degrades, not a reason to refuse to run
 * (`kirily-image-pipeline` §9).
 *
 * It must draw the *same picture*, not a similar one. `tests/e2e/specs/
 * renderer.spec.ts` renders a scene both ways and compares every channel.
 */
import type { Viewport } from '@kirily/contract/geometry'
import type { ColourField } from '@kirily/image-core/field'

export type Size = { readonly width: number; readonly height: number }

export type ColorSource = {
  readonly rgba: Uint8ClampedArray
  readonly width: number
  readonly height: number
}

export type Scene = {
  readonly color: ColorSource
  readonly mask: Uint8Array
  readonly image: Size
  readonly viewport: Viewport
  readonly background: ColourField | null
  /**
   * Changes when the mask's contents change. Re-uploading 1.5 MB on a frame
   * that only panned would put the cost straight back.
   */
  readonly maskVersion: number
}

export type Renderer = {
  readonly render: (scene: Scene, target: Size) => void
  readonly dispose: () => void
}

/** Past this zoom the user is inspecting pixels, so they are shown as squares. */
const NEAREST_ABOVE = 1.5

const VERTEX = `#version 300 es
// One triangle covering the viewport: no buffers, no attributes, three
// vertices generated from the index.
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`

const FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uColor;
uniform sampler2D uMask;
uniform sampler2D uField;

uniform vec2 uTarget;
uniform vec2 uImage;
uniform vec2 uFieldSize;
uniform float uCell;
uniform float uScale;
uniform vec2 uOffset;
uniform bool uCorrect;

out vec4 fragColor;

void main() {
  // gl_FragCoord is centred and origin bottom-left; the rest of Kirily counts
  // rows from the top, so flip here and nowhere else.
  vec2 screen = vec2(gl_FragCoord.x, uTarget.y - gl_FragCoord.y);
  vec2 at = (screen - uOffset) / uScale;

  if (at.x < 0.0 || at.y < 0.0 || at.x >= uImage.x || at.y >= uImage.y) {
    fragColor = vec4(0.0);
    return;
  }

  // Normalised image coordinates, whatever resolution the colour texture is:
  // the preview and the original are addressed the same way, which is what
  // lets a zoomed-out view read the downscaled copy.
  vec3 colour = texture(uColor, at / uImage).rgb;
  float alpha = texture(uMask, at / uImage).r;

  // An untouched pixel holds no background and an invisible one is never
  // composited: only the band between them carries the old colour.
  if (uCorrect && alpha > 0.0 && alpha < 1.0) {
    vec2 cell = (at - uCell * 0.5) / uCell;
    vec3 back = texture(uField, (cell + 0.5) / uFieldSize).rgb;
    colour = clamp((colour - back * (1.0 - alpha)) / alpha, 0.0, 1.0);
  }

  fragColor = vec4(colour, alpha);
}`

const compile = (gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null => {
  const shader = gl.createShader(type)
  if (shader === null) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

const link = (gl: WebGL2RenderingContext): WebGLProgram | null => {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)
  if (vertex === null || fragment === null) return null

  const program = gl.createProgram()
  if (program === null) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    gl.deleteProgram(program)
    return null
  }
  return program
}

const makeTexture = (gl: WebGL2RenderingContext): WebGLTexture | null => {
  const texture = gl.createTexture()
  if (texture === null) return null
  gl.bindTexture(gl.TEXTURE_2D, texture)
  // Clamping is not a detail: it is what makes the edge of the image sample
  // the edge pixel, which is what the CPU path's clamped reads do.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  return texture
}

/**
 * Returns null when WebGL2 is missing or the program will not build. The
 * caller falls back; it does not fail.
 */
export const createWebglRenderer = (canvas: HTMLCanvasElement): Renderer | null => {
  const gl = canvas.getContext('webgl2', {
    // The canvas is read back by the export tests and composited over a
    // checkerboard, both of which expect straight alpha — the same thing
    // `putImageData` writes.
    premultipliedAlpha: false,
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
  })
  if (gl === null) return null

  const program = link(gl)
  const colorTexture = makeTexture(gl)
  const maskTexture = makeTexture(gl)
  const fieldTexture = makeTexture(gl)
  if (program === null || colorTexture === null || maskTexture === null || fieldTexture === null) {
    return null
  }

  const at = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name)
  const uniforms = {
    color: at('uColor'),
    mask: at('uMask'),
    field: at('uField'),
    target: at('uTarget'),
    image: at('uImage'),
    fieldSize: at('uFieldSize'),
    cell: at('uCell'),
    scale: at('uScale'),
    offset: at('uOffset'),
    correct: at('uCorrect'),
  }

  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

  /** What is already on the GPU, so a pan does not re-upload megabytes. */
  let uploadedColor: Uint8ClampedArray | null = null
  let uploadedMaskVersion = -1
  let uploadedField: ColourField | null = null
  let filtering = -1

  const setFilter = (nearest: boolean): void => {
    const wanted = nearest ? gl.NEAREST : gl.LINEAR
    if (filtering === wanted) return
    filtering = wanted
    gl.bindTexture(gl.TEXTURE_2D, colorTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, wanted)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, wanted)
    gl.bindTexture(gl.TEXTURE_2D, maskTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, wanted)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, wanted)
  }

  return {
    render: (scene, target) => {
      if (target.width === 0 || target.height === 0) return
      if (canvas.width !== target.width) canvas.width = target.width
      if (canvas.height !== target.height) canvas.height = target.height
      gl.viewport(0, 0, target.width, target.height)
      gl.useProgram(program)

      if (uploadedColor !== scene.color.rgba) {
        uploadedColor = scene.color.rgba
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, colorTexture)
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA8,
          scene.color.width,
          scene.color.height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          // A view over the same memory, not a copy.
          new Uint8Array(
            scene.color.rgba.buffer,
            scene.color.rgba.byteOffset,
            scene.color.rgba.length,
          ),
        )
      }

      if (uploadedMaskVersion !== scene.maskVersion) {
        uploadedMaskVersion = scene.maskVersion
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, maskTexture)
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.R8,
          scene.image.width,
          scene.image.height,
          0,
          gl.RED,
          gl.UNSIGNED_BYTE,
          scene.mask,
        )
      }

      const field = scene.background
      if (field !== null && uploadedField !== field) {
        uploadedField = field
        // Three bytes per cell on the CPU side, four on the GPU: RGB8 is not a
        // renderable-or-uploadable format everywhere, and a 40x40 grid makes
        // the extra channel free.
        const padded = new Uint8Array(field.width * field.height * 4)
        for (let i = 0; i < field.width * field.height; i += 1) {
          padded[i * 4] = field.rgb[i * 3] ?? 0
          padded[i * 4 + 1] = field.rgb[i * 3 + 1] ?? 0
          padded[i * 4 + 2] = field.rgb[i * 3 + 2] ?? 0
          padded[i * 4 + 3] = 255
        }
        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_2D, fieldTexture)
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA8,
          field.width,
          field.height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          padded,
        )
      }

      setFilter(scene.viewport.scale >= NEAREST_ABOVE)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, colorTexture)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, maskTexture)
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, fieldTexture)

      gl.uniform1i(uniforms.color, 0)
      gl.uniform1i(uniforms.mask, 1)
      gl.uniform1i(uniforms.field, 2)
      gl.uniform2f(uniforms.target, target.width, target.height)
      gl.uniform2f(uniforms.image, scene.image.width, scene.image.height)
      gl.uniform2f(uniforms.fieldSize, field?.width ?? 1, field?.height ?? 1)
      gl.uniform1f(uniforms.cell, field?.cell ?? 1)
      gl.uniform1f(uniforms.scale, scene.viewport.scale === 0 ? 1 : scene.viewport.scale)
      gl.uniform2f(uniforms.offset, scene.viewport.offsetX, scene.viewport.offsetY)
      gl.uniform1i(uniforms.correct, field === null ? 0 : 1)

      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },

    dispose: () => {
      gl.deleteProgram(program)
      gl.deleteTexture(colorTexture)
      gl.deleteTexture(maskTexture)
      gl.deleteTexture(fieldTexture)
    },
  }
}
