//! `ventloom_engine` - the geodetic core, reimplemented in Rust.
//!
//! Why a second implementation when `@repo/core` already does this in
//! TypeScript? Because an inversion you can only run in one language is an
//! inversion you cannot cross-check. This crate is the *reference oracle*:
//! the TypeScript solver is validated against it in CI by comparing recovered
//! depth, volume and RMS misfit on the same seeded fields, and any divergence
//! greater than a documented tolerance is a failure rather than a curiosity.
//!
//! The division of labour is deliberate:
//!
//! * TypeScript (`packages/core`) is the product. It runs in the browser and
//!   in Next.js route handlers, and it is what a reader sees.
//! * Rust (`crates/engine`) is the check. It has no React, no HTTP, no seed
//!   catalogue - just numbers in, numbers out, so it can be dropped into a
//!   CI job, an `unsafe` FFI shim or a bench harness without dragging the
//!   rest of the observatory with it.
//!
//! Nothing here wraps a C library: the formulations are the same closed forms
//! documented in `docs/models.md`, and the crate has zero dependencies so it
//! builds with a stock `cargo` and no native toolchain.
//!
//! # Example
//!
//! ```
//! use ventloom_engine::{mogi_forward, mogi_invert, Source, Station};
//!
//! let stations = vec![
//!     Station { east_offset_m: 0.0, north_offset_m: 0.0 },
//!     Station { east_offset_m: 1_500.0, north_offset_m: 0.0 },
//!     Station { east_offset_m: 0.0, north_offset_m: 1_500.0 },
//!     Station { east_offset_m: -1_500.0, north_offset_m: 0.0 },
//!     Station { east_offset_m: 0.0, north_offset_m: -1_500.0 },
//! ];
//! let truth = Source {
//!     east_offset_m: 0.0,
//!     north_offset_m: 0.0,
//!     depth_m: 4_000.0,
//!     volume_change_m3: 2.5e6,
//! };
//! let observed = mogi_forward(&stations, &truth, 0.25);
//! let fit = mogi_invert(&stations, &observed, 0.25, 0.004, None);
//!
//! assert!(fit.converged);
//! assert!((fit.source.depth_m - truth.depth_m).abs() / truth.depth_m < 0.10);
//! ```

#![deny(missing_docs)]
#![warn(clippy::all)]

pub mod fft;
pub mod linalg;
pub mod mogi;

pub use fft::{amplitude_spectrum, dominant_frequency, hann_window, power_spectrum, FftError};
pub use linalg::{solve_linear, MatrixError};
pub use mogi::{
    mogi_forward, mogi_invert, station_displacement, Displacement, Fit, InversionOptions, Source,
    Station,
};

/// Poisson's ratio assumed throughout: a basaltic to andesitic crust.
pub const DEFAULT_POISSON: f64 = 0.25;
