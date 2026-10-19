import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage } from '@codemirror/language';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { javascript } from '@codemirror/legacy-modes/mode/javascript';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { python } from '@codemirror/legacy-modes/mode/python';

const LANGS: Record<string, any> = { dockerfile: dockerFile, yaml, shell, javascript, properties, python };

export function langFor(path: string): string | undefined {
  const p = path.toLowerCase();
  if (p.endsWith('dockerfile')) return 'dockerfile';
  if (/\.(ya?ml)$/.test(p)) return 'yaml';
  if (/\.(sh|bash)$/.test(p)) return 'shell';
  if (/\.(m?js|cjs|ts|tsx|jsx|json)$/.test(p)) return 'javascript';
  if (/\.(env|properties|ini|conf)$/.test(p) || p.includes('.env')) return 'properties';
  if (p.endsWith('.py')) return 'python';
  return undefined;
}

export default function CodeEditor({ value, onChange, language, height = '420px', readOnly }: {
  value: string; onChange?: (v: string) => void; language?: string; height?: string; readOnly?: boolean;
}) {
  const ext = language && LANGS[language] ? [StreamLanguage.define(LANGS[language])] : [];
  return <CodeMirror value={value} height={height} extensions={ext} editable={!readOnly} readOnly={readOnly} onChange={(v) => onChange?.(v)}
    basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: !readOnly }} />;
}
