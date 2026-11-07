import { lazy, Suspense } from 'react'
import { Braces, Check, ChevronDown, FileCode2, RefreshCw, Scissors } from 'lucide-react'
import type { CodeState, WorkspaceFile } from '../types/engine'

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
}

const codeTone: Record<CodeState, string> = {
  'Turn 1 Draft': 'tone-amber',
  'Surgically Repaired (AST Spliced)': 'tone-cyan',
  'Verified Passing': 'tone-green',
  'Full-file Repair': 'tone-purple',
}

export function CodeViewer({
  filename, files, content, codeState, onFileChange, onRefreshFiles, filesLoading, fileLoading, canBrowse, error,
}: CodeViewerProps) {
  const names = Array.from(new Set([...(filename ? [filename] : []), ...files.map((file) => file.filename)]))
  const lines = content === null || content === '' ? 0 : content.split('\n').length

  return (
    <section className="pane editor-pane" aria-labelledby="code-title">
      <div className="pane-header editor-header">
        <FileCode2 size={17} className="pane-icon" aria-hidden="true" />
        <h2 id="code-title">Source code</h2>
        <div className="editor-file-controls">
          <div className="file-picker">
            <select aria-label="Python file" value={filename} onChange={(event) => onFileChange(event.target.value)} disabled={!canBrowse || names.length === 0}>
              <option value="">{filesLoading ? 'Loading files…' : 'Choose a Python file'}</option>
              {names.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <ChevronDown size={13} aria-hidden="true" />
          </div>
          <button
            type="button" className="icon-button" onClick={onRefreshFiles} aria-label="Refresh workspace files" title="Refresh workspace files"
            disabled={!canBrowse || filesLoading}
          >
            <RefreshCw size={14} aria-hidden="true" className={filesLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      {codeState && (
        <div className={`code-banner ${codeTone[codeState]}`} aria-live="polite">
          {codeState === 'Verified Passing' ? <Check size={15} aria-hidden="true" /> :
            codeState === 'Surgically Repaired (AST Spliced)' ? <Scissors size={15} aria-hidden="true" /> : <FileCode2 size={15} aria-hidden="true" />}
          {codeState}
        </div>
      )}
      {error && <div className="pane-error" role="alert">{error}</div>}
      <div className="editor-body">
        {content !== null ? (
          <Suspense fallback={<div className="editor-loading">Loading editor…</div>}>
            <PythonEditor content={content} />
          </Suspense>
        ) : (
          <div className="editor-empty">
            <span className="editor-empty-icon"><Braces size={27} strokeWidth={1.5} aria-hidden="true" /></span>
            <p>{fileLoading ? 'Reading file…' : 'No file open'}</p>
            {!fileLoading && <span>Choose a Python file or run the engine to see generated code.</span>}
          </div>
        )}
      </div>
      <div className="editor-footer">
        <span><span className="language-dot" /> Python</span>
        <span>{lines > 0 ? `${lines} ${lines === 1 ? 'line' : 'lines'} · ` : ''}UTF-8 · Read only</span>
      </div>
    </section>
  )
}
