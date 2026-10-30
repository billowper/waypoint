import { useStore } from '../store'

/** After clicking a nudge: say why, and offer "don't nag about this" or a snooze */
export default function NudgeBanner() {
  const { nudge, setNudge, prefs, savePrefs, openFile, openProject, notes } = useStore()
  if (!nudge || !prefs) return null
  const mute = () => {
    savePrefs({ ...prefs, nudges: { ...prefs.nudges, muted: [...new Set([...prefs.nudges.muted, nudge.key])] } })
    setNudge(null)
  }
  const snooze = (minutes: number) => {
    savePrefs({ ...prefs, nudges: { ...prefs.nudges, snoozedUntil: Date.now() + minutes * 60_000 } })
    setNudge(null)
  }
  return (
    <div className="nudge-banner">
      <span className="nudge-mark">◆</span>
      <span className="nudge-text">
        {nudge.title && <b>{nudge.title}: </b>}
        {nudge.message}
      </span>
      {nudge.open && (
        <button
          className="btn small primary"
          onClick={() => {
            const o = nudge.open!
            if (o.kind === 'open' && notes.includes(o.path)) openFile(o.path)
            else if (o.kind === 'open-project') openProject(o.slug)
            setNudge({ key: nudge.key, message: nudge.message }) // keep mute/snooze on offer
          }}
        >
          Open
        </button>
      )}
      <button className="btn small" onClick={mute}>
        Don't nag about this
      </button>
      <button className="btn small" onClick={() => snooze(60)}>
        Snooze 1 h
      </button>
      <button className="icon-btn" title="Dismiss" onClick={() => setNudge(null)}>
        ×
      </button>
    </div>
  )
}
