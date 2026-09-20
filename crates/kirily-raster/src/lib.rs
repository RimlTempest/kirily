//! Pixel-level operations on RGBA buffers.
//!
//! These run on the *export* path, at the original image resolution, so they
//! are written to work in place or into a caller-provided buffer wherever that
//! is possible. A 4K RGBA frame is ~32 MB; a function that returns a fresh
//! `Vec` for every step is how a browser tab runs out of memory
//! (IMPLEMENTATION.md §24).

use kirily_image::{BufferError, ImageSize, Rect};

/// An opaque colour used where alpha cannot be kept — JPEG export
/// (kirily-design.md §17).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

/// Writes the mask into the alpha channel of `rgba`, in place.
///
/// The colour channels are left alone: this is the non-destructive step that
/// makes an edit undoable by simply applying a different mask.
pub fn apply_alpha_mask(rgba: &mut [u8], mask: &[u8], size: ImageSize) -> Result<(), BufferError> {
    size.validate_rgba(rgba)?;
    size.validate_mask(mask)?;

    for (pixel, alpha) in rgba.as_chunks_mut::<4>().0.iter_mut().zip(mask.iter()) {
        pixel[3] = *alpha;
    }
    Ok(())
}

/// Copies `rect` out of `rgba` into `out`.
///
/// `out` must already be the size of the crop, so the caller can reuse one
/// export buffer across repeated exports instead of allocating each time.
pub fn crop_rgba(
    rgba: &[u8],
    size: ImageSize,
    rect: Rect,
    out: &mut [u8],
) -> Result<(), BufferError> {
    size.validate_rgba(rgba)?;
    rect.validate_within(size)?;
    let out_size = ImageSize::new(rect.width, rect.height)?;
    out_size.validate_rgba(out)?;

    let row_bytes = rect.width as usize * 4;
    let src_stride = size.width() as usize * 4;

    for row in 0..rect.height as usize {
        let src_start = (rect.y as usize + row) * src_stride + rect.x as usize * 4;
        let dst_start = row * row_bytes;
        out[dst_start..dst_start + row_bytes]
            .copy_from_slice(&rgba[src_start..src_start + row_bytes]);
    }
    Ok(())
}

/// Composites the image over an opaque background and clears the alpha channel.
///
/// Used for JPEG, which has no alpha. Doing it here rather than letting the
/// encoder guess is what makes "transparent becomes white" a visible, chosen
/// behaviour instead of a surprise.
pub fn flatten_onto(rgba: &mut [u8], size: ImageSize, background: Rgb) -> Result<(), BufferError> {
    size.validate_rgba(rgba)?;

    for pixel in rgba.as_chunks_mut::<4>().0 {
        let alpha = pixel[3] as u32;
        if alpha == 255 {
            continue;
        }
        let inverse = 255 - alpha;
        pixel[0] = blend(pixel[0], background.r, alpha, inverse);
        pixel[1] = blend(pixel[1], background.g, alpha, inverse);
        pixel[2] = blend(pixel[2], background.b, alpha, inverse);
        pixel[3] = 255;
    }
    Ok(())
}

/// Removes the background's colour cast from semi-transparent edge pixels.
///
/// Anti-aliased edges carry a mix of subject and background colour. Dropping
/// the background without correcting them leaves the familiar halo around hair
/// and thin objects (kirily-design.md §7.3, "Decontamination").
pub fn decontaminate_edges(
    rgba: &mut [u8],
    size: ImageSize,
    background: Rgb,
) -> Result<(), BufferError> {
    size.validate_rgba(rgba)?;

    for pixel in rgba.as_chunks_mut::<4>().0 {
        let alpha = pixel[3];
        // Fully opaque pixels hold no background; fully transparent ones are
        // never seen. Only the edge band needs correcting.
        if alpha == 0 || alpha == 255 {
            continue;
        }
        let a = alpha as f32 / 255.0;
        pixel[0] = unmix(pixel[0], background.r, a);
        pixel[1] = unmix(pixel[1], background.g, a);
        pixel[2] = unmix(pixel[2], background.b, a);
    }
    Ok(())
}

fn blend(foreground: u8, background: u8, alpha: u32, inverse: u32) -> u8 {
    let value = foreground as u32 * alpha + background as u32 * inverse;
    // +127 then /255 rounds to nearest without a division by 256 bias.
    ((value + 127) / 255) as u8
}

