import { useEffect, useId, useRef, useState } from 'react'
import { ArrowUp, ChevronRight, Folder, FolderOpen, House } from 'lucide-react'
import { listWorkspaceDirectories } from '../api'

interface WorkspacePickerProps {
  startPath: string
  onSelect: (path: string) => void
  onClose: () => void
}

type DirectoryListing = Awaited<ReturnType<typeof listWorkspaceDirectories>>
type BrowseRequest = { path?: string }
type BrowseResult = { request: BrowseRequest; listing?: DirectoryListing; error?: string }

export function WorkspacePicker({ startPath, onSelect, onClose }: WorkspacePickerProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const [request, setRequest] = useState<BrowseRequest>(() => ({ path: startPath.trim() || undefined }))
  const [result, setResult] = useState<BrowseResult>()
  const current = result?.request === request ? result : undefined
  const listing = current?.listing
  const error = current?.error

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    const previousFocus = document.activeElement
    element.showModal()
    return () => {
      element.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    listWorkspaceDirectories(request.path, controller.signal).then((directory) => {
      if (!controller.signal.aborted) setResult({ request, listing: directory })
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) {
        const message = failure instanceof Error ? failure.message : ''
        setResult({ request, error: message || 'Could not load this folder.' })
      }
    })
    return () => controller.abort()
  }, [request])

  function browse(path?: string) {
    setRequest({ path })
  }

  return (
    <dialog
      ref={dialog} className="workspace-picker" aria-labelledby={title}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="pane-header">
        <FolderOpen size={17} className="pane-icon" aria-hidden="true" />
        <h2 id={title}>Choose a workspace folder</h2>
      </div>
      <div className="workspace-picker-body">
        <div className="workspace-picker-location">
          <button type="button" className="secondary-button" onClick={() => browse()}>
            <House size={15} aria-hidden="true" /> Home
          </button>
          <button
            type="button" className="secondary-button" disabled={!listing?.parent}
            onClick={() => { if (listing?.parent) browse(listing.parent) }}
          >
            <ArrowUp size={15} aria-hidden="true" /> Up
          </button>
          <code className="workspace-picker-path" aria-live="polite">{listing?.path ?? request.path ?? 'Home'}</code>
        </div>
        <div className="workspace-picker-list">
          {error ? <p className="inline-error" role="alert">{error}</p> : !listing ? (
            <p className="workspace-picker-message" role="status">Loading folders…</p>
          ) : listing.directories.length ? (
            <ul aria-label="Subfolders">
              {listing.directories.map(({ name, path }) => (
                <li key={name}>
                  <button type="button" className="workspace-picker-folder" onClick={() => browse(path)}>
                    <Folder size={16} aria-hidden="true" /> <span>{name}</span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="workspace-picker-message">This folder has no subfolders.</p>}
        </div>
      </div>
      <div className="workspace-picker-actions">
        <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
        <button
          type="button" className="secondary-button save-button" disabled={!listing}
          onClick={() => { if (listing) onSelect(listing.path) }}
        >
          Choose this folder
        </button>
      </div>
    </dialog>
  )
}
