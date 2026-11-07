import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
loader.config({ monaco })

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

export default function PythonEditor({ content }: { content: string }) {
  return <Editor language="python" theme="vs-dark" value={content} options={options} height="100%" />
}
