import { useStore } from '../store'

/** A brief message in the corner (a plugin command's {toast}); the store clears it after a few seconds */
export default function NoticeToast() {
  const notice = useStore((s) => s.notice)
  if (!notice) return null
  return (
    <div className={`notice-toast ${notice.error ? 'error' : ''}`} role="status" onClick={() => useStore.setState({ notice: null })}>
      {notice.text}
    </div>
  )
}
