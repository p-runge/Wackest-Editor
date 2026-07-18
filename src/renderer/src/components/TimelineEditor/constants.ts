// Height of the sticky time ruler at the top of the body — mirrored by a blank spacer at the
// top of the sidebar so rows line up between the two columns.
export const RULER_HEIGHT_PX = 24

// Height of the sticky "Video-Quellen" / "Audio-Quellen" section header row, shared by the
// sidebar's label and the body's matching divider so they stay vertically in sync.
export const SECTION_HEADER_HEIGHT_PX = 24

// Row height for a source (video/audio) lane, shared by its sidebar label and body track.
export const SOURCE_LANE_HEIGHT_PX = 44

// Row height for the subtitle/heatmap/cut lanes, shared by their sidebar label and body track.
export const SIMPLE_LANE_HEIGHT_PX = 28

// Blank trailing space at the bottom of both columns' content — the body's horizontal scrollbar
// is styled to take up no layout space (see .timeline-body::-webkit-scrollbar:horizontal), so
// without this the last row would sit flush against the container edge in both columns.
export const BOTTOM_SPACER_PX = 8
