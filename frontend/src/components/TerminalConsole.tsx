import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, Terminal, Trash2 } from 'lucide-react'
import type { EngineStage, WebSocketEvent } from '../types/engine'
import './conversation-ui.css'

interface TerminalConsoleProps {
  logs: WebSocketEvent[]
  onClear: () => void
  isExecuting: boolean
  open: boolean
  onToggle: () => void
}

const stageStyle: Record<EngineStage, [label: string, tone: string]> = {
  PLANNING: ['PLAN', 'blue'],
  PROVISIONING: ['SANDBOX', 'purple'],
  GENERATING_TURN_1: ['DRAFT', 'neutral'],
  VERIFYING: ['VERIFY', 'amber'],
  INTROSPECTING: ['INSPECT', 'orange'],
  SPLICING: ['SPLICE', 'cyan'],
  VERIFYING_TURN_2: ['VERIFY 02', 'amber'],
  GENERATING_FALLBACK: ['REWRITE', 'purple'],
  VERIFYING_FALLBACK: ['VERIFY 03', 'amber'],
  SUCCESS: ['PASSED', 'green'],
  FAILURE: ['FAILED', 'red'],
}

function EventDetails({ event }: { event: WebSocketEvent }) {
  const data = event.payload
  if (!data) return null
  const line = data.line_number ?? (data.start_point && data.start_point[0] + 1)

  return (
    <div className="activity-details">
      {event.stage === 'INTROSPECTING' && data.traceback && (
        <details><summary>Runtime traceback</summary><pre>{data.traceback.trimEnd()}</pre></details>
      )}
      {event.stage === 'INTROSPECTING' && data.symbols?.map((symbol) => (
        <details key={`${symbol.package}.${symbol.symbol}`}>
          <summary>{symbol.package}.{symbol.symbol}</summary>
          {symbol.signature && <pre>{symbol.symbol}{symbol.signature}</pre>}
          {symbol.doc && <pre>{symbol.doc}</pre>}
          {symbol.example && <pre>{symbol.example}</pre>}
        </details>
      ))}
      {event.stage === 'SPLICING' && typeof data.start_byte === 'number' && typeof data.end_byte === 'number' && (
        <div className="activity-splice">
          <span>{data.node_type || 'AST node'}</span>
          {line && <span>Line {line}</span>}
          <span>Bytes {data.start_byte}–{data.end_byte}</span>
        </div>
      )}
      {(event.stage === 'SUCCESS' || event.stage === 'FAILURE') && data.stdout?.trim() && (
        <pre className="activity-result"><span>stdout</span>{data.stdout.trimEnd()}</pre>
      )}
      {event.stage === 'FAILURE' && (data.stderr || data.traceback) && (
        <pre className="activity-result" data-error="true"><span>stderr</span>{(data.stderr || data.traceback)?.trimEnd()}</pre>
      )}
      {event.stage === 'GENERATING_FALLBACK' && data.repair_error && (
        <details><summary>Surgical repair error</summary><pre>{data.repair_error}</pre></details>
      )}
    </div>
  )
}

export function TerminalConsole({ logs, onClear, isExecuting, open, onToggle }: TerminalConsoleProps) {
  const output = useRef<HTMLDivElement>(null)
  const streamId = useId()
  const titleId = useId()
  const [copy, setCopy] = useState<{ logs: WebSocketEvent[]; status: 'copied' | 'failed' } | null>(null)
  const copyStatus = copy?.logs === logs ? copy.status : null
  const latestStage = logs.at(-1)?.stage
  const activityStatus = isExecuting ? 'Running' : latestStage === 'SUCCESS' ? 'Passed' : latestStage === 'FAILURE' ? 'Failed' : null

  useEffect(() => {
    if (open && output.current) output.current.scrollTop = output.current.scrollHeight
  }, [logs, open])

  async function copyLogs() {
    try {
      const formatted = logs.map(({ stage, timestamp, message, payload }) =>
        `[${timestamp}] ${stage} ${message}${payload ? `\n${JSON.stringify(payload, null, 2)}` : ''}`,
      ).join('\n')
      await navigator.clipboard.writeText(formatted)
      setCopy({ logs, status: 'copied' })
    } catch {
      setCopy({ logs, status: 'failed' })
    }
  }

  return (
    <section className="execution-activity" aria-labelledby={titleId}>
      <div className="activity-header">
        <h2 id={titleId}>
          <button type="button" className="activity-toggle" aria-expanded={open} aria-controls={streamId} onClick={onToggle}>
            <Terminal size={16} aria-hidden="true" />
            <span>Execution activity</span>
            <ChevronDown size={16} className="activity-chevron" aria-hidden="true" />
          </button>
        </h2>
        <span className="activity-count">{logs.length} {logs.length === 1 ? 'event' : 'events'}</span>
        {activityStatus && <span className="activity-status" data-status={activityStatus.toLowerCase()}>{activityStatus}</span>}
        <div className="activity-tools" hidden={!open}>
          {copyStatus && <span className="activity-copy-status" role="status">{copyStatus === 'copied' ? 'Copied' : 'Copy unavailable'}</span>}
          <button type="button" title="Copy logs" aria-label="Copy logs" disabled={!logs.length} onClick={copyLogs}>
            {copyStatus === 'copied' ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          </button>
          <button
            type="button" title="Clear logs" aria-label="Clear logs" disabled={!logs.length} onClick={onClear}
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div id={streamId} className="activity-stream" ref={output} hidden={!open} role="log" aria-label="Engine events">
        {logs.length === 0 ? (
          <p className="activity-placeholder">{isExecuting ? 'Waiting for engine events…' : 'Execution events will appear here.'}</p>
        ) : logs.map((event, index) => {
          const [label, tone] = stageStyle[event.stage]
          return (
            <div className="activity-row" key={`${event.timestamp}-${event.stage}-${index}`}>
              <time>{event.timestamp}</time>
              <span className="activity-stage" data-tone={tone} title={event.stage}>{label}</span>
              <div className="activity-message"><div>{event.message}</div><EventDetails event={event} /></div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
