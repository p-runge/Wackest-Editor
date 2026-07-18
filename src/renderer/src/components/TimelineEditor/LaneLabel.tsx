interface LaneLabelProps {
  heightPx: number
  children: React.ReactNode
}

/** Plain, non-interactive row label for the sidebar (subtitle/heatmap/cut lanes) — sized to
 *  match its counterpart track's height exactly, since the two now live in separate columns. */
function LaneLabel({ heightPx, children }: LaneLabelProps): React.JSX.Element {
  return (
    <div className="lane-label" style={{ height: heightPx }}>
      {children}
    </div>
  )
}

export default LaneLabel
