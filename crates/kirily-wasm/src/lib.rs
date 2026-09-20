//! The JavaScript boundary.
//!
//! Only this crate knows that the caller is a browser. Everything it exposes
//! takes and returns plain buffers, so the same pixel code is covered by
//! ordinary `cargo test` in the crates below (kirily-design.md §12).
//!
//! Buffers are passed as `&mut [u8]` wherever the operation is in-place.
//! wasm-bindgen copies them across the boundary either way, but an in-place
//! signature keeps a second full-resolution allocation out of the WASM heap.

use kirily_image::{BufferError, ImageSize, Rect};
use kirily_mask::{BrushMode, BrushStamp};
use kirily_raster::Rgb;
use wasm_bindgen::prelude::*;

/// Installs a panic hook so a Rust panic shows up as a readable JS error
/// instead of `unreachable executed`. Call once, at worker start-up.
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

fn size_of(width: u32, height: u32) -> Result<ImageSize, JsError> {
    ImageSize::new(width, height).map_err(to_js_error)
}

fn to_js_error(error: BufferError) -> JsError {
    match error {
        BufferError::InvalidSize { width, height } => {
            JsError::new(&format!("KIRILY_INVALID_SIZE: {width}x{height}"))
        }
        BufferError::LengthMismatch { expected, actual } => JsError::new(&format!(
            "KIRILY_LENGTH_MISMATCH: expected {expected} bytes, got {actual}"
        )),
        BufferError::OutOfBounds => JsError::new("KIRILY_OUT_OF_BOUNDS"),
    }
}

/// Writes `mask` into the alpha channel of `rgba`, in place.
#[wasm_bindgen]
pub fn apply_alpha_mask(
    rgba: &mut [u8],
    mask: &[u8],
    width: u32,
    height: u32,
) -> Result<(), JsError> {
    let size = size_of(width, height)?;
    kirily_raster::apply_alpha_mask(rgba, mask, size).map_err(to_js_error)
}

/// Paints one brush dab into `mask`, in image coordinates.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn stamp_brush(
    mask: &mut [u8],
    width: u32,
    height: u32,
    x: f32,
    y: f32,
    radius: f32,
    hardness: f32,
    opacity: f32,
    remove: bool,
) -> Result<(), JsError> {
    let size = size_of(width, height)?;
    let brush = BrushStamp {
        x,
        y,
        radius,
        hardness,
        opacity,
        mode: if remove {
            BrushMode::Remove
        } else {
            BrushMode::Keep
        },
    };
    kirily_mask::stamp(mask, size, brush).map_err(to_js_error)
}

/// Softens the mask edge in place.
#[wasm_bindgen]
pub fn feather_mask(mask: &mut [u8], width: u32, height: u32, radius: u32) -> Result<(), JsError> {
    let size = size_of(width, height)?;
    kirily_mask::feather(mask, size, radius).map_err(to_js_error)
}

/// Combines the AI mask with the user's keep/remove overrides into `out`.
#[wasm_bindgen]
pub fn compose_mask(
    base: &[u8],
    keep: &[u8],
    remove: &[u8],
    out: &mut [u8],
    width: u32,
    height: u32,
) -> Result<(), JsError> {
    let size = size_of(width, height)?;
    kirily_mask::compose(base, keep, remove, out, size).map_err(to_js_error)
}

/// Copies a rectangle out of `rgba` into `out`, which must already be the size
/// of the crop.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn crop_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    x: u32,
    y: u32,
    crop_width: u32,
    crop_height: u32,
    out: &mut [u8],
) -> Result<(), JsError> {
    let size = size_of(width, height)?;
    let rect = Rect {
        x,
        y,
        width: crop_width,
        height: crop_height,
    };
    kirily_raster::crop_rgba(rgba, size, rect, out).map_err(to_js_error)
}

/// Composites onto an opaque background and clears alpha — the JPEG path.
#[wasm_bindgen]
pub fn flatten_onto(
    rgba: &mut [u8],
    width: u32,
    height: u32,
    r: u8,
    g: u8,
    b: u8,
) -> Result<(), JsError> {
    let size = size_of(width, height)?;
    kirily_raster::flatten_onto(rgba, size, Rgb { r, g, b }).map_err(to_js_error)
}

/// Removes the old background's colour cast from semi-transparent edges.
#[wasm_bindgen]
pub fn decontaminate_edges(
    rgba: &mut [u8],
    width: u32,
    height: u32,
    r: u8,
    g: u8,
    b: u8,
) -> Result<(), JsError> {
    let size = size_of(width, height)?;
    kirily_raster::decontaminate_edges(rgba, size, Rgb { r, g, b }).map_err(to_js_error)
}
