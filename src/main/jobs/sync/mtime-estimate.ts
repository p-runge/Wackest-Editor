import { stat } from 'fs/promises'

/**
 * Rough estimate of a recording's real-world start time, derived from the file's mtime
 * (assumed close to when the recording finished/was saved) minus its own duration.
 * Returns null if the file's mtime can't be read — callers must fall back to a full scan.
 */
export async function estimateFileStartEpochMs(
  filePath: string,
  durationSec: number
): Promise<number | null> {
  try {
    const info = await stat(filePath)
    if (!info.mtimeMs || Number.isNaN(info.mtimeMs)) return null
    return info.mtimeMs - durationSec * 1000
  } catch {
    return null
  }
}

/**
 * Expected offset (seconds) such that `query.localTime + offsetSec ≈ reference.localTime`,
 * derived from each segment's estimated wall-clock start time. Null if either estimate is missing.
 */
export function expectedOffsetSec(
  referenceSegmentEstimatedStartEpochMs: number | null,
  referenceSegmentLocalStartSec: number,
  querySegmentEstimatedStartEpochMs: number | null,
  querySegmentLocalStartSec: number
): number | null {
  if (
    referenceSegmentEstimatedStartEpochMs === null ||
    querySegmentEstimatedStartEpochMs === null
  ) {
    return null
  }
  const refZeroEpochMs =
    referenceSegmentEstimatedStartEpochMs + referenceSegmentLocalStartSec * 1000
  const queryZeroEpochMs = querySegmentEstimatedStartEpochMs + querySegmentLocalStartSec * 1000
  return (queryZeroEpochMs - refZeroEpochMs) / 1000
}
