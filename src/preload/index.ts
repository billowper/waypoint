import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api, AppCommand, ChangeEvent } from '../shared/types'
import type { Prefs } from '../shared/prefs'

const api: Api = {
  getVault: () => ipcRenderer.invoke('vault:get'),
  openVault: () => ipcRenderer.invoke('vault:open'),
  tree: () => ipcRenderer.invoke('vault:tree'),
  stats: () => ipcRenderer.invoke('vault:stats'),
  read: (rel) => ipcRenderer.invoke('file:read', rel),
  write: (rel, content) => ipcRenderer.invoke('file:write', rel, content),
  createNote: (dir, name) => ipcRenderer.invoke('file:createNote', dir, name),
  createFolder: (dir, name) => ipcRenderer.invoke('file:createFolder', dir, name),
  rename: (rel, name, syncHeading) => ipcRenderer.invoke('file:rename', rel, name, syncHeading),
  move: (rel, destDir) => ipcRenderer.invoke('file:move', rel, destDir),
  duplicate: (rel) => ipcRenderer.invoke('file:duplicate', rel),
  trash: (rel) => ipcRenderer.invoke('file:trash', rel),
  search: (query) => ipcRenderer.invoke('index:search', query),
  backlinks: (rel) => ipcRenderer.invoke('index:backlinks', rel),
  projects: () => ipcRenderer.invoke('projects:list'),
  createProject: (name) => ipcRenderer.invoke('projects:create', name),
  saveProject: (slug, settings) => ipcRenderer.invoke('projects:save', slug, settings),
  saveProjectOrder: (slugs) => ipcRenderer.invoke('projects:order', slugs),
  treeOrder: () => ipcRenderer.invoke('tree:order'),
  saveTreeOrder: (dir, names) => ipcRenderer.invoke('tree:saveOrder', dir, names),
  openPath: (path) => ipcRenderer.invoke('ext:open', path),
  revealPath: (path) => ipcRenderer.invoke('ext:reveal', path),
  openInCode: (path) => ipcRenderer.invoke('ext:code', path),
  pickPath: (kind) => ipcRenderer.invoke('ext:pick', kind),
  linkedDoc: (rel) => ipcRenderer.invoke('linked:read', rel),
  linkedAct: (rel, action, href) => ipcRenderer.invoke('linked:act', rel, action, href),
  linkFile: (dir) => ipcRenderer.invoke('linked:create', dir),
  onLinkedChanged: (cb) => {
    const h = (_e: IpcRendererEvent, file: string) => cb(file)
    ipcRenderer.on('linked:changed', h)
    return () => ipcRenderer.removeListener('linked:changed', h)
  },
  claudeStatus: (slug) => ipcRenderer.invoke('claude:status', slug),
  claudeConnect: () => ipcRenderer.invoke('claude:connect'),
  claudeDisconnect: () => ipcRenderer.invoke('claude:disconnect'),
  claudeInstructions: (slug) => ipcRenderer.invoke('claude:instructions', slug),
  claudeProjects: () => ipcRenderer.invoke('claude:projects'),
  claudeOpen: (slug, where) => ipcRenderer.invoke('claude:open', slug, where),
  claudeSendTask: (rel, where) => ipcRenderer.invoke('claude:send-task', rel, where),
  claudeChanges: (slug, limit) => ipcRenderer.invoke('claude:changes', slug, limit),
  claudeUndo: (id) => ipcRenderer.invoke('claude:undo', id),
  tasks: (project) => ipcRenderer.invoke('tasks:list', project),
  createTask: (project, fields) => ipcRenderer.invoke('tasks:create', project, fields),
  updateTask: (rel, patch) => ipcRenderer.invoke('tasks:update', rel, patch),
  vaultSettings: () => ipcRenderer.invoke('settings:get'),
  saveVaultSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  gitStatus: () => ipcRenderer.invoke('git:status'),
  gitInit: () => ipcRenderer.invoke('git:init'),
  gitCommit: (message) => ipcRenderer.invoke('git:commit', message),
  gitPull: () => ipcRenderer.invoke('git:pull'),
  gitPush: () => ipcRenderer.invoke('git:push'),
  gitConnectRemote: (url) => ipcRenderer.invoke('git:connectRemote', url),
  gitLog: (file) => ipcRenderer.invoke('git:log', file),
  gitDiff: (hash, file) => ipcRenderer.invoke('git:diff', hash, file),
  reveal: (rel) => ipcRenderer.invoke('file:reveal', rel),
  recent: () => ipcRenderer.invoke('recent:get'),
  touchRecent: (rel) => ipcRenderer.invoke('recent:touch', rel),
  onChanged: (cb) => {
    const h = (_e: IpcRendererEvent, events: ChangeEvent[]) => cb(events)
    ipcRenderer.on('vault:changed', h)
    return () => ipcRenderer.removeListener('vault:changed', h)
  },
  onGitChanged: (cb) => {
    const h = () => cb()
    ipcRenderer.on('git:changed', h)
    return () => ipcRenderer.removeListener('git:changed', h)
  },
  onCommand: (cb) => {
    const h = (_e: IpcRendererEvent, c: AppCommand) => cb(c)
    ipcRenderer.on('app:command', h)
    ipcRenderer.send('app:ready') // ask for any command the app was launched with
    return () => ipcRenderer.removeListener('app:command', h)
  },
  prefs: () => ipcRenderer.invoke('prefs:get'),
  savePrefs: (prefs) => ipcRenderer.invoke('prefs:save', prefs),
  desktopInfo: () => ipcRenderer.invoke('desktop:info'),
  captureAdd: (text) => ipcRenderer.invoke('capture:add', text),
  captureClose: () => ipcRenderer.send('capture:close'),
  searchOpen: (path, reveal, newTab) => ipcRenderer.send('search:open', { kind: 'open', path, reveal, newTab }),
  searchClose: () => ipcRenderer.send('search:close'),
  popupHeight: (px) => ipcRenderer.send('popup:height', px),
  nudgeNow: () => ipcRenderer.invoke('nudge:now'),
  createBoard: (dir, name) => ipcRenderer.invoke('boards:create', dir, name),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  setChrome: (background, symbols) => ipcRenderer.send('theme:chrome', background, symbols),
  installedFonts: () => ipcRenderer.invoke('fonts:list'),
  icons: () => ipcRenderer.invoke('icons:get'),
  setIcon: (path, icon) => ipcRenderer.invoke('icons:set', path, icon),
  iconFromFile: (path) => ipcRenderer.invoke('icons:fromFile', path),
  iconFromUrl: (path, url) => ipcRenderer.invoke('icons:fromUrl', path, url),
  showEmojiPanel: () => ipcRenderer.send('icons:emojiPanel'),
  saveAttachment: (name, data) => ipcRenderer.invoke('attachments:save', name, data),
  pickAttachment: () => ipcRenderer.invoke('attachments:pick'),
  onIconsChanged: (cb) => {
    const h = () => cb()
    ipcRenderer.on('icons:changed', h)
    return () => ipcRenderer.removeListener('icons:changed', h)
  },
  openWindow: (views, atCursor) => ipcRenderer.invoke('window:open', views, atCursor),
  windowInfo: () => ipcRenderer.invoke('window:info'),
  claimOpen: (path) => ipcRenderer.invoke('window:claim', path),
  reportWindowState: (state) => ipcRenderer.send('window:state', state),
  showMain: () => ipcRenderer.send('window:showMain'),
  revealInMain: (path) => ipcRenderer.send('window:revealInMain', path),
  closeWindow: () => ipcRenderer.send('window:close'),
  onMoved: (cb) => {
    const h = (_e: IpcRendererEvent, from: string, to: string) => cb(from, to)
    ipcRenderer.on('vault:moved', h)
    return () => ipcRenderer.removeListener('vault:moved', h)
  },
  onRemoved: (cb) => {
    const h = (_e: IpcRendererEvent, path: string) => cb(path)
    ipcRenderer.on('vault:removed', h)
    return () => ipcRenderer.removeListener('vault:removed', h)
  },
  onFlushRequest: (cb) => {
    const h = async (_e: IpcRendererEvent, token: string) => {
      await cb().catch(() => undefined)
      ipcRenderer.send('editors:flushed', token)
    }
    ipcRenderer.on('editors:flush', h)
    return () => ipcRenderer.removeListener('editors:flush', h)
  },
  onPrefsChanged: (cb) => {
    const h = (_e: IpcRendererEvent, prefs: Prefs) => cb(prefs)
    ipcRenderer.on('prefs:changed', h)
    return () => ipcRenderer.removeListener('prefs:changed', h)
  },
  editAction: (action) => ipcRenderer.send('edit:action', action)
}

contextBridge.exposeInMainWorld('api', api)
