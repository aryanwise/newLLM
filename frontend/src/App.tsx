import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getModels, getSettings, listWorkspaceFiles, readWorkspaceFile, saveSettings } from './api'
import { CodeViewer } from './components/CodeViewer'
import { PromptPanel } from './components/PromptPanel'
import { TerminalConsole } from './components/TerminalConsole'
import { WorkspaceBar } from './components/WorkspaceBar'
import { useEngineSocket } from './hooks/useEngineSocket'
import type { PromptMessage, ThemePreference, WorkspaceFile } from './types/engine'

const defaultModel = 'qwen2.5-coder:7b'
const defaultProvider = 'http://localhost:11434/v1'
const themeKey = 'code-engine-theme'
const darkScheme = '(prefers-color-scheme: dark)'

function readTheme(): ThemePreference {
  try {
    const saved = localStorage.getItem(themeKey)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* Appearance still works for the current session. */ }
  return 'system'
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export default function App() {
  const socket = useEngineSocket()
  const { isExecuting, runStatus } = socket
  const [theme, setTheme] = useState<ThemePreference>(readTheme)
  const [systemDark, setSystemDark] = useState(() => matchMedia(darkScheme).matches)
  const appearance = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
  const [logOpen, setLogOpen] = useState(false)
  const [messages, setMessages] = useState<(PromptMessage & { workspace: string })[]>([])
  const [activeMessage, setActiveMessage] = useState<string | null>(null)
  const messageSequence = useRef(0)
  const [workspace, setWorkspace] = useState('')
  const [modelPreference, setModelPreference] = useState(defaultModel)
  const [providerUrl, setProviderUrl] = useState(defaultProvider)
  const [prompt, setPrompt] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [modelError, setModelError] = useState<string | null>(null)
  const [modelRevision, setModelRevision] = useState(0)
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [fileRevision, setFileRevision] = useState(0)
  const [selectedFile, setSelectedFile] = useState('')
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [showGenerated, setShowGenerated] = useState(false)
  const [runWorkspace, setRunWorkspace] = useState('')
  const workspacePath = workspace.trim()
  const modelName = models.length && !models.includes(modelPreference) ? models[0] : modelPreference

  useEffect(() => {
    const preference = matchMedia(darkScheme)
    const update = () => setSystemDark(preference.matches)
    update()
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = appearance
    const themeColor = getComputedStyle(root).getPropertyValue('--page').trim()
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor)
  }, [appearance])

  function changeTheme(value: ThemePreference) {
    setTheme(value)
    try {
      localStorage.setItem(themeKey, value)
    } catch { /* Appearance still works for the current session. */ }
  }

  useEffect(() => {
    if (!activeMessage || (runStatus !== 'SUCCESS' && runStatus !== 'FAILURE')) return
    setMessages((previous) => previous.map((message) => message.id === activeMessage ? {
      ...message,
      status: runStatus === 'SUCCESS' ? 'success' : 'failure',
      filename: socket.fileContent !== null ? socket.plan?.target_filename : undefined,
      error: socket.error ?? undefined,
    } : message))
    setActiveMessage(null)
  }, [activeMessage, runStatus, socket.error, socket.fileContent, socket.plan?.target_filename])

  useEffect(() => {
    const controller = new AbortController()
    getSettings(controller.signal).then((settings) => {
      if (controller.signal.aborted) return
      setProviderUrl(settings.base_url)
      setWorkspace((current) => current || settings.workspace_path)
      setModelPreference((current) => current === defaultModel ? settings.model_name || defaultModel : current)
    }).catch(() => { /* Model discovery surfaces connectivity errors. */ })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setModelsLoading(true)
    setModelError(null)
    getModels(controller.signal).then((available) => {
      if (!controller.signal.aborted) setModels(available)
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setModels([])
        setModelError(errorMessage(error, 'Could not load models.'))
      }
    }).finally(() => {
      if (!controller.signal.aborted) setModelsLoading(false)
    })
    return () => controller.abort()
  }, [modelRevision])

  useEffect(() => {
    if (isExecuting) return
    if (!workspacePath) {
      setFiles([])
      setWorkspaceError(null)
      setFilesLoading(false)
      return
    }

    const controller = new AbortController()
    setFilesLoading(true)
    setWorkspaceError(null)
    const timer = window.setTimeout(() => {
      listWorkspaceFiles(workspacePath, controller.signal).then((available) => {
        if (!controller.signal.aborted) setFiles(available)
      }).catch((error) => {
        if (!controller.signal.aborted) {
          setFiles([])
          setWorkspaceError(errorMessage(error, 'Could not open this workspace.'))
        }
      }).finally(() => {
        if (!controller.signal.aborted) setFilesLoading(false)
      })
    }, 220)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [workspacePath, fileRevision, isExecuting])

  useEffect(() => {
    setFileContent(null)
    setFileError(null)
    setFileLoading(false)
    if (!workspacePath || !selectedFile) return

    const controller = new AbortController()
    setFileLoading(true)
    readWorkspaceFile(workspacePath, selectedFile, controller.signal).then((file) => {
      if (controller.signal.aborted) return
      if (!file.exists) throw new Error('This file no longer exists in the workspace.')
      setFileContent(file.content)
    }).catch((error) => {
      if (!controller.signal.aborted) setFileError(errorMessage(error, 'Could not read the source file.'))
    }).finally(() => {
      if (!controller.signal.aborted) setFileLoading(false)
    })
    return () => controller.abort()
  }, [workspacePath, selectedFile, fileRevision])

  function changeWorkspace(value: string) {
    setWorkspace(value)
    if (value.trim() === workspacePath) return
    setFiles([])
    setSelectedFile('')
    setShowGenerated(false)
  }

  function selectFile(filename: string) {
    setSelectedFile(filename)
    setShowGenerated(false)
  }

  async function saveProvider(baseUrl: string, nextModelName = modelName) {
    const saved = await saveSettings({ base_url: baseUrl, model_name: nextModelName, workspace_path: workspacePath })
    setProviderUrl(saved.base_url)
    setModelPreference(saved.model_name)
    setModelRevision((value) => value + 1)
  }

  const canRun = Boolean(prompt.trim() && workspacePath && modelName) && !isExecuting && !workspaceError

  function execute() {
    if (!canRun) return
    const text = prompt.trim()
    const accepted = socket.execute(
      { prompt: text, workspace_path: workspacePath, model_name: modelName },
      files.map((file) => file.filename),
    )
    if (!accepted) return
    const id = String(++messageSequence.current)
    setMessages((previous) => [...previous, { id, prompt: text, workspace: workspacePath, status: 'running' }])
    setActiveMessage(id)
    setPrompt('')
    setSelectedFile('')
    setShowGenerated(true)
    setRunWorkspace(workspacePath)
  }

  const filename = showGenerated ? socket.plan?.target_filename ?? '' : selectedFile

  return (
    <div className="workbench">
      <WorkspaceBar
        workspace={workspace} onWorkspaceChange={changeWorkspace} modelName={modelName} onModelChange={setModelPreference}
        models={models} modelsLoading={modelsLoading} onRefreshModels={() => setModelRevision((value) => value + 1)}
        providerUrl={providerUrl} onSaveProvider={saveProvider} isExecuting={isExecuting}
        connectionStatus={socket.connectionStatus} runStatus={runStatus}
        theme={theme} onThemeChange={changeTheme} modelError={modelError}
      />
      <main className="workspace-layout" aria-label="Execution workbench">
        <PromptPanel
          prompt={prompt} onPromptChange={setPrompt} onRun={execute} canRun={canRun} isExecuting={isExecuting}
          plan={workspacePath === runWorkspace ? socket.plan : null}
          messages={messages.filter((message) => message.workspace === workspacePath)}
          disabledReason={!workspacePath ? 'Choose a workspace folder to begin.' : workspaceError ?? undefined}
          onOpenFile={selectFile}
        />
        <CodeViewer
          filename={filename} files={files} content={showGenerated ? socket.fileContent : fileContent}
          codeState={showGenerated ? socket.codeState : null} onFileChange={selectFile}
          onRefreshFiles={() => setFileRevision((value) => value + 1)} filesLoading={filesLoading}
          fileLoading={showGenerated ? isExecuting && socket.fileContent === null : fileLoading}
          canBrowse={Boolean(workspacePath) && !isExecuting} error={workspaceError ?? fileError} theme={appearance}
        />
      </main>
      <TerminalConsole
        logs={socket.logs} onClear={socket.clearLogs} isExecuting={isExecuting}
        open={logOpen} onToggle={() => setLogOpen((open) => !open)}
      />
    </div>
  )
}
