import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api, ChangeEvent } from '../shared/types'

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
  openPath: (path) => ipcRenderer.invoke('ext:open', path),
  revealPath: (path) => ipcRenderer.invoke('ext:reveal', path),
  openInCode: (path) => ipcRenderer.invoke('ext:code', path),
  pickPath: (kind) => ipcRenderer.invoke('ext:pick', kind),
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
  }
}

contextBridge.exposeInMainWorld('api', api)
