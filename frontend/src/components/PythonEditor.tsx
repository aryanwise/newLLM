import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
loader.config({ monaco })

const background = { 'editor.background': '#00000000', 'editorGutter.background': '#00000000' }
monaco.editor.defineTheme('workbench-light', { base: 'vs', inherit: true, rules: [], colors: background })
monaco.editor.defineTheme('workbench-dark', { base: 'vs-dark', inherit: true, rules: [], colors: background })

const options: monaco.editor.IStandaloneEditorConstructionOptions = {
  ariaLabel: 'Python source code',
  readOnly: true,
  domReadOnly: true,
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 13,
  lineHeight: 22,
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  padding: { top: 13, bottom: 13 },
  renderLineHighlight: 'none',
  overviewRulerLanes: 0,
}

export default function PythonEditor({ content, theme }: { content: string; theme: 'light' | 'dark' }) {
  return <Editor language="python" theme={`workbench-${theme}`} value={content} options={options} height="100%" />
}
