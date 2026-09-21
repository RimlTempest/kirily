//! Guided-filter mask refinement.
//!
//! A segmentation model works at a fixed small input — 1024² here — and its
//! mask has to be blown up to whatever the user opened. However good the
//! resampling, the edge it produces is the model's edge at the model's
//! resolution: it sits near the subject's outline rather than on it, and a
//! diagonal comes out as a smooth ramp instead of a crisp boundary.
//!
//! The guided filter (He, Sun & Tang, 2010) fixes that by filtering the mask
//! *under the guidance of the original image*: the output is a local linear
//! function of the guide, so wherever the guide has an edge the mask snaps to
//! it. The paper calls this application "guided feathering" — turning a coarse
//! binary mask into something that reads as an alpha matte near boundaries.
//!
//! This is the fast variant (He & Sun, 2015): the per-window statistics are
//! computed on a subsampled pair and the two coefficient maps are upsampled
//! before the final combination, which costs O(n / s²) instead of O(n) with
//! no visible difference.
//!
//! The guide is luminance rather than full colour. The colour form inverts a
//! 3×3 matrix per window and separates edges that differ only in hue; that is
//! a real improvement on some images and roughly ten times the work, so it is
//! left for when a profile says it is worth it.
//!
//! One guard rail matters more than any parameter: the filter only applies
//! where the mask is already undecided. Left unchecked it will happily
//! re-segment — on an image whose subject contains something as bright as the
//! background, a confident foreground region gets dragged to transparent
//! because locally "bright" means "background". The job here is to move an
//! edge a few pixels onto the real one, not to decide what the subject is.

use kirily_image::{BufferError, ImageSize};

/// How hard to pull the mask onto the image's edges.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RefineOptions {
    /// Window radius, in pixels of the *full-resolution* image.
    ///
    /// This is the filter's reach, and it is the parameter that decides
    /// whether the result is an edge correction or a re-segmentation. It has
    /// to be big enough to span the gap between the model's edge and the real
    /// one, and small enough that it cannot reach from that edge into the
    /// subject's interior. Roughly 0.5% of the long edge holds both — see
    /// `refineRadiusFor` in `packages/image-core/src/guided.ts`, which is
    /// where callers get it from.
    pub radius: u32,
    /// Regularisation. Small values follow the guide closely and also follow
    /// its noise; large values smooth the mask and ignore weak edges.
    pub epsilon: f32,
    /// Statistics are computed at 1/subsample resolution. 1 disables it.
    pub subsample: u32,
    /// How much the mask must vary locally before the filter is allowed to
    /// touch it, as a variance of alpha in 0..1. Flat regions keep their
    /// value: the model was sure, and the guide is not evidence about what the
    /// subject is.
    pub min_variance: f32,
}

impl Default for RefineOptions {
    fn default() -> Self {
        // A baseline for a ~1600px image. Callers that know the size should
        // scale `radius` with it. epsilon is in (0..1)² units after
        // normalising the guide.
        // min_variance 4e-4 is a standard deviation of 2% of full alpha —
        // about 5 levels: enough to exclude a region the model called flatly
        // opaque while still covering every real transition.
        Self {
            radius: 8,
            epsilon: 1e-4,
            subsample: 4,
            min_variance: 4e-4,
        }
    }
}

