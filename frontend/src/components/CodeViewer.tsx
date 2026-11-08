import { lazy, Suspense } from 'react'
import { Check, ChevronDown, FileCode2, RefreshCw, Scissors } from 'lucide-react'
import type { CodeState, WorkspaceFile } from '../types/engine'
import './workspace-ui.css'

const PythonEditor = lazy(() => import('./PythonEditor'))

interface CodeViewerProps {
  filename: string
  files: WorkspaceFile[]
  content: string | null
  codeState: CodeState | null
  onFileChange: (filename: string) => void
  onRefreshFiles: () => void
  filesLoading: boolean
  fileLoading: boolean
  canBrowse: boolean
  error: string | null
  theme: 'light' | 'dark'
}

export function CodeViewer({
  filename, files, content, codeState, onFileChange, onRefreshFiles, filesLoading, fileLoading, canBrowse, error, theme,
}: CodeViewerProps) {
  const names = Array.from(new Set([...(filename ? [filename] : []), ...files.map((file) => file.filename)]))
  const lines = content === null || content === '' ? 0 : content.split('\n').length

  return (
    <section className="pane source-pane" aria-labelledby="code-title">
      <div className="source-bar">
        <div className="source-title">
          <FileCode2 size={16} aria-hidden="true" />
          <h2 id="code-title">Source</h2>
        </div>
        <div className="source-controls">
          <div className="source-file-picker">
            <select aria-label="Python file" value={filename} onChange={(event) => onFileChange(event.target.value)} disabled={!canBrowse || names.length === 0}>
              <option value="">{filesLoading ? 'Loading files…' : 'Choose a file'}</option>
              {names.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <ChevronDown size={13} aria-hidden="true" />
          </div>
          <button
            type="button" className="workspace-icon-button" onClick={onRefreshFiles} aria-label="Refresh workspace files" title="Refresh workspace files"
            disabled={!canBrowse || filesLoading}
          >
            <RefreshCw size={14} aria-hidden="true" className={filesLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      {codeState && (
        <div className="source-state" data-verified={codeState === 'Verified Passing'} aria-live="polite">
          {codeState === 'Verified Passing' ? <Check size={15} aria-hidden="true" /> :
            codeState === 'Surgically Repaired (AST Spliced)' ? <Scissors size={15} aria-hidden="true" /> : <FileCode2 size={15} aria-hidden="true" />}
          {codeState}
        </div>
      )}
      {error && <div className="source-error" role="alert">{error}</div>}
      <div className="source-body">
        {content !== null ? (
          <Suspense fallback={<div className="source-empty" role="status">Loading editor…</div>}>
            <PythonEditor content={content} theme={theme} />
          </Suspense>
        ) : (
          <div className="source-empty" role={fileLoading ? 'status' : undefined}>
            <span className="source-empty-mark"><FileCode2 size={23} strokeWidth={1.5} aria-hidden="true" /></span>
            <p>{fileLoading ? 'Reading file…' : 'No file open'}</p>
            {!fileLoading && <span>Select a workspace file or run the engine to see generated code.</span>}
          </div>
        )}
      </div>
      {content !== null && (
        <div className="source-footer">
          <span>Python</span>
          <span>{lines > 0 ? `${lines} ${lines === 1 ? 'line' : 'lines'} · ` : ''}UTF-8 · Read only</span>
        </div>
      )}
    </section>
  )
}
