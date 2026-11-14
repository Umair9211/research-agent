import { useEffect, useRef, useState } from 'react'

const API_BASE_URL = import.meta.env.API_URL || 'http://localhost:8000'
const DEFAULT_MAX_ANALYSTS = 3
const EMPTY_GRAPH = { nodes: [], edges: [] }

const getStatusText = (status) => {
  switch (status) {
    case 'running':
      return 'Running'
    case 'completed':
      return 'Completed'
    case 'waiting':
      return 'Waiting'
    case 'failed':
      return 'Failed'
    default:
      return 'Pending'
  }
}

const normalizeOverallStatus = (status) => {
  if (!status) return 'pending'

  switch (status) {
    case 'running':
      return 'running'
    case 'completed':
    case 'finished':
      return 'completed'
    case 'error':
    case 'failed':
      return 'failed'
    case 'waiting_for_approval':
      return 'waiting'
    default:
      return 'pending'
  }
}

const renderReportDocument = (reportText) => {
  if (!reportText) return null

  const lines = reportText.replace(/\r\n/g, '\n').split('\n')
  const nodes = []
  let paragraphBuffer = []
  let listBuffer = []

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return

    const text = paragraphBuffer.join(' ').trim()
    if (text) {
      nodes.push(
        <p key={`paragraph-${nodes.length}`} className="report-paragraph">
          {text}
        </p>
      )
    }
    paragraphBuffer = []
  }

  const flushList = () => {
    if (!listBuffer.length) return

    nodes.push(
      <ul key={`list-${nodes.length}`} className="report-list">
        {listBuffer.map((item, index) => (
          <li key={`${item}-${index}`} className="report-list-item">
            {item}
          </li>
        ))}
      </ul>
    )
    listBuffer = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimEnd()
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }

    if (trimmed === '---') {
      flushParagraph()
      flushList()
      nodes.push(<hr key={`divider-${index}`} className="report-divider" />)
      continue
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      flushParagraph()
      flushList()

      if (/^#\s+/.test(trimmed)) {
        nodes.push(<h1 key={`heading-${index}`} className="report-h1">{trimmed.replace(/^#\s+/, '')}</h1>)
      } else if (/^##\s+/.test(trimmed)) {
        nodes.push(<h2 key={`heading-${index}`} className="report-h2">{trimmed.replace(/^##\s+/, '')}</h2>)
      } else {
        nodes.push(<h3 key={`heading-${index}`} className="report-h3">{trimmed.replace(/^###\s+/, '')}</h3>)
      }
      continue
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed) || /^\[\d+\]\s+/.test(trimmed)) {
      flushParagraph()
      listBuffer.push(trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').replace(/^\[\d+\]\s+/, ''))
      continue
    }

    paragraphBuffer.push(trimmed)
  }

  flushParagraph()
  flushList()

  return nodes
}

function WorkflowGraph({ graph, nodeStateMap, overallStatus, approvalRequired }) {
  const graphNodes = graph?.nodes || []
  const activeNodes = Object.entries(nodeStateMap)
    .filter(([, status]) => status === 'running' || status === 'waiting' || status === 'failed')
    .map(([nodeId]) => nodeId)

  const currentStage =
    graphNodes.find((node) => node.id === activeNodes[0])?.label ||
    (approvalRequired ? 'Human approval' : null)

  return (
    <div className="workflow-panel">
      <div className="workflow-header">
        <h3>Research workflow</h3>
        <span className={`workflow-status-badge workflow-status-badge--${normalizeOverallStatus(overallStatus)}`}>
          {overallStatus === 'waiting_for_approval'
            ? 'Waiting for approval'
            : overallStatus === 'completed'
              ? 'Completed'
              : overallStatus === 'failed'
                ? 'Failed'
                : overallStatus === 'running'
                  ? 'Running'
                  : 'Pending'}
        </span>
      </div>

      {currentStage && (
        <div className="workflow-current-stage">
          Current stage: <strong>{currentStage}</strong>
        </div>
      )}

      <div className="workflow-graph">
        {graphNodes.map((node, index) => {
          const isWaiting = approvalRequired && node.id === 'human_feedback'
          const nodeState = isWaiting ? 'waiting' : nodeStateMap[node.id] || 'pending'

          return (
            <div className="workflow-node-wrap" key={node.id}>
              <div className={`workflow-node workflow-node--${nodeState}`}>
                <strong>{node.label}</strong>
                <span>{getStatusText(nodeState)}</span>
              </div>
              {index < graphNodes.length - 1 && <div className="workflow-arrow" aria-hidden="true">→</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function App() {
  const [topic, setTopic] = useState('')
  const [maxAnalysts, setMaxAnalysts] = useState(DEFAULT_MAX_ANALYSTS)
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'bot',
      text: 'Tell me what you want researched, and I will start the workflow for you.',
    },
  ])
  const [threadId, setThreadId] = useState('')
  const [waitingForApproval, setWaitingForApproval] = useState(false)
  const [feedbackDraft, setFeedbackDraft] = useState('')
  const [report, setReport] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState('')
  const [workflowGraph, setWorkflowGraph] = useState(EMPTY_GRAPH)
  const [nodeStateMap, setNodeStateMap] = useState({})
  const [overallStatus, setOverallStatus] = useState('pending')

  const threadIdRef = useRef('')
  const graphRef = useRef(EMPTY_GRAPH)

  const appendMessage = (role, text) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `${role}-${Date.now()}-${Math.random()}`,
        role,
        text,
      },
    ])
  }

  useEffect(() => {
    const fetchGraphStructure = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/research/graph`)
        if (!response.ok) {
          throw new Error(`Graph request failed (${response.status})`)
        }

        const graphData = await response.json()
        setWorkflowGraph(graphData)
        graphRef.current = graphData
      } catch (graphError) {
        setError(graphError.message || 'Unable to load workflow graph.')
      }
    }

    fetchGraphStructure()
  }, [])

  const downloadPdf = () => {
    if (typeof window !== 'undefined') {
      window.print()
    }
  }

  const fetchReport = async (currentThreadId) => {
    if (!currentThreadId) return

    try {
      const response = await fetch(`${API_BASE_URL}/research/${currentThreadId}/report`)

      if (!response.ok) {
        throw new Error(`Report request failed (${response.status})`)
      }

      const data = await response.json()

      if (data.status === 'completed' && data.report) {
        setReport(data.report)
      }
    } catch (fetchError) {
      setError(fetchError.message || 'Unable to fetch final report.')
    }
  }

  const handleStreamResponse = async (response) => {
    if (!response.body) {
      throw new Error('The research stream is not available.')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let currentThreadId = threadIdRef.current

    while (true) {
      const { done, value } = await reader.read()

      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() || ''

      for (const chunk of chunks) {
        const trimmed = chunk.trim()
        if (!trimmed.startsWith('data:')) continue

        const payload = trimmed.replace(/^data:\s*/, '').trim()
        if (!payload) continue

        try {
          const event = JSON.parse(payload)

          if (event.type === 'session') {
            currentThreadId = event.thread_id
            threadIdRef.current = event.thread_id
            setThreadId(event.thread_id)
            setOverallStatus('running')
            continue
          }

          if (event.type === 'node') {
            const mainNodeIds = new Set((graphRef.current.nodes || []).map((node) => node.id))
            const nodeStatus = event.status || 'pending'

            if (mainNodeIds.has(event.node)) {
              setNodeStateMap((prev) => ({ ...prev, [event.node]: nodeStatus }))
            }

            if (nodeStatus === 'running') {
              setOverallStatus('running')
            }

            if (nodeStatus === 'error') {
              setOverallStatus('failed')
            }
            continue
          }

          if (event.type === 'approval_required') {
            setWaitingForApproval(true)
            setOverallStatus('waiting_for_approval')
            setNodeStateMap((prev) => ({ ...prev, human_feedback: 'waiting' }))
            appendMessage('bot', 'Human approval required before the research continues.')
            continue
          }

          if (event.type === 'graph_status') {
            const nextStatus = event.status || 'finished'
            setOverallStatus(nextStatus)

            if (nextStatus === 'completed') {
              setWaitingForApproval(false)
              setNodeStateMap((prev) => {
                const nextMap = { ...prev }
                Object.keys(nextMap).forEach((nodeId) => {
                  nextMap[nodeId] = nextMap[nodeId] === 'failed' ? 'failed' : 'completed'
                })
                return nextMap
              })
              appendMessage('bot', 'Research completed. Fetching final report...')
              await fetchReport(currentThreadId)
            } else if (nextStatus === 'finished') {
              setWaitingForApproval(false)
              appendMessage('bot', 'The workflow finished without a final report yet.')
            }
            continue
          }

          if (event.type === 'error') {
            setOverallStatus('failed')
            appendMessage('bot', `Error: ${event.message}`)
            setError(event.message)
          }
        } catch {
          // Ignore malformed SSE payloads.
        }
      }
    }
  }

  const resetWorkflowState = () => {
    setNodeStateMap({})
    setOverallStatus('pending')
    setWaitingForApproval(false)
  }

  const startResearch = async (event) => {
    event.preventDefault()

    const cleanTopic = topic.trim()
    if (!cleanTopic) {
      setError('Please enter a research topic first.')
      return
    }

    resetWorkflowState()
    setError('')
    setReport('')
    setFeedbackDraft('')
    setIsProcessing(true)
    appendMessage('user', cleanTopic)

    try {
      const response = await fetch(`${API_BASE_URL}/research`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topic: cleanTopic,
          max_analysts: Number(maxAnalysts) || DEFAULT_MAX_ANALYSTS,
        }),
      })

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`)
      }

      await handleStreamResponse(response)
    } catch (requestError) {
      setError(requestError.message || 'Unable to start the research workflow.')
    } finally {
      setIsProcessing(false)
      setTopic('')
    }
  }

  const submitFeedback = async (action) => {
    const currentThreadId = threadIdRef.current
    if (!currentThreadId) {
      setError('No active research session found.')
      return
    }

    const payload = {
      action,
      feedback: action === 'revise' ? feedbackDraft.trim() : '',
    }

    if (action === 'revise' && !payload.feedback) {
      setError('Please enter feedback before revising the research.')
      return
    }

    setError('')
    setIsProcessing(true)
    setWaitingForApproval(false)
    setNodeStateMap((prev) => ({ ...prev, human_feedback: 'completed' }))

    try {
      const response = await fetch(`${API_BASE_URL}/research/${currentThreadId}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(`Feedback request failed (${response.status})`)
      }

      await handleStreamResponse(response)
    } catch (feedbackError) {
      setError(feedbackError.message || 'Unable to submit feedback.')
    } finally {
      setFeedbackDraft('')
      setIsProcessing(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="chatbot-panel">
        <header className="chatbot-header">
          <div>
            <p className="eyebrow">Research workflow</p>
            <h1>Current state</h1>
          </div>
        </header>

        <WorkflowGraph
          graph={workflowGraph}
          nodeStateMap={nodeStateMap}
          overallStatus={overallStatus}
          approvalRequired={waitingForApproval}
        />

        {waitingForApproval && (
          <div className="approval-box">
            <h3>Human approval required</h3>
            <textarea
              value={feedbackDraft}
              onChange={(event) => setFeedbackDraft(event.target.value)}
              placeholder="Optional feedback if you want revisions..."
              rows={4}
            />
            <div className="approval-actions">
              <button type="button" className="approve-btn" onClick={() => submitFeedback('approve')} disabled={isProcessing}>
                Approve
              </button>
              <button type="button" className="revise-btn" onClick={() => submitFeedback('revise')} disabled={isProcessing}>
                Revise
              </button>
            </div>
          </div>
        )}

        {report && (
          <div className="report-box">
            <div className="report-box-header">
              <h2>Final report</h2>
              <button type="button" className="download-btn" onClick={downloadPdf}>
                Download PDF
              </button>
            </div>
            <article className="report-content">{renderReportDocument(report)}</article>
          </div>
        )}

        {error && <div className="message message--error">{error}</div>}

        <form className="composer" onSubmit={startResearch}>
          <label className="field">
            <span>Research topic</span>
            <input
              type="text"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Example: AI in healthcare"
              disabled={isProcessing}
            />
          </label>

          <label className="field field--small">
            <span>Max analysts</span>
            <input
              type="number"
              min="1"
              max="10"
              value={maxAnalysts}
              onChange={(event) => setMaxAnalysts(event.target.value)}
              disabled={isProcessing}
            />
          </label>

          <button className="send-btn" type="submit" disabled={isProcessing}>
            {isProcessing ? 'Running...' : 'Start research'}
          </button>
        </form>
      </section>
    </main>
  )
}

export default App
