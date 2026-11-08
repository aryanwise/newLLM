import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, CodeXml, Cpu, FolderOpen, Monitor, Moon, RefreshCw, Settings2, Sun, X } from 'lucide-react'
import type { ConnectionStatus, RunStatus, ThemePreference } from '../types/engine'
import { WorkspacePicker } from './WorkspacePicker'
import './workspace-ui.css'

interface WorkspaceBarProps {
  workspace: string
  onWorkspaceChange: (value: string) => void
  modelName: string
  onModelChange: (value: string) => void
  models: string[]
  modelsLoading: boolean
  modelError: string | null
  onRefreshModels: () => void
  providerUrl: string
  onSaveProvider: (url: string, modelName?: string) => Promise<void>
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
  isExecuting: boolean
  connectionStatus: ConnectionStatus
  runStatus: RunStatus
}

const appearances = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const

const connectionLabels: Record<ConnectionStatus, string> = {
  CONNECTED: 'Live',
  CONNECTING: 'Connecting',
  DISCONNECTED: 'Local',
}

type SettingsProps = Omit<WorkspaceBarProps, 'workspace' | 'onWorkspaceChange' | 'connectionStatus' | 'runStatus'> & {
  onClose: () => void
}

function WorkspaceSettings({
  modelName, onModelChange, models, modelsLoading, modelError, onRefreshModels,
  providerUrl, onSaveProvider, theme, onThemeChange, isExecuting, onClose,
}: SettingsProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const appearanceName = useId()
  const [urlOverride, setUrlOverride] = useState<string | null>(null)
  const [modelDraft, setModelDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [saved, setSaved] = useState(false)
  const urlDraft = urlOverride ?? providerUrl
  const selectedModel = modelDraft ?? modelName
  const modelOptions = Array.from(new Set([selectedModel, ...models]))
  const normalizedUrl = urlDraft.trim().replace(/\/+$/, '')
  const endpointChanged = normalizedUrl !== providerUrl.replace(/\/+$/, '')
  const changesPending = endpointChanged || selectedModel !== modelName

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

  async function saveModelSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!changesPending || saving || isExecuting) return
    setSaving(true)
    setSettingsError('')
    setSaved(false)
    try {
      await onSaveProvider(normalizedUrl, selectedModel)
      onModelChange(selectedModel)
      setUrlOverride(null)
      setModelDraft(null)
      setSaved(true)
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Could not save model settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog
      ref={dialog} className="workspace-settings" aria-labelledby={title}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="workspace-settings-content">
        <div className="workspace-settings-header">
          <div>
            <h2 id={title}>Settings</h2>
            <p>Customize the workbench and choose your local model.</p>
          </div>
          <button type="button" className="workspace-icon-button" onClick={onClose} aria-label="Close settings">
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <fieldset className="workspace-appearance">
          <legend>Appearance</legend>
          <div className="workspace-appearance-options">
            {appearances.map(({ value, label, icon: Icon }) => (
              <label key={value}>
                <input
                  className="sr-only" type="radio" name={appearanceName} value={value}
                  checked={theme === value} onChange={() => onThemeChange(value)}
                />
                <span><Icon size={15} aria-hidden="true" /> {label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <form className="workspace-settings-model" onSubmit={saveModelSettings}>
          <h3>Model provider</h3>
          <div className="workspace-provider-form">
            <label htmlFor="provider-url">Provider API URL</label>
            <input
              id="provider-url" type="url" value={urlDraft} required spellCheck={false}
              onChange={(event) => {
                setUrlOverride(event.target.value)
                setSettingsError('')
                setSaved(false)
              }}
              placeholder="http://localhost:11434/v1" disabled={saving || isExecuting}
              aria-describedby="provider-hint"
            />
            <p id="provider-hint">Use an OpenAI-compatible base URL for Ollama or LM Studio.</p>
          </div>
          <div className="workspace-provider-form">
            <label htmlFor="engine-model">Model</label>
            <div className="workspace-settings-field">
              <div className="workspace-model-select">
                <select
                  id="engine-model" value={selectedModel}
                  onChange={(event) => { setModelDraft(event.target.value); setSaved(false); setSettingsError('') }}
                  disabled={isExecuting || modelsLoading || endpointChanged || saving} aria-describedby={modelError ? 'settings-model-error' : undefined}
                >
                  {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </div>
              <button
                type="button" className="workspace-icon-button" onClick={onRefreshModels}
                title="Refresh models" aria-label="Refresh models" disabled={modelsLoading || isExecuting || endpointChanged || saving}
              >
                <RefreshCw size={15} aria-hidden="true" className={modelsLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            {modelError && <p id="settings-model-error" className="workspace-settings-error" role="status">{modelError}</p>}
          </div>
          {settingsError && <p className="workspace-settings-error" role="alert">{settingsError}</p>}
          {saved && <p className="workspace-settings-feedback" role="status">Model settings saved.</p>}
          <div className="workspace-settings-footer">
            <button type="button" className="workspace-button" onClick={onClose}>Done</button>
            {changesPending && (
              <button type="submit" className="workspace-button workspace-button-emphasized" disabled={saving || isExecuting}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            )}
          </div>
        </form>
      </div>
    </dialog>
  )
}

export function WorkspaceBar({ workspace, onWorkspaceChange, connectionStatus, runStatus, ...settings }: WorkspaceBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <header className="workspace-header">
      <div className="workspace-brand">
        <span className="workspace-brand-mark"><CodeXml size={20} strokeWidth={1.85} aria-hidden="true" /></span>
        <h1>Code Engine</h1>
      </div>
      <div className="workspace-location">
        <label className="sr-only" htmlFor="workspace-directory">Workspace directory</label>
        <div className="workspace-location-field">
          <FolderOpen size={16} aria-hidden="true" />
          <input
            id="workspace-directory" value={workspace} autoComplete="off" spellCheck={false}
            onChange={(event) => onWorkspaceChange(event.target.value)}
            placeholder="Choose a workspace" disabled={settings.isExecuting}
          />
        </div>
        <button
          type="button" className="workspace-button workspace-browse-button" aria-haspopup="dialog"
          disabled={settings.isExecuting} onClick={() => setPickerOpen(true)}
        >
          Browse
        </button>
      </div>
      <div className="workspace-header-actions">
        <span className="workspace-connection" data-state={connectionStatus} title={connectionLabels[connectionStatus]} role="status">
          <span aria-hidden="true" />
          <span className="workspace-connection-label">{connectionLabels[connectionStatus]}</span>
        </span>
        <span className="workspace-run" data-state={runStatus} aria-label={`Run status: ${runStatus.toLowerCase()}`} role="status">{runStatus}</span>
        <button
          type="button" className="workspace-model-trigger" aria-haspopup="dialog" aria-label={`Model settings: ${settings.modelName}`}
          title={settings.modelName} onClick={() => setSettingsOpen(true)}
        >
          <Cpu size={15} aria-hidden="true" /><span>{settings.modelName}</span>
        </button>
        <button
          type="button" className="workspace-button workspace-settings-trigger" aria-label="Settings" aria-haspopup="dialog"
          title={settings.modelError ? 'Settings · Model provider unavailable' : 'Settings'} onClick={() => setSettingsOpen(true)}
        >
          <Settings2 size={16} aria-hidden="true" /> <span>Settings</span>
          {settings.modelError && <span className="workspace-settings-warning" aria-hidden="true" />}
        </button>
      </div>
      {pickerOpen && (
        <WorkspacePicker
          startPath={workspace.trim()} onClose={() => setPickerOpen(false)}
          onSelect={(path) => { onWorkspaceChange(path); setPickerOpen(false) }}
        />
      )}
      {settingsOpen && <WorkspaceSettings {...settings} onClose={() => setSettingsOpen(false)} />}
    </header>
  )
}
