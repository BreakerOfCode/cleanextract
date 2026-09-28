const encoder = new TextEncoder();

function splitSections(markdown) {
  const headings = [...markdown.matchAll(/^#{1,4} (.+)(?:\r)?$/gm)];
  const starts = headings.map((match) => match.index);
  const parts = [];
  if (starts.length === 0 || starts[0] > 0) {
    const end = starts[0] ?? markdown.length;
    if (markdown.slice(0, end).trim()) {
      parts.push({ level: 0, heading: "", body: markdown.slice(0, end) });
    }
  }
  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index];
    parts.push({
      level: match[0].match(/^#+/)[0].length,
      heading: match[1].trim(),
      body: markdown.slice(match.index, starts[index + 1] ?? markdown.length),
    });
  }
  return parts.map((part, index) => ({ ...part, id: `s${index + 1}` }));
}

export function outlineMarkdown(markdown) {
  return splitSections(markdown).map(({ id, level, heading, body }) => ({
    id, level, heading, bytes: encoder.encode(body).length,
  }));
}

export function selectSections(markdown, ids) {
  const requested = new Set(ids);
  const parts = splitSections(markdown);
  const selected = parts.filter((part) => requested.has(part.id));
  const present = new Set(selected.map((part) => part.id));
  return {
    markdown: selected.map((part) => part.body).join(""),
    sections_returned: selected.map((part) => part.id),
    sections_missing: [...requested].filter((id) => !present.has(id)),
    available_sections: parts.map((part) => part.id),
    parts: selected.map(({ id, body }) => ({ id, body })),
  };
}

export async function markdownFingerprint(markdown) {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(markdown));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
