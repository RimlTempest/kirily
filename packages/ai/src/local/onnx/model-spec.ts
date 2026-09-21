/**
 * What a segmentation model needs in order to be used.
 *
 * Kirily does not commit to a model (kirily-design.md §17). Everything that
 * differs between one model and the next — input size, normalisation, how to
 * read the output — is data here, so adding a model is a new entry rather than
 * a new code path.
 *
 * Input and output *tensor names* are deliberately absent: they differ between
 * exports of the same architecture, so they are read from the session at run
 * time instead of being guessed here.
 */

export type ModelSpec = {
  readonly id: string
  /** Shown in the UI while the weights download. */
  readonly label: string
  /** Square input the model was trained on. */
  readonly inputSize: number
  /** Per-channel mean, applied after scaling pixels to 0..1. */
  readonly mean: readonly [number, number, number]
  readonly std: readonly [number, number, number]
  /**
   * Whether the exported graph already ends in a sigmoid. When it does not,
   * the raw logits have to be squashed before they mean anything as alpha.
   */
  readonly outputActivation: 'sigmoid' | 'none'
  /**
   * U²-Net-family exports produce a saliency map whose useful range is not
   * 0..1; rembg rescales it per image. Doing the same keeps faint subjects
   * from coming out semi-transparent.
   */
  readonly rescaleOutput: boolean
  /**
   * Whether to close low-confidence patches inside the subject after
   * inference. Models return soft values wherever the interior resembles the
   * background — pale skin against a near-white backdrop, say — which reads as
   * a ghostly hole in the cut-out (kirily-design.md §7.3).
   */
  readonly solidifyInterior: boolean
  /** Where the weights came from, and under what licence. */
  readonly provenance: {
    readonly source: string
    readonly license: string
  }
}

/**
 * BiRefNet-lite. The quality target: it resolves hair and thin structures
 * well enough to be compared with the commercial services
 * (kirily-design.md §37). 1024² input and ~110 MiB of fp16 weights make it a
 * WebGPU-first choice.
 */
export const BIREFNET_LITE: ModelSpec = {
  id: 'birefnet-lite',
  label: 'BiRefNet-lite',
  inputSize: 1024,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  // The ONNX export ends in the raw prediction head.
  outputActivation: 'sigmoid',
  rescaleOutput: false,
  solidifyInterior: true,
  provenance: {
    source: 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX',
    license: 'MIT',
  },
}

/**
 * U²-Netp. 4.5 MiB and 320² input: it loads in a moment and runs at a usable
 * speed on the CPU. The edges are visibly coarser, which is the trade the user
 * gets on a device that cannot run the big model at all.
 */
export const U2NETP: ModelSpec = {
  id: 'u2netp',
  label: 'U²-Netp',
  inputSize: 320,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  // rembg's export already applies the sigmoid inside the graph.
  outputActivation: 'none',
  rescaleOutput: true,
  // At 320² the model cannot see interior detail well enough to doubt it, so
  // there is nothing to close — and the step would only risk filling a gap it
  // blurred over.
  solidifyInterior: false,
  provenance: {
    source: 'https://github.com/danielgatis/rembg (weights: xuebinqin/U-2-Net)',
    license: 'Apache-2.0',
  },
}

/**
 * IS-Net (general use) — the architecture RMBG-1.4 is built on, under a
 * licence that permits commercial use. 84 MiB at 1024², from the fp16 export:
 * this tier only runs on WebGPU, where half precision is native, and the
 * evaluation set scores the same to three decimals either way (ADR-0014).
 *
 * It exists in the chain because BiRefNet does not run everywhere: BiRefNet's
 * decoder contains a Split that needs 11 storage buffers in one shader stage,
 * and Apple GPUs cap that at 10 (ADR-0007). IS-Net stays within the cap and is
 * the quality tier on those machines.
 *
 * Normalisation matches rembg's `dis_general_use` session: centred on 0.5 with
 * unit variance, not the ImageNet statistics the other two use.
 */
export const ISNET_GENERAL: ModelSpec = {
  id: 'isnet-general-use',
  label: 'IS-Net general use',
  inputSize: 1024,
  mean: [0.5, 0.5, 0.5],
  std: [1, 1, 1],
  outputActivation: 'none',
  rescaleOutput: true,
  solidifyInterior: true,
  provenance: {
    source: 'https://huggingface.co/imgly/isnet-general-onnx (weights: xuebinqin/DIS)',
    license: 'MIT',
  },
}

export const MODEL_SPECS: readonly ModelSpec[] = [BIREFNET_LITE, ISNET_GENERAL, U2NETP]
