import { useState, type FormEvent } from 'react'
import { ChevronDown, CodeXml, Cpu, FolderOpen, FolderSearch, RefreshCw, Settings2 } from 'lucide-react'
import { twMerge } from 'tailwind-merge'
import type { ConnectionStatus, RunStatus } from '../types/engine'
import { WorkspacePicker } from './WorkspacePicker'

interface WorkspaceBarProps {
  workspace: string
  onWorkspaceChange: (value: string) => void
  modelName: string
  onModelChange: (value: string) => void
  models: string[]
  modelsLoading: boolean
  onRefreshModels: () => void
  providerUrl: string
  onSaveProvider: (url: string) => Promise<void>
  isExecuting: boolean
  connectionStatus: ConnectionStatus
  runStatus: RunStatus
}

const statusTone: Record<RunStatus, string> = {
  IDLE: 'tone-neutral',
  PLANNING: 'tone-blue',
  PROVISIONING: 'tone-purple',
  GENERATING: 'tone-blue',
  HEALING: 'tone-cyan',
  SUCCESS: 'tone-green',
  FAILURE: 'tone-red',
}

export function WorkspaceBar({
  workspace, onWorkspaceChange, modelName, onModelChange, models, modelsLoading,
  onRefreshModels, providerUrl, onSaveProvider, isExecuting, connectionStatus, runStatus,
}: WorkspaceBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [urlDraft, setUrlDraft] = useState(providerUrl)
  const [saving, setSaving] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const modelOptions = Array.from(new Set([modelName, ...models]))

  async function saveProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setSettingsError('')
    try {
      await onSaveProvider(urlDraft.trim())
      setSettingsOpen(false)
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Could not save the provider URL.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <header className="app-header">
      <div className="header-main">
        <div className="brand">
          <span className="brand-mark"><CodeXml size={22} strokeWidth={1.8} aria-hidden="true" /></span>
          <div>
            <h1>Code Engine</h1>
            <span className="brand-subtitle">Local development workbench</span>
          </div>
        </div>
        <div className="header-actions">
          <span className="connection-pill" aria-live="polite">
            <span className={twMerge('status-dot', connectionStatus === 'CONNECTED' ? 'dot-green' : connectionStatus === 'CONNECTING' ? 'dot-amber' : '')} />
            {connectionStatus}
          </span>
          <div className="provider-settings">
            <button
              type="button" className="secondary-button" disabled={isExecuting}
              aria-expanded={settingsOpen} aria-controls="provider-settings"
              onClick={() => {
                setUrlDraft(providerUrl)
                setSettingsError('')
                setSettingsOpen(!settingsOpen)
              }}
            >
              <Settings2 size={15} aria-hidden="true" /> Provider
            </button>
            {settingsOpen && (
              <form id="provider-settings" className="provider-form" onSubmit={saveProvider}>
                <label className="field-label" htmlFor="provider-url">Provider API URL</label>
                <input
                  id="provider-url" type="url" value={urlDraft} required
                  onChange={(event) => setUrlDraft(event.target.value)}
                  placeholder="http://localhost:11434/v1" disabled={saving || isExecuting}
                  className="text-field font-mono"
                />
                <p>Use the OpenAI-compatible base URL for Ollama or LM Studio.</p>
                {settingsError && <div className="inline-error" role="alert">{settingsError}</div>}
                <div className="flex justify-end gap-2">
                  <button className="secondary-button" type="button" onClick={() => setSettingsOpen(false)}>Cancel</button>
                  <button className="secondary-button save-button" type="submit" disabled={saving || isExecuting}>
                    {saving ? 'Saving…' : 'Save provider'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
      <div className="workspace-toolbar">
        <div className="workspace-field">
          <label className="field-label" htmlFor="workspace-directory">Workspace directory</label>
          <div className="flex gap-2">
            <div className="field-with-icon">
              <FolderOpen size={17} aria-hidden="true" />
              <input
                id="workspace-directory" value={workspace} autoComplete="off" spellCheck={false}
                onChange={(event) => onWorkspaceChange(event.target.value)}
                placeholder="/path/to/your/workspace" disabled={isExecuting}
              />
            </div>
            <button
              type="button" className="secondary-button shrink-0" aria-haspopup="dialog"
              disabled={isExecuting} onClick={() => setPickerOpen(true)}
            >
              <FolderSearch size={16} aria-hidden="true" /> Browse
            </button>
          </div>
          {pickerOpen && (
            <WorkspacePicker
              startPath={workspace.trim()}
              onClose={() => setPickerOpen(false)}
              onSelect={(path) => {
                onWorkspaceChange(path)
                setPickerOpen(false)
              }}
            />
          )}
        </div>
        <div className="model-field">
          <label className="field-label" htmlFor="engine-model">Model</label>
          <div className="model-control">
            <div className="field-with-icon">
              <Cpu size={16} aria-hidden="true" />
              <select id="engine-model" value={modelName} onChange={(event) => onModelChange(event.target.value)} disabled={isExecuting}>
                {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
              <ChevronDown size={14} className="select-chevron" aria-hidden="true" />
            </div>
            <button
              type="button" className="icon-button refresh-button" onClick={onRefreshModels}
              title="Refresh models" aria-label="Refresh models" disabled={modelsLoading || isExecuting}
            >
              <RefreshCw size={15} aria-hidden="true" className={modelsLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <div className="run-field">
          <span className="field-label">Run status</span>
          <span className={twMerge('run-pill', statusTone[runStatus])} aria-live="polite">
            <span className="run-dot" /> {runStatus}
          </span>
        </div>
      </div>
    </header>
  )
}
