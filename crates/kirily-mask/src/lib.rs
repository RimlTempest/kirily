//! Alpha mask operations.
//!
//! A mask is one byte per pixel at the *original* image resolution: 0 is fully
//! transparent, 255 fully opaque (IMPLEMENTATION.md §13). Every function here
//! mutates a caller-owned buffer in place — allocating a second full-resolution
//! mask per stroke is what makes a 4K image feel slow.

use kirily_image::{BufferError, ImageSize};

/// What a brush stroke does to the mask.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrushMode {
    /// Paint towards opaque — "keep this part of the image".
    Keep,
    /// Paint towards transparent — "remove this part".
    Remove,
}

/// One dab of the brush, in image coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BrushStamp {
    pub x: f32,
    pub y: f32,
    /// Radius in image pixels.
    pub radius: f32,
    /// 0.0 = fully soft edge, 1.0 = hard edge.
    pub hardness: f32,
    /// 0.0 = no effect, 1.0 = full strength at the centre.
    pub opacity: f32,
    pub mode: BrushMode,
}

/// Applies one brush dab to `mask`.
///
/// Only the bounding box of the dab is touched, so a stroke costs the area of
/// the brush rather than the area of the image.
pub fn stamp(mask: &mut [u8], size: ImageSize, brush: BrushStamp) -> Result<(), BufferError> {
    size.validate_mask(mask)?;

    // NaN も 0 以下もここで弾く。以降は radius / opacity が正であることを前提にする。
    if !brush.radius.is_finite() || brush.radius <= 0.0 || brush.opacity <= 0.0 {
        return Ok(());
    }

    let width = size.width() as i64;
    let height = size.height() as i64;
    let radius = brush.radius as f64;
    let min_x = ((brush.x as f64 - radius).floor() as i64).max(0);
    let max_x = ((brush.x as f64 + radius).ceil() as i64).min(width - 1);
    let min_y = ((brush.y as f64 - radius).floor() as i64).max(0);
    let max_y = ((brush.y as f64 + radius).ceil() as i64).min(height - 1);

    let hardness = clamp_unit(brush.hardness as f64);
    let opacity = clamp_unit(brush.opacity as f64);
    // Below `inner` the brush is at full strength; between `inner` and the
    // radius it falls off linearly. hardness = 1 collapses the two.
    let inner = radius * hardness;
    let falloff = radius - inner;

    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let dx = x as f64 + 0.5 - brush.x as f64;
            let dy = y as f64 + 0.5 - brush.y as f64;
            let distance = (dx * dx + dy * dy).sqrt();
            if distance > radius {
                continue;
            }

            let strength = if distance <= inner || falloff <= 0.0 {
                opacity
            } else {
                opacity * (1.0 - (distance - inner) / falloff)
            };
            if strength <= 0.0 {
                continue;
            }

            let index = (y * width + x) as usize;
            let current = mask[index] as f64;
            let target = match brush.mode {
                BrushMode::Keep => 255.0,
                BrushMode::Remove => 0.0,
            };
            mask[index] = round_to_u8(current + (target - current) * strength);
        }
    }

    Ok(())
}

/// Softens the mask edge with a separable box blur repeated three times, which
/// approximates a Gaussian closely enough for a feather slider and stays O(n)
/// in the image size regardless of the radius.
pub fn feather(mask: &mut [u8], size: ImageSize, radius: u32) -> Result<(), BufferError> {
    size.validate_mask(mask)?;

    if radius == 0 {
        return Ok(());
    }

    let mut scratch = vec![0u8; mask.len()];
    for _ in 0..3 {
        box_blur_horizontal(mask, &mut scratch, size, radius);
        box_blur_vertical(&scratch, mask, size, radius);
    }
    Ok(())
}

/// Combines the AI mask with the user's manual overrides.
///
/// Manual edits win, always: the AI may refine what it produced, but it must
/// not undo what the user painted (kirily-design.md §8).
pub fn compose(
    base: &[u8],
    keep: &[u8],
    remove: &[u8],
    out: &mut [u8],
    size: ImageSize,
) -> Result<(), BufferError> {
    size.validate_mask(base)?;
    size.validate_mask(keep)?;
    size.validate_mask(remove)?;
    size.validate_mask(out)?;

    for i in 0..out.len() {
        let kept = base[i].max(keep[i]);
        out[i] = kept.saturating_sub(remove[i]);
    }
    Ok(())
}

fn box_blur_horizontal(src: &[u8], dst: &mut [u8], size: ImageSize, radius: u32) {
    let width = size.width() as usize;
    let height = size.height() as usize;
    let window = radius as usize * 2 + 1;

    for y in 0..height {
        let row = y * width;
        let mut sum: u32 = 0;
        for x in 0..window {
            let sx = x
                .min(radius as usize + width - 1)
                .saturating_sub(radius as usize);
            sum += src[row + sx.min(width - 1)] as u32;
        }
        for x in 0..width {
            dst[row + x] = (sum / window as u32) as u8;
            let leaving = x.saturating_sub(radius as usize);
            let entering = (x + radius as usize + 1).min(width - 1);
            sum = sum - src[row + leaving] as u32 + src[row + entering] as u32;
        }
    }
}

