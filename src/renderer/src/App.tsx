import { useProjectStore } from './state/project-store'
import TopBar from './components/TopBar/TopBar'
import StartScreen from './components/StartScreen/StartScreen'
import WorkflowPanel from './components/WorkflowPanel/WorkflowPanel'
import TimelineEditor from './components/TimelineEditor/TimelineEditor'

function App(): React.JSX.Element {
  const project = useProjectStore((state) => state.project)

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      {!project ? (
        <StartScreen />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <WorkflowPanel />
          <div className="min-h-0 flex-1">
            <TimelineEditor />
          </div>
        </div>
      )}
    </div>
  )
}

export default App
