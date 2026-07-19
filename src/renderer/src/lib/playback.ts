/**
 * How close to a boundary counts as "already there" rather than "needs a seek". Used both to
 * avoid seek jitter while a playing media element's own clock is trusted (PreviewPlayer's
 * resync effects), and to decide when natural playback has effectively reached the timeline's
 * end (PreviewPlayer's advancePastGap, the "Zum Ende" transport button, and restart-on-play).
 */
export const RESYNC_THRESHOLD_SEC = 0.3
