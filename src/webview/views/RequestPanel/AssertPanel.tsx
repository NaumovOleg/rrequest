import type { CheckRow } from "./test-compile";

// No-code assertion rows: target (status/header/json/time) + operator + expected
// value. Parent owns the rows array and persists the compiled script via the
// request's testScript field.

export type Target = CheckRow["target"];

const TARGETS: { id: Target; label: string }[] = [
  { id: "status", label: "Status code" },
  { id: "header", label: "Response header" },
  { id: "json", label: "JSON field" },
  { id: "time", label: "Response time" },
];

function newId(): string {
  return `c${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyRow(): CheckRow {
  return { id: newId(), target: "status", selector: "", op: "eq", value: "200" };
}

function valueFor(t: Target): string {
  if (t === "status") return "200";
  if (t === "time") return "500";
  if (t === "header") return "Header name";
  return "a.b (dot path)";
}

function isNumeric(t: Target): boolean {
  return t === "status" || t === "time";
}

export function AssertPanel({
  rows,
  onChange,
}: {
  rows: CheckRow[];
  onChange: (rows: CheckRow[]) => void;
}) {
  const setRow = (id: string, patch: Partial<CheckRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div className="rm-checks">
      <table className="rm-checks-tbl">
        <thead>
          <tr>
            <th>Check</th>
            <th>Operator</th>
            <th>Expected</th>
            <th aria-label="remove" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <select
                  className="rm-input"
                  aria-label="check target"
                  value={r.target}
                  onChange={(e) =>
                    setRow(r.id, {
                      target: e.target.value as Target,
                      selector: "",
                      value: e.target.value === "status" ? "200" : e.target.value === "time" ? "500" : "",
                    })
                  }
                >
                  {TARGETS.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="rm-input rm-op"
                  aria-label="operator"
                  value={r.op}
                  onChange={(e) => setRow(r.id, { op: e.target.value as CheckRow["op"] })}
                >
                  <option value="eq">is</option>
                  <option value="lt">&lt;</option>
                  <option value="gt">&gt;</option>
                </select>
              </td>
              <td>
                <RowInput row={r} setRow={setRow} />
              </td>
              <td>
                <button
                  className="rm-icon-btn"
                  title="remove check"
                  aria-label="remove check"
                  onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
                >
                  <span className="codicon codicon-trash" aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="rm-btn rm-btn--sm" onClick={() => onChange([...rows, emptyRow()])}>
        + Add check
      </button>
    </div>
  );
}

// The middle column is two fields in one cell: for header/json a selector
// input followed by the expected value input; status/time only need the value.
function RowInput({ row, setRow }: { row: CheckRow; setRow: (id: string, p: Partial<CheckRow>) => void }) {
  if (isNumeric(row.target)) {
    return (
      <input
        className="rm-input rm-val"
        aria-label="expected value"
        inputMode={isNumeric(row.target) ? "numeric" : "text"}
        value={row.value}
        onChange={(e) => setRow(row.id, { value: e.target.value })}
        placeholder={valueFor(row.target)}
      />
    );
  }
  return (
    <div className="rm-checks-pair">
      <input
        className="rm-input"
        aria-label={row.target === "header" ? "header name" : "json path"}
        value={row.selector}
        onChange={(e) => setRow(row.id, { selector: e.target.value })}
        placeholder={valueFor(row.target)}
      />
      <input
        className="rm-input rm-val"
        aria-label="expected value"
        value={row.value}
        onChange={(e) => setRow(row.id, { value: e.target.value })}
        placeholder="expected"
      />
    </div>
  );
}