import { useRef, useState, type InputHTMLAttributes } from "react";

const TOKEN = /(\{\{\s*[\w.-]+\s*\}\})/g;
const NAME = /\{\{\s*([\w.-]+)\s*\}\}/;

type Seg = { text: string; known: boolean };

function tokenize(value: string, known: Set<string>): Seg[] {
  return value
    .split(TOKEN)
    .filter((s) => s !== "")
    .map((s) => {
      const m = s.match(NAME);
      return { text: s, known: !!m && s === `{{${m[1]}}}` && known.has(m[1]) };
    });
}

// Distinct `{{name}}` tokens in order of first appearance.
function tokenNames(value: string): string[] {
  const out: string[] = [];
  for (const s of value.split(TOKEN)) {
    const m = s.match(NAME);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  value: string;
  onChange: (v: string) => void;
  /** Names of variables that exist in the active environment. */
  knownVars: Set<string>;
  /**
   * name -> resolved value for the active environment. When provided, hovering
   * the field shows what each `{{var}}` in the value resolves to (or "not set").
   * The mirror div behind the input is pointer-events:none, so a native title
   * on the highlighted tokens would never fire — this popover is the stand-in.
   */
  values?: Map<string, string>;
};

/**
 * Text input that highlights `{{var}}` tokens — but only when that variable
 * actually exists in the active environment. A mirror div behind a caret-only
 * input renders the highlighted copy, scroll-synced to the input. Hovering
 * shows the resolved value of each token when `values` is supplied.
 */
export function EnvVarInput({ value, onChange, knownVars, values, className, ...rest }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const sync = () => {
    if (mirrorRef.current && inputRef.current)
      mirrorRef.current.scrollLeft = inputRef.current.scrollLeft;
  };
  const segs = tokenize(value, knownVars);
  const names = tokenNames(value);
  const showHints = hover && values !== undefined && value.includes("{{");
  return (
    <div
      className={`rm-envinput ${className ?? ""}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="rm-envinput-mirror" ref={mirrorRef} aria-hidden="true">
        {segs.map((s, i) =>
          s.known ? (
            <span key={i} className="rm-envvar">
              {s.text}
            </span>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </div>
      <input
        ref={inputRef}
        className="rm-input rm-envinput-field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={sync}
        {...rest}
      />
      {showHints && (
        <div className="rm-env-hints" role="list">
          {names.map((n) => (
            <div key={n} className="rm-env-hint" role="listitem">
              <span className="rm-env-hint-name">{`{{${n}}}`}</span>
              <span
                className={
                  values!.has(n) ? "rm-env-hint-value" : "rm-env-hint-value is-missing"
                }
              >
                {values!.has(n) ? values!.get(n) : "not set"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}