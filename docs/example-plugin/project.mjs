// A project view (scope "project"): opens with state { project: <slug> }. Tasks arrive with `data`: their whole front matter.
import { waypoint } from '/_waypoint/bridge.mjs'

const $ = (id) => document.getElementById(id)
await waypoint.ready
const project = waypoint.state?.project
$('title').textContent = `Example tasks · ${project}`

const OWN_KEYS = ['id', 'title', 'status', 'priority', 'created', 'labels', 'due', 'completed', 'archived']

async function load() {
  const tasks = await waypoint.call('tasks', { project })
  $('list').replaceChildren(
    ...tasks.map((t) => {
      const li = document.createElement('li')
      li.textContent = `${t.id} ${t.title} [${t.status}] `
      const extra = Object.keys(t.data).filter((k) => !OWN_KEYS.includes(k))
      if (extra.length) li.append(Object.assign(document.createElement('code'), { textContent: extra.map((k) => `${k}=${JSON.stringify(t.data[k])}`).join(' ') }))
      li.addEventListener('contextmenu', async (e) => {
        const choice = await waypoint.menu(e, [
          { id: 'open', label: 'Open in Waypoint' },
          { id: 'copy', label: 'Copy ID' }
        ])
        if (choice === 'open') waypoint.openTask(t.id)
        else if (choice === 'copy') navigator.clipboard?.writeText(t.id).catch(() => undefined)
      })
      return li
    })
  )
}

$('add').addEventListener('click', async () => {
  await waypoint.call('addTask', { project })
  await load()
})
await load()