/// Refines `mask` in place so its edges follow those of `rgba`.
pub fn refine_mask(
    rgba: &[u8],
    mask: &mut [u8],
    size: ImageSize,
    options: RefineOptions,
) -> Result<(), BufferError> {
    size.validate_rgba(rgba)?;
    size.validate_mask(mask)?;

    if options.radius == 0 {
        return Ok(());
    }

    let width = size.width() as usize;
    let height = size.height() as usize;
    let step = options.subsample.max(1) as usize;

    // Guide and mask at working resolution, both scaled to 0..1.
    let small_width = width.div_ceil(step);
    let small_height = height.div_ceil(step);
    let mut guide_small = vec![0f32; small_width * small_height];
    let mut mask_small = vec![0f32; small_width * small_height];

    for y in 0..small_height {
        for x in 0..small_width {
            let (sx, sy) = ((x * step).min(width - 1), (y * step).min(height - 1));
            let at = sy * width + sx;
            guide_small[y * small_width + x] = luminance(rgba, at);
            mask_small[y * small_width + x] = mask[at] as f32 / 255.0;
        }
    }

    let radius = (options.radius as usize / step).max(1);
    let mean_guide = box_blur(&guide_small, small_width, small_height, radius);
    let mean_mask = box_blur(&mask_small, small_width, small_height, radius);

    let mut guide_sq: Vec<f32> = guide_small.iter().map(|g| g * g).collect();
    let mut mask_sq: Vec<f32> = mask_small.iter().map(|m| m * m).collect();
    let mut cross: Vec<f32> = guide_small
        .iter()
        .zip(mask_small.iter())
        .map(|(g, m)| g * m)
        .collect();
    guide_sq = box_blur(&guide_sq, small_width, small_height, radius);
    cross = box_blur(&cross, small_width, small_height, radius);
    mask_sq = box_blur(&mask_sq, small_width, small_height, radius);

    // a = cov(I, p) / (var(I) + eps), b = mean(p) − a · mean(I)
    let mut a = vec![0f32; guide_small.len()];
    let mut b = vec![0f32; guide_small.len()];
    let mut gate = vec![0f32; guide_small.len()];
    for i in 0..guide_small.len() {
        let variance = guide_sq[i] - mean_guide[i] * mean_guide[i];
        let covariance = cross[i] - mean_guide[i] * mean_mask[i];
        a[i] = covariance / (variance + options.epsilon);
        b[i] = mean_mask[i] - a[i] * mean_guide[i];

        let mask_variance = (mask_sq[i] - mean_mask[i] * mean_mask[i]).max(0.0);
        // Ramps in over one more threshold's worth so the gate itself does not
        // become a visible boundary.
        gate[i] = if options.min_variance <= 0.0 {
            1.0
        } else {
            (mask_variance / options.min_variance - 1.0).clamp(0.0, 1.0)
        };
    }

    let a = box_blur(&a, small_width, small_height, radius);
    let b = box_blur(&b, small_width, small_height, radius);
    let gate = box_blur(&gate, small_width, small_height, radius);

    // q = mean(a) · I + mean(b), with the coefficients read back at full
    // resolution. The guide is full resolution here, which is what puts the
    // refined edge on the real one rather than on the subsampled grid.
    for y in 0..height {
        for x in 0..width {
            let at = y * width + x;
            let scale_x = x as f32 / step as f32;
            let scale_y = y as f32 / step as f32;
            let coefficient_a = sample_bilinear(&a, small_width, small_height, scale_x, scale_y);
            let coefficient_b = sample_bilinear(&b, small_width, small_height, scale_x, scale_y);
            let blend = sample_bilinear(&gate, small_width, small_height, scale_x, scale_y);
            let refined = coefficient_a * luminance(rgba, at) + coefficient_b;
            let original = mask[at] as f32 / 255.0;
            mask[at] = to_byte(original + (refined - original) * blend);
        }
    }

    Ok(())
}

fn luminance(rgba: &[u8], pixel: usize) -> f32 {
    let at = pixel * 4;
    // Rec. 709. The mask follows perceived edges, so the weights should be the
    // ones that match perceived brightness.
    (0.2126 * rgba[at] as f32 + 0.7152 * rgba[at + 1] as f32 + 0.0722 * rgba[at + 2] as f32) / 255.0
}

fn to_byte(value: f32) -> u8 {
    let scaled = value * 255.0 + 0.5;
    if scaled <= 0.0 {
        0
    } else if scaled >= 255.0 {
        255
    } else {
        scaled as u8
    }
}

/// Separable box blur with a running sum: O(1) per pixel whatever the radius.
fn box_blur(source: &[f32], width: usize, height: usize, radius: usize) -> Vec<f32> {
    let mut horizontal = vec![0f32; source.len()];
    let window_size = (radius * 2 + 1) as f32;

    for y in 0..height {
        let row = y * width;
        let mut sum = 0f32;
        // Edges are clamped: the window at x = 0 reads `radius` repeats of the
        // first pixel, then the pixels from 0 to radius — themselves clamped,
        // which is what a row shorter than the window needs.
        for x in 0..=radius {
            sum += source[row + x.min(width - 1)];
        }
        sum += source[row] * radius as f32;

        for x in 0..width {
            horizontal[row + x] = sum / window_size;
            let leaving = x.saturating_sub(radius);
            let entering = (x + radius + 1).min(width - 1);
            sum += source[row + entering] - source[row + leaving];
        }
    }

    let mut vertical = vec![0f32; source.len()];
    for x in 0..width {
        let mut sum = 0f32;
        for y in 0..=radius {
            sum += horizontal[y.min(height - 1) * width + x];
        }
        sum += horizontal[x] * radius as f32;

        for y in 0..height {
            vertical[y * width + x] = sum / window_size;
            let leaving = y.saturating_sub(radius);
            let entering = (y + radius + 1).min(height - 1);
            sum += horizontal[entering * width + x] - horizontal[leaving * width + x];
        }
    }

    vertical
}

