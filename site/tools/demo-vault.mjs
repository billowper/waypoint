// Builds the made-up vault the website screenshots are taken from. Everything in it is sample data.
// Usage: node site/tools/demo-vault.mjs <empty folder>
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const DAY = 86400000
const iso = (offset = 0) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10)

export function buildVault(root) {
  root = resolve(root)
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  const put = (rel, text) => {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, text)
  }
  const git = (args, daysAgo) => {
    const when = new Date(Date.now() - (daysAgo ?? 0) * DAY).toISOString()
    execFileSync(
      'git',
      ['-c', 'user.name=Sam Carter', '-c', 'user.email=sam@example.com', '-c', 'commit.gpgsign=false', ...args],
      { cwd: root, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } }
    )
  }
  const commit = (message, daysAgo) => {
    git(['add', '-A'])
    git(['commit', '-m', message], daysAgo)
  }

  const SLUG = 'projects/harbour-cycles'

  // ---- Vault skeleton
  put('.app/settings.json', JSON.stringify({ version: 1, ideasMoved: true }, null, 2) + '\n')
  put('.gitignore', '.app/cache/\n')
  put('.app/project-order.json', JSON.stringify(['harbour-cycles', 'field-recordings', 'allotment-planner'], null, 2) + '\n')
  put(
    '.app/icons.json',
    JSON.stringify(
      {
        'projects/harbour-cycles': '🚲',
        'projects/field-recordings': '🎙️',
        'projects/allotment-planner': '🌱',
        [`${SLUG}/docs/Launch plan.md`]: '🚀',
        [`${SLUG}/docs/Launch plan/Redirect map.md`]: '🧭',
        [`${SLUG}/docs/Launch plan/Launch day checklist.md`]: '✅',
        [`${SLUG}/docs/Brand notes.md`]: '🎨',
        'notes/Reading list.md': '📚',
        'notes/Weekly review.md': '🗓️'
      },
      null,
      2
    ) + '\n'
  )
  git(['init', '-q', '-b', 'main'])

  // ---- General notes and ideas
  put(
    'notes/Reading list.md',
    `# Reading list

- [x] Shape Up, chapters 1 to 6
- [ ] Refactoring UI
- [ ] The Design of Everyday Things
`
  )
  put(
    'notes/Weekly review.md',
    `# Weekly review

## Done this week
- Agreed the launch date for [[Launch plan]]
- Booked the photo shoot

## Next week
- Finish the [[Redirect map]]
- Send the [[Booking flow]] copy for review
`
  )
  put('notes/Meeting notes/Priya, kick-off.md', '# Priya, kick-off\n\nPriya wants online bookings live before the Easter rush. See [[Launch plan]].\n')
  put('notes/Meeting notes/Workshop tour.md', '# Workshop tour\n\nPhotos of the repair bay would suit the [[Brand notes]] page.\n')
  put('ideas/Loyalty card for repeat hires.md', '# Loyalty card for repeat hires\n\n*3 Nov, 08:42*\n\nTenth hire free? Ask Priya.\n')
  put('ideas/Sunset ride route.md', '# Sunset ride route\n\n*2 Nov, 19:15*\n\nHarbour wall to the lighthouse and back. About an hour.\n')
  put('ideas/Podcast intro music.md', '# Podcast intro music\n\n*1 Nov, 12:03*\n\nTry the harbour bell recording under the theme.\n')

  // ---- Main project
  put(
    `${SLUG}/project.md`,
    `---
title: Harbour Cycles
status: active
key: HC
tags: [client, web]
created: ${iso(-34)}
repo:
  path: C:\\Code\\harbour-cycles
  remote: https://github.example.com/samcarter/harbour-cycles
links:
  - { title: Staging site, url: https://staging.example.com }
  - { title: Booking provider docs, url: https://docs.example.com/bookings }
bookmarks:
  - { title: Photo shoot, path: D:\\Work\\Harbour Cycles\\Photos }
---
# Harbour Cycles

New website for a family-run bike hire shop on the harbour front. Online bookings go live before the Easter rush, and the old site's pages all redirect.
`
  )
  put(
    `${SLUG}/docs/Launch plan.md`,
    `# Launch plan

Everything that has to happen before Harbour Cycles switches to the new site. Priya signs off on [[Brand notes]] first, then we freeze the content.

## Goal

> Take bookings online before the Easter rush, without losing a single page of the old site's search traffic.

## Milestones

- **20 Nov:** content freeze
- **4 Dec:** bookings on staging
- **18 Dec:** go live

## Before go-live

- [x] Move the photo gallery to the new host
- [x] Agree opening hours wording
- [ ] Finish the [[Redirect map]]
- [ ] Run the [[Launch day checklist]]
- [ ] Test a **real** card payment on \`staging\`

## Rollback

Keep the old host running for two weeks. If bookings fail, point DNS back:

\`\`\`bash
# TTL is already down to 300 seconds
dns set harbourcycles.example A 203.0.113.24
\`\`\`

## Open questions

Does the deposit stay at £10 for e-bikes? See the [[Booking flow]] notes.
`
  )
  put(
    `${SLUG}/docs/Launch plan/Redirect map.md`,
    `# Redirect map

Linked from the [[Launch plan]].

| Old page | New page |
| --- | --- |
| /hire.html | /bikes |
| /prices.php | /bikes#prices |
| /find-us.html | /visit |
`
  )
  put(
    `${SLUG}/docs/Launch plan/Launch day checklist.md`,
    `# Launch day checklist

Part of the [[Launch plan]].

- [ ] Lower DNS TTL the day before
- [ ] Switch DNS
- [ ] Place a test booking
- [ ] Watch the error log for an hour
`
  )
  put(
    `${SLUG}/docs/Booking flow.md`,
    `# Booking flow

Pick dates, pick a bike, pay a deposit. Priya wants it done in under a minute on a phone. Part of the [[Launch plan]].

## Deposits

- Standard bikes: £5
- E-bikes: £10 (to confirm)
`
  )
  put(
    `${SLUG}/docs/Brand notes.md`,
    `# Brand notes

Harbour blue, rope-coloured accents, and plenty of photos from the [[Workshop tour]]. Used by the [[Launch plan]] content freeze.
`
  )

  const task = (n, title, status, priority, due, labels, body = '') => {
    const id = `HC-${String(n).padStart(3, '0')}`
    const lines = [`id: ${id}`, `title: ${title}`, `status: ${status}`, `priority: ${priority}`]
    if (due !== null) lines.push(`due: ${iso(due)}`)
    if (labels.length) lines.push(`labels: [${labels.join(', ')}]`)
    lines.push(`created: ${iso(-20 + n)}`)
    if (status === 'done') lines.push(`completed: ${iso(-3)}`)
    put(`${SLUG}/tasks/${id}.md`, `---\n${lines.join('\n')}\n---\n${body}\n`)
  }
  task(1, 'Choose a booking provider', 'done', 'high', null, ['bookings'])
  task(2, 'Move the photo gallery', 'done', 'medium', null, ['content'])
  task(3, 'Agree opening hours wording', 'done', 'low', null, ['content'])
  task(4, 'Write the bike hire pages', 'doing', 'high', 2, ['content'], 'Standard, e-bike and tandem. Prices come from the [[Booking flow]] notes.')
  task(5, 'Build the booking form', 'doing', 'urgent', -1, ['bookings'], `Dates, bike, deposit. Must work one-handed on a phone.

## Progress

- Date checks are in.
- Deposit step next, once the [[Booking flow]] amounts are final.`)
  task(6, 'Finish the redirect map', 'todo', 'high', 5, ['seo'], 'See [[Redirect map]].')
  task(7, 'Test a real card payment', 'todo', 'high', 8, ['bookings'])
  task(8, 'Add the map to the visit page', 'todo', 'medium', 12, ['content'])
  task(9, 'Compress the gallery photos', 'todo', 'low', null, ['performance'])
  task(10, 'Sunset ride landing page', 'backlog', 'low', null, ['content'])
  task(11, 'Gift vouchers', 'backlog', 'medium', null, ['bookings'])
  task(12, 'Newsletter sign-up', 'backlog', 'low', null, [])

  // ---- Canvas board
  put(`${SLUG}/boards/Launch map.excalidraw`, JSON.stringify(launchBoard(SLUG), null, 2))

  // ---- Two smaller projects
  put(
    'projects/field-recordings/project.md',
    `---\ntitle: Field Recordings\nstatus: active\nkey: FR\ntags: [podcast]\ncreated: ${iso(-60)}\n---\n# Field Recordings\n\nSecond season of the podcast: six episodes recorded outdoors.\n`
  )
  put('projects/field-recordings/docs/Episode ideas.md', '# Episode ideas\n\n- Harbour bells at dawn\n- A morning at the fish market\n')
  put(
    'projects/field-recordings/tasks/FR-001.md',
    `---\nid: FR-001\ntitle: Edit episode 3\nstatus: doing\npriority: medium\ndue: ${iso(3)}\ncreated: ${iso(-6)}\n---\n`
  )
  put(
    'projects/field-recordings/tasks/FR-002.md',
    `---\nid: FR-002\ntitle: Book the fish market visit\nstatus: todo\npriority: low\ndue: ${iso(9)}\ncreated: ${iso(-4)}\n---\n`
  )
  put(
    'projects/allotment-planner/project.md',
    `---\ntitle: Allotment Planner\nstatus: paused\nkey: AP\ntags: [personal]\ncreated: ${iso(-120)}\n---\n# Allotment Planner\n\nA small planting calendar. Parked until spring.\n`
  )

  // ---- History: a believable run of commits, leaving a little uncommitted
  const plan = join(root, `${SLUG}/docs/Launch plan.md`)
  const finalPlan = execFileSyncRead(plan)
  put(
    `${SLUG}/docs/Launch plan.md`,
    finalPlan
      .replace('- **18 Dec:** go live', '- **11 Dec:** go live')
      .replace('- [x] Agree opening hours wording', '- [ ] Agree opening hours wording')
      .replace('Keep the old host running for two weeks', 'Keep the old host running for a week')
  )
  commit('Start the Harbour Cycles project', 12)
  put('notes/Weekly review.md', execFileSyncRead(join(root, 'notes/Weekly review.md')) + '\n')
  commit('Weekly review', 8)
  put(`${SLUG}/docs/Launch plan.md`, finalPlan.replace('- [x] Agree opening hours wording', '- [ ] Agree opening hours wording'))
  commit('Move go-live to 18 Dec, keep the old host for two weeks', 4)
  put(`${SLUG}/docs/Launch plan.md`, finalPlan)
  commit('Opening hours agreed', 1)
  put('ideas/Sunset ride route.md', '# Sunset ride route\n\n*2 Nov, 19:15*\n\nHarbour wall to the lighthouse and back. About an hour. Finish at the chip shop.\n')
  put('ideas/Rainy day discount.md', '# Rainy day discount\n\n*3 Nov, 17:30*\n\nHalf-price hire if it rains before 10am?\n')

  // ---- Claude Code connector: memory, a session log and the change feed
  put(
    `${SLUG}/claude/Memory.md`,
    '# Memory\n\n## Conventions\n- Prices live in one data file, never in page copy.\n\n## Decisions\n- Deposits are taken by the booking provider, not the site.\n'
  )
  put(
    `${SLUG}/claude/sessions/${iso(0)}.md`,
    '# Sessions\n\n## 16:20 · Booking form validation\n\nAdded date checks to the booking form.\n\n**Next:** test a real card payment.\n'
  )
  const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString()
  const log = [
    { minutes: 190, tool: 'create_note', action: 'created', path: `${SLUG}/docs/Booking flow.md`, summary: 'Created a note' },
    { minutes: 95, tool: 'update_task', action: 'updated', path: `${SLUG}/tasks/HC-005.md`, summary: 'HC-005: moved to Doing' },
    { minutes: 62, tool: 'create_task', action: 'created', path: `${SLUG}/tasks/HC-007.md`, summary: 'New task HC-007: Test a real card payment' },
    { minutes: 41, tool: 'append_to_note', action: 'appended', path: `${SLUG}/docs/Booking flow.md`, summary: 'Added the deposit amounts' },
    { minutes: 12, tool: 'update_task', action: 'updated', path: `${SLUG}/tasks/HC-004.md`, summary: 'HC-004: added a progress note' }
  ]
  put(
    '.app/claude-log.jsonl',
    log
      .map((l, i) =>
        JSON.stringify({ id: `demo-${i}`, at: at(l.minutes), tool: l.tool, action: l.action, path: l.path, summary: l.summary, session: 'C:\\Code\\harbour-cycles' })
      )
      .join('\n') + '\n'
  )
  return root
}

