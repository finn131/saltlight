export function slugifyProgramName(name: string): string {
  const base = (name || '').trim();
  const cleaned = base
    .replace(/\.[Pp][Yy]$/, '')
    .replace(/[\\/]/g, '')
    .replace(/[^\w .-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');
  return cleaned === '' ? 'program' : cleaned;
}

export function exportFilename(name: string): string {
  return `${slugifyProgramName(name)}.py`;
}

// Strip a UTF-8 BOM only; everything else is preserved byte-for-byte so an
// export/import round trip is identical.
export function sanitizeImported(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export async function readProgramFile(file: File): Promise<string> {
  const text = await file.text();
  return sanitizeImported(text);
}

export function downloadProgram(source: string, name: string): void {
  const blob = new Blob([source], { type: 'text/x-python' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFilename(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ponytail: import is deliberately inert. It reads the file and hands the text
// to the caller; nothing here parses or executes. Execution happens only on an
// explicit Run, so an imported file can never run itself.
export function pickProgramFile(onLoad: (source: string, name: string) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.py';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await readProgramFile(file);
    onLoad(text, file.name);
  });
  input.click();
}