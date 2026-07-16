import ImportPanel from './components/ImportPanel/ImportPanel'
import SyncPanel from './components/SyncPanel/SyncPanel'
import TranscriptPanel from './components/TranscriptPanel/TranscriptPanel'
import SettingsPanel from './components/SettingsPanel/SettingsPanel'

function App(): React.JSX.Element {
  return (
    <>
      <SettingsPanel />
      <ImportPanel />
      <SyncPanel />
      <TranscriptPanel />
    </>
  )
}

export default App