fn sample_bilinear(source: &[f32], width: usize, height: usize, x: f32, y: f32) -> f32 {
    let x = x.clamp(0.0, (width - 1) as f32);
    let y = y.clamp(0.0, (height - 1) as f32);
    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = (x0 + 1).min(width - 1);
    let y1 = (y0 + 1).min(height - 1);
    let fx = x - x0 as f32;
    let fy = y - y0 as f32;

    let top = source[y0 * width + x0] * (1.0 - fx) + source[y0 * width + x1] * fx;
    let bottom = source[y1 * width + x0] * (1.0 - fx) + source[y1 * width + x1] * fx;
    top * (1.0 - fy) + bottom * fy
}

#[cfg(test)]
mod tests_support {
    /// An image split down the middle: black on the left, white on the right.
    pub fn split_image(width: usize, height: usize, edge: usize) -> Vec<u8> {
        let mut rgba = vec![0u8; width * height * 4];
        for y in 0..height {
            for x in 0..width {
                let value = if x < edge { 0 } else { 255 };
                let at = (y * width + x) * 4;
                rgba[at] = value;
                rgba[at + 1] = value;
                rgba[at + 2] = value;
                rgba[at + 3] = 255;
            }
        }
        rgba
    }

    /// The mask a model might return: the right answer, but a few pixels off
    /// and blurred, as a 1024² mask blown up to this size would be.
    pub fn offset_ramp(width: usize, height: usize, edge: usize, ramp: usize) -> Vec<u8> {
        let mut mask = vec![0u8; width * height];
        for y in 0..height {
            for x in 0..width {
                let value = if x + ramp < edge {
                    0
                } else if x > edge + ramp {
                    255
                } else {
                    (((x + ramp - edge.min(x + ramp)) as f32 / (ramp * 2) as f32) * 255.0) as u8
                };
                mask[y * width + x] = value;
            }
        }
        mask
    }
}

#[cfg(test)]
mod tests {
    /// The clamped padding was short whenever a side was no longer than the
    /// window, so a flat mask came back scaled down. The TypeScript mirror had
    /// the same bug; both are fixed and both are covered.
    #[test]
    fn a_flat_mask_stays_flat_whatever_the_shape() {
        for (width, height) in [(1usize, 1usize), (64, 1), (1, 64), (3, 3), (64, 64)] {
            let mut rgba = vec![0u8; width * height * 4];
            for i in 0..width * height {
                let value = ((i % 7) * 30) as u8;
                rgba[i * 4] = value;
                rgba[i * 4 + 1] = value;
                rgba[i * 4 + 2] = value;
                rgba[i * 4 + 3] = 255;
            }
            let mut mask = vec![255u8; width * height];
            let size = ImageSize::new(width as u32, height as u32).unwrap();
            refine_mask(
                &rgba,
                &mut mask,
                size,
                RefineOptions {
                    radius: 4,
                    ..RefineOptions::default()
                },
            )
            .unwrap();
            assert!(
                mask.iter().all(|&v| v == 255),
                "{width}x{height} changed a flat mask"
            );
        }
    }

    use super::tests_support::*;
    use super::*;

    fn size(w: u32, h: u32) -> ImageSize {
        ImageSize::new(w, h).unwrap()
    }

    #[test]
    fn snaps_a_soft_mask_edge_onto_the_image_edge() {
        let (w, h, edge) = (64usize, 64usize, 32usize);
        let rgba = split_image(w, h, edge);
        // A mask whose edge sits 6 px early and ramps over 12 px — what a
        // 1024² result looks like once it is blown up.
        let before = offset_ramp(w, h, edge - 6, 6);
        let mut after = before.clone();

        refine_mask(
            &rgba,
            &mut after,
            size(w as u32, h as u32),
            RefineOptions {
                radius: 16,
                epsilon: 1e-4,
                subsample: 1,
                min_variance: 0.0,
            },
        )
        .unwrap();

        let row = 32 * w;
        let step = |mask: &[u8]| mask[row + edge] as i32 - mask[row + edge - 1] as i32;

        // The mask now steps at the image's own edge instead of drifting
        // across it: measured, 22 levels before and about 150 after.
        assert!(
            step(&after) > step(&before) * 5,
            "edge did not snap: {} -> {}",
            step(&before),
            step(&after)
        );

        // The steepest point moved onto the guide's edge.
        let steepest = (1..w)
            .max_by_key(|x| (after[row + x] as i32 - after[row + x - 1] as i32).abs())
            .unwrap();
        assert_eq!(
            steepest, edge,
            "steepest transition is not at the image edge"
        );

        // The side the image says is background is pulled towards transparent.
        assert!(
            after[row + edge - 2] < before[row + edge - 2],
            "background side not darkened: {} -> {}",
            before[row + edge - 2],
            after[row + edge - 2]
        );
        // And the foreground stays foreground.
        assert!(
            after[row + 56] > 231,
            "foreground faded to {}",
            after[row + 56]
        );
    }

