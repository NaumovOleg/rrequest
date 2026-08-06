import {
  useEffect,
  useRef,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

// A <textarea> with optional minimal syntax highlighting, using the same
// mirror technique as EnvVarInput: a highlighted <pre> sits behind the field,
// whose own text is transparent (caret stays visible). The pre scrolls in
// lockstep with the field so the colors never drift.

const MAX_HIGHLIGHT_CHARS = 200_000;

// One JSON token: string (with escapes), number, or keyword. Splitting on the
// single capture group yields plain runs and token runs alternating, and each
// token is re-classified by the anchored regexes below.
const TOKEN =
  /("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/g;
const STRING = /^"(?:[^"\\]|\\.)*"$/;
const NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const KEYWORD = /^(?:true|false|null)$/;

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** "json" colorizes strings, numbers and keywords; "none" is plain text. */
  highlight?: "json" | "none";
};

export function CodeTextarea({ highlight = "none", className, ...rest }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  // After every render (typing grows the text, the field auto-scrolls),
  // re-pin the mirror to the field's scroll position. DOM-only writes, so
  // this never loops.
  useEffect(() => {
    const ta = taRef.current;
    const pre = preRef.current;
    if (ta && pre) {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
    }
  });

  const sync = () => {
    const ta = taRef.current;
    const pre = preRef.current;
    if (ta && pre) {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
    }
  };

  const value = String(rest.value ?? "");
  const colored =
    highlight === "json" && value.length > 0 && value.length <= MAX_HIGHLIGHT_CHARS;
  let mirror: React.ReactNode = value;
  if (colored) {
    mirror = value.split(TOKEN).map((p, i) => {
      if (p === "") return "";
      let cls = "";
      if (STRING.test(p)) cls = "rs-json-str";
      else if (KEYWORD.test(p)) cls = "rs-json-key";
      else if (NUMBER.test(p)) cls = "rs-json-num";
      return cls ? (
        <span key={i} className={cls}>
          {p}
        </span>
      ) : (
        p
      );
    });
  }

  return (
    <div className="rm-codebox">
      <pre className="rm-codebox-mirror" ref={preRef} aria-hidden="true">
        {mirror}
      </pre>
      <textarea
        ref={taRef}
        className={`rm-codebox-ta ${className ?? ""}`}
        onScroll={sync}
        spellCheck={false}
        {...rest}
      />
    </div>
  );
}
