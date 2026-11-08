import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp, ArrowUpRight, Check, CircleAlert, CodeXml, FileCode2, LoaderCircle } from 'lucide-react'
import type { PlanMetadata, PromptMessage } from '../types/engine'
import './conversation-ui.css'

interface PromptPanelProps {
  prompt: string
  onPromptChange: (value: string) => void
  onRun: () => void
  canRun: boolean
  isExecuting: boolean
  plan: PlanMetadata | null
  messages: PromptMessage[]
  disabledReason?: string
  onOpenFile?: (filename: string) => void
}

const statusLabels = {
  running: 'Working on it',
  success: 'Verified and ready',
  failure: 'Run failed',
}

const statusIcons = { running: LoaderCircle, success: Check, failure: CircleAlert }

function PromptFile({ filename, onOpenFile }: { filename: string; onOpenFile?: (filename: string) => void }) {
  const label = <><FileCode2 size={14} aria-hidden="true" /><code>{filename}</code></>
  return onOpenFile ? (
    <button type="button" className="conversation-file" onClick={() => onOpenFile(filename)} aria-label={`Open ${filename}`}>
      {label}<ArrowUpRight size={13} aria-hidden="true" />
    </button>
  ) : <span className="conversation-file">{label}</span>
}

function PromptTurn({ message, plan, onOpenFile }: {
  message: PromptMessage
  plan: PlanMetadata | null
  onOpenFile?: (filename: string) => void
}) {
  const StatusIcon = statusIcons[message.status]
  const openVerifiedFile = message.status === 'success' ? onOpenFile : undefined

  return (
    <li className="conversation-turn">
      <div className="conversation-request">
        <span className="conversation-speaker">You</span>
        <p>{message.prompt}</p>
      </div>
      <div className="conversation-response">
        <span className="conversation-engine-mark" aria-hidden="true"><CodeXml size={17} /></span>
        <div className="conversation-response-content">
          <span className="conversation-speaker">Code Engine</span>
          <p className="conversation-status" data-status={message.status}>
            <StatusIcon size={15} className={message.status === 'running' ? 'animate-spin' : undefined} aria-hidden="true" />
            {statusLabels[message.status]}
          </p>
          {message.error && <p className="conversation-response-error">{message.error}</p>}
          {plan ? (
            <dl className="conversation-plan" aria-label="Execution plan">
              <dt>Target file</dt>
              <dd><PromptFile filename={plan.target_filename} onOpenFile={openVerifiedFile} /></dd>
              <dt>Dependencies</dt>
              <dd>{plan.dependencies.length ? plan.dependencies.map((dependency, index) => (
                <code key={`${dependency}-${index}`}>{dependency}</code>
              )) : <span>None</span>}</dd>
            </dl>
          ) : message.filename && (
            <p className="conversation-target"><PromptFile filename={message.filename} onOpenFile={openVerifiedFile} /></p>
          )}
        </div>
      </div>
    </li>
  )
}

export function PromptPanel({
  prompt, onPromptChange, onRun, canRun, isExecuting, plan, messages, disabledReason, onOpenFile,
}: PromptPanelProps) {
  const history = useRef<HTMLDivElement>(null)
  const latestMessage = messages.at(-1)

  useEffect(() => {
    const panel = history.current
    if (panel) panel.scrollTop = panel.scrollHeight
  }, [latestMessage, plan])

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
    <section className="conversation-panel" aria-label="Task conversation">
      <div className="conversation-history" ref={history}>
        {messages.length ? (
          <ol className="conversation-thread" aria-label="Prompt history" aria-live="polite">
            {messages.map((message, index) => (
              <PromptTurn
                key={message.id} message={message} onOpenFile={onOpenFile}
                plan={index === messages.length - 1 ? plan : null}
              />
            ))}
          </ol>
        ) : (
          <div className="conversation-empty">
            <span className="conversation-engine-mark" aria-hidden="true"><CodeXml size={23} /></span>
            <h2>What would you like to build?</h2>
            <p>Describe a Python task. Code Engine will write and verify it in your workspace.</p>
          </div>
        )}
      </div>
      <form className="conversation-composer" onSubmit={submit}>
        <label htmlFor="task-prompt" className="sr-only">Instructions</label>
        <textarea
          id="task-prompt" value={prompt} onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={handleShortcut} disabled={isExecuting} aria-describedby="prompt-composer-hint"
          placeholder="Describe what you want to build…"
        />
        <div className="conversation-composer-footer">
          <p id="prompt-composer-hint" className="conversation-hint">
            {disabledReason && !canRun && !isExecuting ? disabledReason : <><kbd>⌘</kbd> or <kbd>Ctrl</kbd> + <kbd>Enter</kbd></>}
          </p>
          <button type="submit" className="conversation-run" disabled={!canRun} aria-label={isExecuting ? 'Running' : 'Run Autonomous Engine'}>
            {isExecuting ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <ArrowUp size={17} aria-hidden="true" />}
            {isExecuting ? 'Running…' : 'Run'}
          </button>
        </div>
      </form>
    </section>
  )
}
