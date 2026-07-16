import ImportPanel from './components/ImportPanel/ImportPanel'
import SyncPanel from './components/SyncPanel/SyncPanel'
import TranscriptPanel from './components/TranscriptPanel/TranscriptPanel'
import HeatmapPanel from './components/HeatmapPanel/HeatmapPanel'
import TimelineEditor from './components/TimelineEditor/TimelineEditor'
import SettingsPanel from './components/SettingsPanel/SettingsPanel'

function App(): React.JSX.Element {
  return (
    <>
      <SettingsPanel />
      <ImportPanel />
      <SyncPanel />
      <TranscriptPanel />
      <HeatmapPanel />
      <TimelineEditor />
    </>
  )
}

export default App
