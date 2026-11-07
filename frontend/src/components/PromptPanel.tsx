import type { FormEvent, KeyboardEvent } from 'react'
import { ArrowUpRight, Braces, Command, FileCode2, LoaderCircle, Package, Play } from 'lucide-react'
import type { PlanMetadata } from '../types/engine'

interface PromptPanelProps {
  prompt: string
  onPromptChange: (value: string) => void
  onRun: () => void
  canRun: boolean
  isExecuting: boolean
  plan: PlanMetadata | null
}

export function PromptPanel({ prompt, onPromptChange, onRun, canRun, isExecuting, plan }: PromptPanelProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (canRun) onRun()
  }

  function handleShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (canRun) onRun()
    }
  }

  return (
    <section className="pane prompt-pane" aria-labelledby="prompt-title">
      <div className="pane-header">
        <Braces size={17} className="pane-icon" aria-hidden="true" />
        <h2 id="prompt-title">Task prompt</h2>
      </div>
      <form className="prompt-form" onSubmit={submit}>
        <label htmlFor="task-prompt" className="field-label">Instructions</label>
        <textarea
          id="task-prompt" value={prompt} onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={handleShortcut} disabled={isExecuting}
          placeholder="Describe the Python script to build and what it should print when it runs."
        />
        <button type="submit" className="run-button" disabled={!canRun}>
          {isExecuting ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          <span>{isExecuting ? 'Engine running…' : 'Run Autonomous Engine'}</span>
          {!isExecuting && <ArrowUpRight size={15} className="ml-auto opacity-60" aria-hidden="true" />}
        </button>
        <span className="prompt-hint"><Command size={13} aria-hidden="true" /> or Ctrl + Enter</span>
      </form>
      <div className="plan-section">
        <div className="flex items-center gap-2">
          <Package size={15} className="pane-icon" aria-hidden="true" />
          <h3>Execution plan</h3>
        </div>
        {plan ? (
          <dl className="plan-details">
            <dt className="field-label">Target file</dt>
            <dd className="plan-file"><FileCode2 size={15} aria-hidden="true" /><span>{plan.target_filename}</span></dd>
            <dt className="field-label">Dependencies</dt>
            <dd className="dependency-tags">
              {plan.dependencies.length ? plan.dependencies.map((dependency, index) => (
                <span key={`${dependency}-${index}`}>{dependency}</span>
              )) : <span>None</span>}
            </dd>
          </dl>
        ) : <p className="muted-copy">The target file and dependencies will appear when the engine creates a plan.</p>}
      </div>
    </section>
  )
}
