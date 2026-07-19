// Same-environment multi-cam footage (shared ambient noise/device self-noise across clips that
// don't actually overlap in time) produces a false-positive floor around ~0.04 — well above the
// old 0.005 bar, which let those spurious edges bridge unrelated clips in the sync graph. Real
// overlapping matches in that same test set scored 0.49-0.61, so 0.15 sits with margin on both
// sides of the observed gap.
export const MIN_TRUSTED_CONFIDENCE = 0.15
