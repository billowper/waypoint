// The page of the example plugin. Everything Waypoint offers a page comes from the bridge.
import { waypoint } from '/_waypoint/bridge.mjs'

const $ = (id) => document.getElementById(id)

await waypoint.ready // Waypoint has sent the view's state and the theme

const showState = () => {
  $('view').textContent = `view: ${waypoint.view}`
  $('state').textContent = `state: ${JSON.stringify(waypoint.state)}`
}
showState()

$('count').addEventListener('click', () => {
  const clicks = (waypoint.state?.clicks ?? 0) + 1
  waypoint.setState({ ...waypoint.state, clicks })
  showState()
})

const showTheme = () => {
  const style = getComputedStyle(document.documentElement)
  $('theme').textContent = `data-theme="${document.documentElement.dataset.theme}", --wp-accent ${style.getPropertyValue('--wp-accent').trim()}, --wp-bg ${style.getPropertyValue('--wp-bg').trim()}`
}
showTheme()
new MutationObserver(showTheme).observe(document.documentElement, { attributes: true })

const show = (value) => ($('answer').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2))
const attempt = async (fn) => {
  try {
    $('answer').classList.remove('error')
    show(await fn())
  } catch (e) {
    $('answer').classList.add('error')
    show(`Error${e.status ? ` ${e.status}` : ''}: ${e.message}`)
  }
}

$('ask').addEventListener('click', () => attempt(() => waypoint.call('summary')))
$('toast').addEventListener('click', () => attempt(() => waypoint.call('toast', { text: 'Click this toast to come back here.' })))
$('external').addEventListener('click', () => waypoint.openExternal('https://example.com'))

// waypoint.kind is "view" here; waypoint.menu opens Waypoint's own menu at the pointer and answers with the chosen id, or null
document.addEventListener('contextmenu', async (e) => {
  const choice = await waypoint.menu(e, [
    { id: 'a', label: 'First', checked: true },
    { id: 'b', label: 'Second', checked: false },
    'separator',
    { id: 'x', label: 'Danger', danger: true }
  ])
  $('menu').textContent = `kind: ${waypoint.kind}, choice: ${JSON.stringify(choice)}`
})

waypoint.on('tick', (tick) => {
  const li = document.createElement('li')
  li.textContent = `#${tick.n} at ${tick.at}`
  $('ticks').prepend(li)
  while ($('ticks').children.length > 5) $('ticks').lastChild.remove()
})
