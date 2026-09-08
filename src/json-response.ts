// Extract object text, not JavaScript: parsing and schema validation remain mandatory.
export function extractJsonObjects(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text);
    // Do not turn a complete but invalid root (e.g. an array) into a valid child.
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? [text.trim()]
      : [];
  } catch {
    // Wrapped or incomplete JSON needs lexical extraction.
  }

  const spans: Array<{ start: number; end: number }> = [];
  const incomplete: Array<{ start: number; end: number }> = [];
  const stack: number[] = [];
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    // A wrapper also bounds a truncated object. Never split a string.
    if (!quoted && (index === 0 || text[index - 1] === "\n")) {
      const end = text.indexOf("\n", index);
      const lineEnd = end === -1 ? text.length : end;
      const line = text.slice(index, lineEnd).trim();
      if (/^(?:`{3,}[^`]*|~{3,}[^~]*|---)$/.test(line)) {
        if (stack.length) incomplete.push({ start: stack[0]!, end: index });
        stack.length = 0;
        index = lineEnd;
        continue;
      }
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"' && stack.length) quoted = true;
    else if (char === "{" || char === "[") stack.push(index);
    else if (char === "}" || char === "]") {
      const start = stack.pop();
      if (start !== undefined) spans.push({ start, end: index + 1 });
    }
  }
  if (stack.length) incomplete.push({ start: stack[0]!, end: text.length });

  // Keep outermost complete containers; an unclosed prose brace must not hide
  // a complete answer inside it. Store offsets first to avoid copying nesting.
  let coveredEnd = -1;
  const roots = spans
    .sort((left, right) => left.start - right.start)
    .filter((span) => {
      if (span.start < coveredEnd) return false;
      coveredEnd = span.end;
      return true;
    });
  return [
    ...new Set(
      [...roots, ...incomplete]
        .sort((left, right) => left.start - right.start)
        .filter(({ start }) => text[start] === "{")
        .map(({ start, end }) => text.slice(start, end).trim()),
    ),
  ];
}
