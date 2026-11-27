// One page for both panels (Home and project pages): waypoint.kind is "panel", waypoint.state is { project } or null
import { waypoint } from '/_waypoint/bridge.mjs'

const $ = (id) => document.getElementById(id)
await waypoint.ready

$('where').textContent = waypoint.state?.project
  ? `Panel on the page of project "${waypoint.state.project}" (kind: ${waypoint.kind})`
  : `Panel on Home (kind: ${waypoint.kind})`

let lines = 0
$('add').addEventListener('click', () => {
  const p = document.createElement('p')
  p.textContent = `Line ${++lines}`
  $('lines').append(p)
})

// Waypoint's own right-click menu; resolves to the chosen id, or null when dismissed
let shout = false
document.addEventListener('contextmenu', async (e) => {
  const choice = await waypoint.menu(e, [
    { id: 'add', label: 'Add a line' },
    { id: 'shout', label: 'Shout', checked: shout },
    'separator',
    { id: 'clear', label: 'Clear lines', danger: true, disabled: lines === 0 }
  ])
  if (choice === 'add') $('add').click()
  else if (choice === 'shout') {
    shout = !shout
    document.body.style.textTransform = shout ? 'uppercase' : ''
  } else if (choice === 'clear') {
    $('lines').replaceChildren()
    lines = 0
  }
})

// On Home the panel also chooses which projects the plugin links to (host.projects.setLinked, in the main module)
if (!waypoint.state?.project) {
  $('letters').hidden = false
  const show = (s) => {
    $('input').value = s.letters
    $('linked').textContent = `Linked: ${s.linked.join(', ') || '(none)'}`
  }
  show(await waypoint.call('settings'))
  $('set').addEventListener('click', async () => show(await waypoint.call('setLetters', { letters: $('input').value })))
}