    #[test]
    fn keeps_a_confident_region_even_when_the_guide_disagrees() {
        // A bright patch inside the subject, on an image whose background is
        // also bright: locally "bright" means "background", so an ungated
        // filter drags the patch to transparent. The model was certain here —
        // the mask is flatly opaque — so the filter must leave it alone.
        let (w, h) = (64usize, 64usize);
        let mut rgba = vec![255u8; w * h * 4];
        for y in 0..h {
            for x in 16..48 {
                let at = (y * w + x) * 4;
                rgba[at] = 60;
                rgba[at + 1] = 90;
                rgba[at + 2] = 180;
            }
        }
        // A white highlight inside the dark band, as bright as the background.
        for y in 24..40 {
            for x in 26..34 {
                let at = (y * w + x) * 4;
                rgba[at] = 254;
                rgba[at + 1] = 254;
                rgba[at + 2] = 254;
            }
        }

        let mut mask = vec![0u8; w * h];
        for y in 0..h {
            for x in 16..48 {
                mask[y * w + x] = 255;
            }
        }

        refine_mask(
            &rgba,
            &mut mask,
            size(w as u32, h as u32),
            RefineOptions::default(),
        )
        .unwrap();

        let centre = mask[32 * w + 30];
        assert!(
            centre > 231,
            "highlight inside the subject faded to {centre}"
        );
    }

    #[test]
    fn leaves_a_mask_alone_where_the_image_has_no_edge() {
        let (w, h) = (32usize, 32usize);
        let rgba = vec![128u8; w * h * 4];
        let mut mask = vec![200u8; w * h];

        refine_mask(
            &rgba,
            &mut mask,
            size(w as u32, h as u32),
            RefineOptions::default(),
        )
        .unwrap();

        // A flat guide carries no information, so the filter falls back to the
        // local mean — which for a flat mask is the mask itself.
        for value in &mask {
            assert!((*value as i32 - 200).abs() <= 1, "drifted to {value}");
        }
    }

    #[test]
    fn a_fully_opaque_mask_stays_opaque() {
        let (w, h) = (48usize, 48usize);
        let rgba = split_image(w, h, 24);
        let mut mask = vec![255u8; w * h];

        refine_mask(
            &rgba,
            &mut mask,
            size(w as u32, h as u32),
            RefineOptions::default(),
        )
        .unwrap();

        for value in &mask {
            assert!(*value > 250, "opaque mask leaked to {value}");
        }
    }

    #[test]
    fn a_fully_transparent_mask_stays_transparent() {
        let (w, h) = (48usize, 48usize);
        let rgba = split_image(w, h, 24);
        let mut mask = vec![0u8; w * h];

        refine_mask(
            &rgba,
            &mut mask,
            size(w as u32, h as u32),
            RefineOptions::default(),
        )
        .unwrap();

        for value in &mask {
            assert!(*value < 5, "transparent mask leaked to {value}");
        }
    }

    #[test]
    fn subsampling_matches_the_full_resolution_result_closely() {
        let (w, h, edge) = (96usize, 96usize, 48usize);
        let rgba = split_image(w, h, edge);
        let original = offset_ramp(w, h, edge - 4, 6);

        let mut exact = original.clone();
        refine_mask(
            &rgba,
            &mut exact,
            size(w as u32, h as u32),
            RefineOptions {
                radius: 12,
                epsilon: 1e-4,
                subsample: 1,
                min_variance: 0.0,
            },
        )
        .unwrap();

        let mut fast = original.clone();
        refine_mask(
            &rgba,
            &mut fast,
            size(w as u32, h as u32),
            RefineOptions {
                radius: 12,
                epsilon: 1e-4,
                subsample: 4,
                min_variance: 0.0,
            },
        )
        .unwrap();

        let error: f64 = exact
            .iter()
            .zip(fast.iter())
            .map(|(a, b)| (*a as f64 - *b as f64).abs())
            .sum::<f64>()
            / exact.len() as f64;
        assert!(error < 6.0, "fast variant drifted by {error} on average");
    }

    #[test]
    fn a_zero_radius_is_a_no_op() {
        let (w, h) = (16usize, 16usize);
        let rgba = split_image(w, h, 8);
        let original = offset_ramp(w, h, 6, 3);
        let mut mask = original.clone();

        refine_mask(
            &rgba,
            &mut mask,
            size(w as u32, h as u32),
            RefineOptions {
                radius: 0,
                ..RefineOptions::default()
            },
        )
        .unwrap();

        assert_eq!(mask, original);
    }

    #[test]
    fn rejects_buffers_that_do_not_match_the_size() {
        let mut mask = vec![0u8; 10];
        assert!(refine_mask(&[0u8; 64], &mut mask, size(4, 4), RefineOptions::default()).is_err());
    }
}