function execFileSyncRead(abs) {
  return execFileSync(process.execPath, ['-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))', abs], { encoding: 'utf8' })
}

/** The launch map: Excalidraw JSON, with a few cards linking back to notes and tasks */
function launchBoard(SLUG) {
  const elements = []
  let n = 0
  const base = (type, x, y, width, height, extra = {}) => ({
    id: `el-${++n}`,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: type === 'rectangle' ? { type: 3 } : null,
    seed: 1000 + n,
    version: 1,
    versionNonce: 2000 + n,
    isDeleted: false,
    boundElements: [],
    updated: 1,
    link: null,
    locked: false,
    ...extra
  })
  const text = (x, y, value, fontSize, extra = {}) => {
    const lines = value.split('\n')
    const width = Math.max(...lines.map((l) => l.length)) * fontSize * 0.55
    const height = lines.length * fontSize * 1.25
    const el = base('text', x, y, width, height, {
      text: value,
      originalText: value,
      fontSize,
      fontFamily: 5,
      textAlign: 'left',
      verticalAlign: 'top',
      containerId: null,
      lineHeight: 1.25,
      autoResize: true,
      ...extra
    })
    elements.push(el)
    return el
  }
  const card = (x, y, label, stroke, fill, link, width = 240, height = 84) => {
    const rect = base('rectangle', x, y, width, height, {
      strokeColor: stroke,
      backgroundColor: fill,
      link: link ? `waypoint://open/${encodeURIComponent(link)}` : null
    })
    elements.push(rect)
    const lines = label.split('\n').length
    const t = text(x + 16, y + (height - lines * 22.5) / 2, label, 18, {
      containerId: rect.id,
      textAlign: 'center',
      verticalAlign: 'middle',
      strokeColor: stroke === '#f08c00' ? '#1e1e1e' : '#1e1e1e'
    })
    t.width = width - 32
    rect.boundElements = [{ type: 'text', id: t.id }]
    return rect
  }
  const arrow = (from, to) => {
    const x = from.x + from.width
    const y = from.y + from.height / 2
    const dx = to.x - x
    const dy = to.y + to.height / 2 - y
    const el = base('arrow', x + 6, y, Math.abs(dx - 12), Math.abs(dy), {
      points: [
        [0, 0],
        [dx - 12, dy]
      ],
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: 'arrow',
      strokeColor: '#495057'
    })
    elements.push(el)
  }

  const content = card(0, 40, 'Content freeze\n20 Nov', '#1971c2', '#a5d8ff', `${SLUG}/docs/Launch plan.md`)
  const brand = card(0, 180, 'Brand notes', '#f08c00', '#ffec99', `${SLUG}/docs/Brand notes.md`)
  const pages = card(0, 320, 'HC-004\nBike hire pages', '#f08c00', '#ffec99', `${SLUG}/tasks/HC-004.md`)
  const bookings = card(360, 110, 'Bookings on staging\n4 Dec', '#1971c2', '#a5d8ff', `${SLUG}/docs/Booking flow.md`)
  const form = card(360, 250, 'HC-005\nBooking form', '#f08c00', '#ffec99', `${SLUG}/tasks/HC-005.md`)
  const redirects = card(720, 40, 'Redirect map', '#f08c00', '#ffec99', `${SLUG}/docs/Launch plan/Redirect map.md`)
  const payment = card(720, 180, 'HC-007\nReal card payment', '#f08c00', '#ffec99', `${SLUG}/tasks/HC-007.md`)
  const live = card(1080, 110, 'Go live\n18 Dec', '#2f9e44', '#b2f2bb', null, 240, 110)
  const after = card(1080, 280, 'Old host off\n1 Jan', '#868e96', '#e9ecef', null, 240, 84)

  arrow(content, bookings)
  arrow(brand, bookings)
  arrow(pages, form)
  arrow(bookings, redirects)
  arrow(form, payment)
  arrow(redirects, live)
  arrow(payment, live)

  text(720, 330, 'Ask Priya: does the £10\ne-bike deposit stay?', 20, { strokeColor: '#c2255c' })

  return { type: 'excalidraw', version: 2, source: 'waypoint', elements, appState: { viewBackgroundColor: '#ffffff' }, files: {} }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const target = process.argv[2]
  if (!target) {
    console.error('Usage: node site/tools/demo-vault.mjs <folder>')
    process.exit(1)
  }
  console.log('Demo vault at', buildVault(target))
}
