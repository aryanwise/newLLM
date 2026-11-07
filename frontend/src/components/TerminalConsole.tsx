import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, Copy, Terminal, Trash2 } from 'lucide-react'
import type { EngineStage, WebSocketEvent } from '../types/engine'

interface TerminalConsoleProps {
  logs: WebSocketEvent[]
  onClear: () => void
  isExecuting: boolean
}

const stageStyle: Record<EngineStage, [label: string, tone: string]> = {
  PLANNING: ['PLAN', 'tone-blue'],
  PROVISIONING: ['SANDBOX', 'tone-purple'],
  GENERATING_TURN_1: ['DRAFT', 'tone-neutral'],
  VERIFYING: ['VERIFY', 'tone-amber'],
  INTROSPECTING: ['INSPECT', 'tone-orange'],
  SPLICING: ['SPLICE', 'tone-cyan'],
  VERIFYING_TURN_2: ['VERIFY 02', 'tone-amber'],
  GENERATING_FALLBACK: ['REWRITE', 'tone-purple'],
  VERIFYING_FALLBACK: ['VERIFY 03', 'tone-amber'],
  SUCCESS: ['PASSED', 'tone-green'],
  FAILURE: ['FAILED', 'tone-red'],
}

function EventDetails({ event }: { event: WebSocketEvent }) {
  const data = event.payload
  if (!data) return null
  const line = data.line_number ?? (data.start_point && data.start_point[0] + 1)

  return (
    <div className="log-details">
      {event.stage === 'INTROSPECTING' && data.traceback && (
        <details><summary>Runtime traceback</summary><pre>{data.traceback.trimEnd()}</pre></details>
      )}
      {event.stage === 'INTROSPECTING' && data.symbols?.map((symbol) => (
        <details key={`${symbol.package}.${symbol.symbol}`}>
          <summary>{symbol.package}.{symbol.symbol}</summary>
          {symbol.signature && <pre className="log-signature">{symbol.symbol}{symbol.signature}</pre>}
          {symbol.doc && <pre>{symbol.doc}</pre>}
          {symbol.example && <pre>{symbol.example}</pre>}
        </details>
      ))}
      {event.stage === 'SPLICING' && typeof data.start_byte === 'number' && typeof data.end_byte === 'number' && (
        <div className="splice-meta">
          <span>{data.node_type || 'AST node'}</span>
          {line && <span>Line {line}</span>}
          <span>Bytes {data.start_byte}–{data.end_byte}</span>
        </div>
      )}
      {(event.stage === 'SUCCESS' || event.stage === 'FAILURE') && data.stdout?.trim() && (
        <pre className="log-output"><span>stdout</span>{data.stdout.trimEnd()}</pre>
      )}
      {event.stage === 'FAILURE' && (data.stderr || data.traceback) && (
        <pre className="log-error"><span>stderr</span>{(data.stderr || data.traceback)?.trimEnd()}</pre>
      )}
      {event.stage === 'GENERATING_FALLBACK' && data.repair_error && (
        <details><summary>Surgical repair error</summary><pre>{data.repair_error}</pre></details>
      )}
    </div>
  )
}

export function TerminalConsole({ logs, onClear, isExecuting }: TerminalConsoleProps) {
  const output = useRef<HTMLDivElement>(null)
  const [copyStatus, setCopyStatus] = useState<'copied' | 'failed' | null>(null)

  useEffect(() => {
    if (output.current) output.current.scrollTop = output.current.scrollHeight
  }, [logs])

  async function copyLogs() {
    try {
      const formatted = logs.map(({ stage, timestamp, message, payload }) =>
        `[${timestamp}] ${stage} ${message}${payload ? `\n${JSON.stringify(payload, null, 2)}` : ''}`,
      ).join('\n')
      await navigator.clipboard.writeText(formatted)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('failed')
    }
  }

  return (
    <section className="pane terminal-pane" aria-labelledby="terminal-title">
      <div className="pane-header">
        <Terminal size={17} className="pane-icon" aria-hidden="true" />
        <h2 id="terminal-title">Execution log</h2>
        <span className="log-count">{logs.length} {logs.length === 1 ? 'event' : 'events'}</span>
        <div className="terminal-controls">
          {copyStatus && <span className="copy-status" role="status">{copyStatus === 'copied' ? 'Copied' : 'Copy unavailable'}</span>}
          <button type="button" className="icon-button" title="Copy logs" aria-label="Copy logs" disabled={!logs.length} onClick={copyLogs}>
            {copyStatus === 'copied' ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          </button>
          <button
            type="button" className="icon-button" title="Clear logs" aria-label="Clear logs" disabled={!logs.length}
            onClick={() => { setCopyStatus(null); onClear() }}
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="terminal-output" ref={output} role="log" aria-label="Engine events">
        {logs.length === 0 ? (
          <p className="terminal-placeholder"><span>›</span> {isExecuting ? 'Waiting for engine events…' : 'Execution events will appear here.'}</p>
        ) : logs.map((event, index) => {
          const [label, tone] = stageStyle[event.stage]
          return (
            <div className="log-row" key={`${event.timestamp}-${event.stage}-${index}`}>
              <time>{event.timestamp}</time>
              <span className={clsx('log-badge', tone)} title={event.stage}>{label}</span>
              <div className="log-message"><div>{event.message}</div><EventDetails event={event} /></div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
