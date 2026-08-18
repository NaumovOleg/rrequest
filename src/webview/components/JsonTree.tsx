import { useState, type ReactNode } from 'react'

// A collapsible JSON tree for the response body: expand/collapse objects and
// arrays, copy the dotted path of any node. Big bodies fall back to the plain
// text view in ResponsePanel (parse of 5 MB is fine, rendering thousands of
// rows is not), so no size guard is needed here.

const MAX_STRING = 80

type Path = (string | number)[]

function formatPath(path: Path): string {
  let out = ''
  for (const p of path) {
    if (typeof p === 'number') out += `[${p}]`
    else out += out ? `.${p}` : p
  }
  return out
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isArr(v: unknown): v is unknown[] {
  return Array.isArray(v)
}

function preview(v: unknown): ReactNode {
  if (v === null) return <span className="rm-json-null">null</span>
  if (typeof v === 'boolean') return <span className="rm-json-bool">{String(v)}</span>
  if (typeof v === 'number') return <span className="rm-json-num">{String(v)}</span>
  if (typeof v === 'string') {
    const s = v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…` : v
    return <span className="rm-json-str">"{s}"</span>
  }
  return null
}

function childrenOf(v: unknown): [string | number, unknown][] {
  if (isObj(v)) return Object.keys(v).map((k) => [k, v[k]] as [string, unknown])
  if (isArr(v)) return v.map((x, i) => [i, x] as [number, unknown])
  return []
}

// "{3 keys}" / "[2 items]" for nodes, raw scalar for leaves — the toggle
// label and the copy tooltip share it.
function summary(v: unknown): string {
  if (isArr(v)) return `[${v.length} item${v.length === 1 ? '' : 's'}]`
  if (isObj(v)) {
    const n = Object.keys(v).length
    return `{${n} key${n === 1 ? '' : 's'}}`
  }
  return String(v)
}

type RowProps = {
  /** Root rows render without a label; children carry theirs. */
  root?: boolean
  keyLabel: string | number
  value: unknown
  path: Path
  depth: number
  expanded: Set<string>
  toggle: (key: string) => void
}

function Row({ root, keyLabel, value, path, depth, expanded, toggle }: RowProps) {
  const key = formatPath(path)
  const collapsible = isObj(value) || isArr(value)
  const isOpen = expanded.has(key)
  const [copied, setCopied] = useState(false)
  const children = childrenOf(value)

  // Copy "path = value" (the whole subtree, pretty-printed, for nodes). The
  // root has no path, so it copies just the value — i.e. the full body.
  const copyPath = () => {
    const json = collapsible ? JSON.stringify(value, null, 2) : JSON.stringify(value)
    void navigator.clipboard.writeText(key ? `${key} = ${json}` : json)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="rm-json-row" style={{ paddingLeft: depth * 18 }}>
      <div className="rm-json-line">
        <button
          type="button"
          className="rm-json-caret"
          aria-expanded={collapsible ? isOpen : undefined}
          aria-label={collapsible ? `${isOpen ? 'collapse' : 'expand'} ${key}` : undefined}
          onClick={() => collapsible && toggle(key)}
        >
          {collapsible && (
            <span className={`codicon codicon-chevron-${isOpen ? 'down' : 'right'}`} aria-hidden="true" />
          )}
        </button>
        {!root && (
          <>
            {typeof keyLabel === 'number' ? (
              <span className="rm-json-index">{keyLabel}</span>
            ) : (
              <span className="rm-json-key">"{keyLabel}"</span>
            )}
            <span className="rm-json-colon">:</span>{' '}
          </>
        )}
        {collapsible ? (
          <button
            type="button"
            className="rm-json-toggle"
            aria-label={`${isOpen ? 'collapse' : 'expand'} ${key}`}
            onClick={() => toggle(key)}
          >
          {summary(value)}
          </button>
        ) : (
          preview(value)
        )}
      <button
        type="button"
        className="rm-json-copy"
        aria-label={key ? `copy ${key} and its value` : 'copy the response body'}
        title={key ? `Copy: ${key} = ${summary(value)}` : 'Copy the response body'}
        onClick={copyPath}
      >
          {copied ? (
            <span className="codicon codicon-check" aria-hidden="true" />
          ) : (
            <span className="codicon codicon-copy" aria-hidden="true" />
          )}
        </button>
      </div>
      {collapsible && isOpen && (
        <div className="rm-json-children">
          {children.map(([k, v]) => (
            <Row
              key={k}
              keyLabel={k}
              value={v}
              path={[...path, k]}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function JsonTree({ text }: { text: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch {
    return <pre className="rm-code">Invalid JSON</pre>
  }

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  return (
    <div className="rm-json-tree">
      {isObj(root) || isArr(root) ? (
        <Row
          root
          keyLabel="root"
          value={root}
          path={[]}
          depth={0}
          expanded={expanded}
          toggle={toggle}
        />
      ) : (
        <div className="rm-json-row rm-json-root-primitive">{preview(root)}</div>
      )}
    </div>
  )
}
