import { EditorView, keymap, highlightActiveLine, lineNumbers, drawSelection, Decoration } from '@codemirror/view';
import { EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion, completionKeymap, type CompletionContext } from '@codemirror/autocomplete';
import { tokenize, type Token } from '../vm/tokenizer';
import { loamCompletions } from './completion';

// Token type -> CSS class. INDENT/DEDENT/NEWLINE/EOF carry no text.
function classFor(t: Token): string | null {
  switch (t.type) {
    case 'KEYWORD':
      return 'tok-keyword';
    case 'NUM':
      return 'tok-number';
    case 'STR':
      return 'tok-string';
    case 'NAME':
      return 'tok-name';
    case 'OP':
      return /^(\(|\)|\[|\]|\{|\}|,|:|\.)$/.test(t.value) ? null : 'tok-op';
    default:
      return null;
  }
}

function buildDecorations(src: string): RangeSetBuilder<Decoration> | null {
  let tokens: Token[];
  try {
    tokens = tokenize(src);
  } catch {
    // ponytail: a tab or unterminated string stops highlighting; the located
    // error is surfaced from the worker. Any tokenizer error degrades to plain
    // text rather than throwing inside the CodeMirror update pipeline.
    return null;
  }
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  const builder = new RangeSetBuilder<Decoration>();
  const marks: { from: number; to: number; cls: string }[] = [];
  for (const t of tokens) {
    const cls = classFor(t);
    if (!cls || t.value.length === 0) continue;
    const start = lineStarts[t.line - 1];
    if (start === undefined) continue;
    const from = start + (t.col - 1);
    marks.push({ from, to: from + t.value.length, cls });
  }
  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const m of marks) builder.add(m.from, m.to, highlightMark(m.cls));
  return builder;
}

function highlightMark(cls: string) {
  return Decoration.mark({ class: cls });
}

const loamHighlight: Extension = EditorView.decorations.compute(['doc'], (state) => {
  const builder = buildDecorations(state.doc.toString());
  return builder ? builder.finish() : Decoration.none;
});

function loamCompletionSource(ctx: CompletionContext) {
  const word = ctx.matchBefore(/[\w.]*/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  const options = loamCompletions(word.text.replace(/\./g, '')).map((c) => ({
    label: c.label,
    detail: c.detail,
    info: c.info,
    apply: c.apply,
  }));
  if (options.length === 0) return null;
  return { from: word.from, options };
}

export interface EditorHandle {
  view: EditorView;
  getSource(): string;
  setSource(src: string): void;
  focus(): void;
}

export function createEditor(parent: HTMLElement, initial: string, onChange?: () => void): EditorHandle {
  const updateListener = EditorView.updateListener.of((u) => {
    if (u.docChanged) onChange?.();
  });

  // Enter keeps the previous line's indentation; Loam rejects tabs and wants
  // 4-space levels, and a beginner should not have to retype them each line.
  const keepIndent = keymap.of([
    {
      key: 'Enter',
      run: (view) => {
        const pos = view.state.selection.main.head;
        const line = view.state.doc.lineAt(pos);
        const indent = /^ */.exec(line.text)?.[0] ?? '';
        view.dispatch({
          changes: { from: pos, insert: '\n' + indent },
          selection: { anchor: pos + 1 + indent.length },
          scrollIntoView: true,
        });
        return true;
      },
    },
  ]);

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: initial,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
        keepIndent,
        autocompletion({ override: [loamCompletionSource] }),
        loamHighlight,
        EditorView.lineWrapping,
        updateListener,
      ],
    }),
  });

  return {
    view,
    getSource: () => view.state.doc.toString(),
    setSource: (src: string) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } }),
    focus: () => view.focus(),
  };
}