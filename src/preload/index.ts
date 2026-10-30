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
  reveal: (rel) => ipcRenderer.invoke('file:reveal', rel),
  recent: () => ipcRenderer.invoke('recent:get'),
  touchRecent: (rel) => ipcRenderer.invoke('recent:touch', rel),
  onChanged: (cb) => {
    const h = (_e: IpcRendererEvent, events: ChangeEvent[]) => cb(events)
    ipcRenderer.on('vault:changed', h)
    return () => ipcRenderer.removeListener('vault:changed', h)
  }
}

contextBridge.exposeInMainWorld('api', api)