fn unmix(observed: u8, background: u8, alpha: f32) -> u8 {
    let recovered = (observed as f32 - background as f32 * (1.0 - alpha)) / alpha;
    recovered.clamp(0.0, 255.0).round() as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    fn size(w: u32, h: u32) -> ImageSize {
        ImageSize::new(w, h).unwrap()
    }

    #[test]
    fn apply_alpha_mask_writes_alpha_and_keeps_colour() {
        let mut rgba = vec![10, 20, 30, 255, 40, 50, 60, 255];
        apply_alpha_mask(&mut rgba, &[0, 128], size(2, 1)).unwrap();
        assert_eq!(rgba, vec![10, 20, 30, 0, 40, 50, 60, 128]);
    }

    #[test]
    fn apply_alpha_mask_rejects_a_mask_from_a_different_image() {
        let mut rgba = vec![0u8; 8];
        assert!(apply_alpha_mask(&mut rgba, &[0, 0, 0], size(2, 1)).is_err());
    }

    #[test]
    fn crop_copies_the_requested_rectangle() {
        // 3x2, each pixel's red channel is its index.
        let mut rgba = Vec::new();
        for i in 0..6u8 {
            rgba.extend_from_slice(&[i, 0, 0, 255]);
        }
        let mut out = vec![0u8; 2 * 2 * 4];
        let rect = Rect {
            x: 1,
            y: 0,
            width: 2,
            height: 2,
        };

        crop_rgba(&rgba, size(3, 2), rect, &mut out).unwrap();

        assert_eq!(out[0], 1);
        assert_eq!(out[4], 2);
        assert_eq!(out[8], 4);
        assert_eq!(out[12], 5);
    }

    #[test]
    fn crop_rejects_a_rectangle_that_leaves_the_image() {
        let rgba = vec![0u8; 3 * 2 * 4];
        let mut out = vec![0u8; 2 * 2 * 4];
        let rect = Rect {
            x: 2,
            y: 0,
            width: 2,
            height: 2,
        };
        assert_eq!(
            crop_rgba(&rgba, size(3, 2), rect, &mut out),
            Err(BufferError::OutOfBounds)
        );
    }

    #[test]
    fn crop_rejects_an_output_buffer_of_the_wrong_size() {
        let rgba = vec![0u8; 3 * 2 * 4];
        let mut out = vec![0u8; 4];
        let rect = Rect {
            x: 0,
            y: 0,
            width: 2,
            height: 2,
        };
        assert!(crop_rgba(&rgba, size(3, 2), rect, &mut out).is_err());
    }

    #[test]
    fn flatten_composites_transparent_pixels_onto_the_background() {
        let white = Rgb {
            r: 255,
            g: 255,
            b: 255,
        };
        let mut rgba = vec![0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 128];

        flatten_onto(&mut rgba, size(3, 1), white).unwrap();

        assert_eq!(
            &rgba[0..4],
            &[255, 255, 255, 255],
            "transparent becomes the background"
        );
        assert_eq!(&rgba[4..8], &[0, 0, 0, 255], "opaque is untouched");
        // alpha=128 は 128/255 = 0.502 の被覆率。背景の重みは 127/255 なので 127。
        assert_eq!(
            rgba[8], 127,
            "half-transparent black over white is mid grey"
        );
        assert_eq!(rgba[11], 255, "alpha is cleared everywhere");
    }

    #[test]
    fn decontamination_recovers_the_subject_colour_at_a_soft_edge() {
        // A pure red subject at 50% coverage over a white background reads as
        // (255, 128, 128) on screen. The stored colour should go back to red.
        let mut rgba = vec![255, 128, 128, 128];
        decontaminate_edges(
            &mut rgba,
            size(1, 1),
            Rgb {
                r: 255,
                g: 255,
                b: 255,
            },
        )
        .unwrap();

        assert_eq!(rgba[0], 255);
        assert!(rgba[1] <= 4, "green cast removed, got {}", rgba[1]);
        assert!(rgba[2] <= 4, "blue cast removed, got {}", rgba[2]);
        assert_eq!(rgba[3], 128, "alpha is not changed");
    }

    #[test]
    fn decontamination_leaves_fully_opaque_and_fully_transparent_pixels_alone() {
        let original = vec![10, 20, 30, 255, 10, 20, 30, 0];
        let mut rgba = original.clone();
        decontaminate_edges(
            &mut rgba,
            size(2, 1),
            Rgb {
                r: 255,
                g: 255,
                b: 255,
            },
        )
        .unwrap();
        assert_eq!(rgba, original);
    }
}
