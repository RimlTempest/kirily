//! Basic image types shared by every Kirily crate.
//!
//! Nothing here allocates a frame buffer or talks to the outside world. The
//! point is that a size or a rectangle can be checked once, at the boundary,
//! so the hot loops downstream can index without re-validating every pixel.

/// Why a buffer could not be used for the size it claims to have.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BufferError {
    /// `width * height` overflowed, or either side is zero.
    InvalidSize { width: u32, height: u32 },
    /// The slice does not hold exactly the number of bytes the size implies.
    LengthMismatch { expected: usize, actual: usize },
    /// A rectangle reaches outside the image it is applied to.
    OutOfBounds,
}

/// A validated image size. Constructing one proves `width * height * 4` fits in
/// a `usize`, which is what lets the raster code index without checking.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageSize {
    width: u32,
    height: u32,
}

impl ImageSize {
    pub fn new(width: u32, height: u32) -> Result<Self, BufferError> {
        let ok = width > 0
            && height > 0
            && (width as usize)
                .checked_mul(height as usize)
                .and_then(|p| p.checked_mul(4))
                .is_some();

        if ok {
            Ok(Self { width, height })
        } else {
            Err(BufferError::InvalidSize { width, height })
        }
    }

    pub const fn width(self) -> u32 {
        self.width
    }

    pub const fn height(self) -> u32 {
        self.height
    }

    /// Number of pixels — also the length of an 8-bit alpha mask.
    pub const fn pixel_count(self) -> usize {
        self.width as usize * self.height as usize
    }

    /// Number of bytes in an RGBA buffer of this size.
    pub const fn rgba_len(self) -> usize {
        self.pixel_count() * 4
    }

    pub fn validate_rgba(self, rgba: &[u8]) -> Result<(), BufferError> {
        let expected = self.rgba_len();
        if rgba.len() == expected {
            Ok(())
        } else {
            Err(BufferError::LengthMismatch {
                expected,
                actual: rgba.len(),
            })
        }
    }

    pub fn validate_mask(self, mask: &[u8]) -> Result<(), BufferError> {
        let expected = self.pixel_count();
        if mask.len() == expected {
            Ok(())
        } else {
            Err(BufferError::LengthMismatch {
                expected,
                actual: mask.len(),
            })
        }
    }
}

/// A rectangle in image coordinates — always the *original* image's pixels,
/// never the preview's (kirily-design.md §11).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    /// Fails when the rectangle is empty or reaches past the image edge, so a
    /// crop never has to clamp silently and produce a surprising output size.
    pub fn validate_within(self, size: ImageSize) -> Result<(), BufferError> {
        let fits = self.width > 0
            && self.height > 0
            && self
                .x
                .checked_add(self.width)
                .is_some_and(|r| r <= size.width())
            && self
                .y
                .checked_add(self.height)
                .is_some_and(|b| b <= size.height());

        if fits {
            Ok(())
        } else {
            Err(BufferError::OutOfBounds)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_zero_sized_images() {
        assert_eq!(
            ImageSize::new(0, 10),
            Err(BufferError::InvalidSize {
                width: 0,
                height: 10
            })
        );
        assert_eq!(
            ImageSize::new(10, 0),
            Err(BufferError::InvalidSize {
                width: 10,
                height: 0
            })
        );
    }

    #[test]
    fn rejects_sizes_whose_rgba_length_overflows() {
        assert!(ImageSize::new(u32::MAX, u32::MAX).is_err());
    }

    #[test]
    fn reports_buffer_lengths_for_a_4k_frame() {
        let size = ImageSize::new(3840, 2160).unwrap();
        assert_eq!(size.pixel_count(), 8_294_400);
        assert_eq!(size.rgba_len(), 33_177_600);
    }

    #[test]
    fn validates_buffer_lengths_exactly() {
        let size = ImageSize::new(2, 2).unwrap();
        assert!(size.validate_rgba(&[0; 16]).is_ok());
        assert_eq!(
            size.validate_rgba(&[0; 15]),
            Err(BufferError::LengthMismatch {
                expected: 16,
                actual: 15
            })
        );
        assert!(size.validate_mask(&[0; 4]).is_ok());
    }

    #[test]
    fn rect_must_stay_inside_the_image() {
        let size = ImageSize::new(100, 50).unwrap();
        assert!(
            Rect {
                x: 0,
                y: 0,
                width: 100,
                height: 50
            }
            .validate_within(size)
            .is_ok()
        );
        assert!(
            Rect {
                x: 1,
                y: 0,
                width: 100,
                height: 50
            }
            .validate_within(size)
            .is_err()
        );
        assert!(
            Rect {
                x: 0,
                y: 0,
                width: 0,
                height: 10
            }
            .validate_within(size)
            .is_err()
        );
        assert!(
            Rect {
                x: u32::MAX,
                y: 0,
                width: 2,
                height: 2
            }
            .validate_within(size)
            .is_err()
        );
    }
}
