import { BUILTINS } from '../vm/builtins';

export interface LoamCompletion {
  label: string;
  detail: string;
  info: string;
  apply: string;
}

// Completion is driven by the runtime builtin table so the editor, the
// completion popup and the interpreter cannot disagree. No second list.
export function loamCompletions(prefix: string, limit = 20): LoamCompletion[] {
  const p = prefix.toLowerCase();
  const matches: LoamCompletion[] = [];
  for (const b of BUILTINS) {
    if (p === '' || b.name.toLowerCase().startsWith(p)) {
      matches.push({
        label: b.signature,
        detail: b.chapter === 2 ? 'chapter 2' : 'builtin',
        info: b.doc,
        apply: b.name,
      });
      if (matches.length >= limit) break;
    }
  }
  return matches;
}