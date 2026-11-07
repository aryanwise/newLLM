import { useEffect, useState } from 'react'
import { CircleAlert, Monitor } from 'lucide-react'
import { getModels, getSettings, listWorkspaceFiles, readWorkspaceFile, saveSettings } from './api'
import { CodeViewer } from './components/CodeViewer'
import { PromptPanel } from './components/PromptPanel'
import { TerminalConsole } from './components/TerminalConsole'
import { WorkspaceBar } from './components/WorkspaceBar'
import { useEngineSocket } from './hooks/useEngineSocket'
import type { WorkspaceFile } from './types/engine'

const defaultModel = 'qwen2.5-coder:7b'
const defaultProvider = 'http://localhost:11434/v1'

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export default function App() {
  const socket = useEngineSocket()
  const { isExecuting } = socket
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

  async function saveProvider(baseUrl: string) {
    const saved = await saveSettings({ base_url: baseUrl, model_name: modelName, workspace_path: workspacePath })
    setProviderUrl(saved.base_url)
    setModelRevision((value) => value + 1)
  }

  function execute() {
    setSelectedFile('')
    setShowGenerated(true)
    setRunWorkspace(workspacePath)
    socket.execute({ prompt: prompt.trim(), workspace_path: workspacePath, model_name: modelName })
  }

  const canRun = Boolean(prompt.trim() && workspacePath && modelName) && !isExecuting
  const filename = showGenerated ? socket.plan?.target_filename ?? '' : selectedFile

  return (
    <div className="workbench">
      <WorkspaceBar
        workspace={workspace} onWorkspaceChange={changeWorkspace} modelName={modelName} onModelChange={setModelPreference}
        models={models} modelsLoading={modelsLoading} onRefreshModels={() => setModelRevision((value) => value + 1)}
        providerUrl={providerUrl} onSaveProvider={saveProvider} isExecuting={isExecuting}
        connectionStatus={socket.connectionStatus} runStatus={socket.runStatus}
      />
      {modelError && <div className="provider-warning" role="status"><CircleAlert size={16} aria-hidden="true" />{modelError}</div>}
      <main className="workspace-layout" aria-label="Execution workbench">
        <PromptPanel
          prompt={prompt} onPromptChange={setPrompt} onRun={execute} canRun={canRun} isExecuting={isExecuting}
          plan={workspacePath === runWorkspace ? socket.plan : null}
        />
        <div className="output-layout">
          <CodeViewer
            filename={filename} files={files} content={showGenerated ? socket.fileContent : fileContent}
            codeState={showGenerated ? socket.codeState : null} onFileChange={selectFile}
            onRefreshFiles={() => setFileRevision((value) => value + 1)} filesLoading={filesLoading}
            fileLoading={!showGenerated && fileLoading} canBrowse={Boolean(workspacePath) && !isExecuting}
            error={workspaceError ?? fileError}
          />
          <TerminalConsole logs={socket.logs} onClear={socket.clearLogs} isExecuting={isExecuting} />
        </div>
      </main>
      <footer className="workbench-footer"><Monitor size={13} aria-hidden="true" /> Local workspace <span>{providerUrl}</span></footer>
    </div>
  )
}
