import { useRef, type InputHTMLAttributes } from "react";

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

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  value: string;
  onChange: (v: string) => void;
  /** Names of variables that exist in the active environment. */
  knownVars: Set<string>;
};

/**
 * Text input that highlights `{{var}}` tokens — but only when that variable
 * actually exists in the active environment. A mirror div behind a caret-only
 * input renders the highlighted copy, scroll-synced to the input.
 */
export function EnvVarInput({ value, onChange, knownVars, className, ...rest }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const sync = () => {
    if (mirrorRef.current && inputRef.current)
      mirrorRef.current.scrollLeft = inputRef.current.scrollLeft;
  };
  const segs = tokenize(value, knownVars);
  return (
    <div className={`rm-envinput ${className ?? ""}`}>
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
    </div>
  );
}