fn box_blur_vertical(src: &[u8], dst: &mut [u8], size: ImageSize, radius: u32) {
    let width = size.width() as usize;
    let height = size.height() as usize;
    let window = radius as usize * 2 + 1;

    for x in 0..width {
        let mut sum: u32 = 0;
        for y in 0..window {
            let sy = y
                .min(radius as usize + height - 1)
                .saturating_sub(radius as usize);
            sum += src[sy.min(height - 1) * width + x] as u32;
        }
        for y in 0..height {
            dst[y * width + x] = (sum / window as u32) as u8;
            let leaving = y.saturating_sub(radius as usize);
            let entering = (y + radius as usize + 1).min(height - 1);
            sum = sum - src[leaving * width + x] as u32 + src[entering * width + x] as u32;
        }
    }
}

fn clamp_unit(value: f64) -> f64 {
    if value.is_nan() {
        0.0
    } else {
        value.clamp(0.0, 1.0)
    }
}

fn round_to_u8(value: f64) -> u8 {
    let rounded = value + 0.5;
    if rounded <= 0.0 {
        0
    } else if rounded >= 255.0 {
        255
    } else {
        rounded as u8
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn size(w: u32, h: u32) -> ImageSize {
        ImageSize::new(w, h).unwrap()
    }

    #[test]
    fn rejects_a_mask_of_the_wrong_length() {
        let mut mask = vec![0u8; 3];
        let brush = BrushStamp {
            x: 1.0,
            y: 1.0,
            radius: 1.0,
            hardness: 1.0,
            opacity: 1.0,
            mode: BrushMode::Keep,
        };
        assert!(stamp(&mut mask, size(2, 2), brush).is_err());
    }

    #[test]
    fn a_hard_keep_brush_fills_its_circle_and_nothing_else() {
        let mut mask = vec![0u8; 25];
        let brush = BrushStamp {
            x: 2.5,
            y: 2.5,
            radius: 1.5,
            hardness: 1.0,
            opacity: 1.0,
            mode: BrushMode::Keep,
        };
        stamp(&mut mask, size(5, 5), brush).unwrap();

        assert_eq!(mask[2 * 5 + 2], 255, "centre is painted");
        assert_eq!(mask[0], 0, "a corner outside the radius is untouched");
    }

    #[test]
    fn a_remove_brush_erases_what_a_keep_brush_painted() {
        let mut mask = vec![255u8; 25];
        let brush = BrushStamp {
            x: 2.5,
            y: 2.5,
            radius: 1.5,
            hardness: 1.0,
            opacity: 1.0,
            mode: BrushMode::Remove,
        };
        stamp(&mut mask, size(5, 5), brush).unwrap();
        assert_eq!(mask[2 * 5 + 2], 0);
    }

    #[test]
    fn a_soft_brush_fades_towards_the_edge() {
        let mut mask = vec![0u8; 81];
        let brush = BrushStamp {
            x: 4.5,
            y: 4.5,
            radius: 4.0,
            hardness: 0.0,
            opacity: 1.0,
            mode: BrushMode::Keep,
        };
        stamp(&mut mask, size(9, 9), brush).unwrap();

        let centre = mask[4 * 9 + 4];
        let edge = mask[4 * 9 + 7];
        assert_eq!(centre, 255);
        assert!(edge > 0 && edge < centre, "expected a falloff, got {edge}");
    }

    #[test]
    fn a_zero_radius_brush_does_nothing() {
        let mut mask = vec![7u8; 9];
        let brush = BrushStamp {
            x: 1.0,
            y: 1.0,
            radius: 0.0,
            hardness: 1.0,
            opacity: 1.0,
            mode: BrushMode::Keep,
        };
        stamp(&mut mask, size(3, 3), brush).unwrap();
        assert_eq!(mask, vec![7u8; 9]);
    }

    #[test]
    fn feather_softens_a_hard_edge_without_moving_it() {
        let mut mask = vec![0u8; 8 * 8];
        for y in 0..8 {
            for x in 4..8 {
                mask[y * 8 + x] = 255;
            }
        }
        feather(&mut mask, size(8, 8), 1).unwrap();

        assert!(mask[0] < 32, "far side stays transparent");
        assert!(mask[7] > 223, "far side stays opaque");
        let at_edge = mask[3];
        assert!(
            at_edge > 0 && at_edge < 255,
            "edge became a gradient, got {at_edge}"
        );
    }

    #[test]
    fn feather_with_radius_zero_is_a_no_op() {
        let original = vec![0, 255, 0, 255];
        let mut mask = original.clone();
        feather(&mut mask, size(2, 2), 0).unwrap();
        assert_eq!(mask, original);
    }

    #[test]
    fn manual_edits_win_over_the_ai_mask() {
        let base = vec![0, 255, 255, 0];
        let keep = vec![255, 0, 0, 0];
        let remove = vec![0, 255, 0, 0];
        let mut out = vec![0u8; 4];

        compose(&base, &keep, &remove, &mut out, size(2, 2)).unwrap();

        assert_eq!(
            out[0], 255,
            "keep override turns an AI-transparent pixel opaque"
        );
        assert_eq!(
            out[1], 0,
            "remove override turns an AI-opaque pixel transparent"
        );
        assert_eq!(out[2], 255, "untouched pixels follow the AI mask");
        assert_eq!(out[3], 0);
    }
}
