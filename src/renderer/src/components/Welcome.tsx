import { useStore } from '../store'

export default function Welcome() {
  const openVault = useStore((s) => s.openVault)
  return (
    <div className="welcome">
      <div className="titlebar-drag" />
      <div className="welcome-card">
        <div className="brand-mark">◆</div>
        <h1>Waypoint</h1>
        <p>
          Pick a folder to use as your vault. Everything is stored as plain Markdown, so it works
          with any editor and with git.
        </p>
        <button className="btn primary" onClick={openVault}>
          Open or create a vault…
        </button>
      </div>
    </div>
  )
}
