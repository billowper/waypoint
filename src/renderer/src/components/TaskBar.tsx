import { useEffect, useState } from 'react'
import { PRIORITIES, TASK_STATUSES, TASK_STATUS_LABEL, type Priority, type TaskStatus } from '@shared/types'
import { useStore } from '../store'
import { sendItems, sendToClaude, showMenu } from '../menus'
import { dueState } from './Board'

/** Task properties for the open task note, edited without touching its YAML */
export default function TaskBar({ path }: { path: string }) {
  const { tasks, updateTask, openBoard, prefs } = useStore()
  const task = tasks.find((t) => t.path === path)
  const [title, setTitle] = useState(task?.title ?? '')
  const [labels, setLabels] = useState(task?.labels.join(', ') ?? '')

  useEffect(() => {
    setTitle(task?.title ?? '')
    setLabels(task?.labels.join(', ') ?? '')
  }, [task?.title, task?.labels.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) return null
  const commitTitle = () => title.trim() && title.trim() !== task.title && updateTask(path, { title: title.trim() })
  const commitLabels = () => {
    const next = labels.split(',').map((l) => l.trim()).filter(Boolean)
    if (next.join(',') !== task.labels.join(',')) updateTask(path, { labels: next })
  }

  return (
    <div className="taskbar">
      <button className="task-id link" title="Open the board" onClick={() => openBoard(task.project)}>
        {task.id}
      </button>
      <input
        className="tb-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        aria-label="Task title"
      />
      <select value={task.status} onChange={(e) => updateTask(path, { status: e.target.value as TaskStatus })}>
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <select value={task.priority} onChange={(e) => updateTask(path, { priority: e.target.value as Priority })}>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <input
        type="date"
        className={`due ${dueState(task)}`}
        value={task.due}
        onChange={(e) => updateTask(path, { due: e.target.value })}
        aria-label="Due date"
      />
      <input
        className="tb-labels"
        value={labels}
        placeholder="labels"
        onChange={(e) => setLabels(e.target.value)}
        onBlur={commitLabels}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        aria-label="Labels"
      />
      {prefs?.claudeCode && (
        <button
          className="btn small"
          title={`Start a Claude Code session on this task, in the project's repo (${prefs.claudeSendTo === 'app' ? 'Claude app' : 'terminal'}). Right-click for the other way`}
          onClick={() => sendToClaude(task, prefs.claudeSendTo)}
          onContextMenu={(e) => showMenu(e, sendItems(task).slice(1))}
        >
          Send to Claude
        </button>
      )}
    </div>
  )
}
