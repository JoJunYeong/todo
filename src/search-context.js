import { htmlText, initials, normalize } from "./domain.js";

let graphemes;
const foldUnicode = (text) => text.normalize("NFKC").toLocaleLowerCase("ko-KR");

// Keep source offsets: a normalized character can represent several source
// characters (Hangul jamo), or one source glyph can expand (ligatures).
function searchable(text, initialMode = false) {
  const raw = String(text || ""),
    nfkc = raw.normalize("NFKC"),
    lower = nfkc.toLocaleLowerCase("ko-KR");
  let groups;
  if (
    lower.length !== raw.length ||
    (nfkc !== raw &&
      /[\p{M}\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\ud7b0-\ud7ff\ud800-\udbff]/u.test(
        raw,
      ))
  ) {
    groups = [];
    graphemes ||= Intl.Segmenter
      ? new Intl.Segmenter("ko", { granularity: "grapheme" })
      : {
          segment: (text) =>
            [...text.matchAll(/[\s\S]/gu)].map((m) => ({
              segment: m[0],
              index: m.index,
            })),
        };
    for (const { segment, index } of graphemes.segment(raw)) {
      const entry = {
        start: index,
        end: index + segment.length,
        length: foldUnicode(segment).length,
      };
      const previous = groups.at(-1);
      if (previous) {
        const joined = foldUnicode(raw.slice(previous.start, entry.end)).length;
        if (joined !== previous.length + entry.length) {
          previous.end = entry.end;
          previous.length = joined;
          continue;
        }
      }
      groups.push(entry);
    }
    let at = 0;
    for (const group of groups) {
      group.from = at;
      at += group.length;
      group.to = at;
    }
  }
  const gaps = [];
  let extra = 0;
  let value = lower.replace(/\s+/gu, (space, index) => {
    extra += space.length - 1;
    gaps.push({ at: index - extra + space.length - 1, extra });
    return " ";
  });
  if (initialMode) value = foldUnicode(initials(value));
  const sourceOffset = (position, end = false) => {
    let low = 0,
      high = gaps.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (gaps[middle].at < position) low = middle + 1;
      else high = middle;
    }
    const offset = position + (gaps[low - 1]?.extra || 0);
    if (!groups) return offset;
    const group = groups.find((g) =>
      end
        ? g.from < offset && g.to >= offset
        : g.from <= offset && g.to > offset,
    );
    return group ? (end ? group.end : group.start) : raw.length;
  };
  return {
    value,
    range: (start, end) => ({
      start: sourceOffset(start),
      end: sourceOffset(end, true),
    }),
  };
}

export function textMatches(
  text,
  query,
  { initialMode = false, limit = 80 } = {},
) {
  const words = [...new Set(normalize(query).split(" ").filter(Boolean))];
  if (!words.length) return [];
  const folded = searchable(text),
    hits = [];
  const add = (value, word) => {
    let from = 0;
    while (hits.length < limit) {
      const at = value.value.indexOf(word, from);
      if (at < 0) break;
      hits.push(value.range(at, at + word.length));
      from = at + Math.max(1, word.length);
    }
  };
  const phrase = normalize(query);
  if (words.length > 1) add(folded, phrase);
  for (const word of words) add(folded, word);
  if (initialMode) {
    const consonants = words.filter((word) =>
      /^[ㄱ-ㅎ\u1100-\u1112]+$/.test(word),
    );
    if (consonants.length) {
      const initialText = searchable(text, true);
      for (const word of consonants) add(initialText, word);
    }
  }
  const merged = [];
  for (const hit of hits.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const last = merged.at(-1);
    if (last && hit.start <= last.end) last.end = Math.max(last.end, hit.end);
    else merged.push({ ...hit });
  }
  return merged;
}

export function firstTextMatch(text, query, options) {
  const phrase = normalize(query);
  if (!phrase) return null;
  const folded = searchable(text),
    at = folded.value.indexOf(phrase);
  return at >= 0
    ? folded.range(at, at + phrase.length)
    : textMatches(text, query, options)[0] || null;
}

export function searchContext(task, query, noteText = htmlText(task.note)) {
  const fields = [
    { field: "note", label: "메모", text: noteText },
    ...(task.checklist || []).map((item) => ({
      field: "checklist",
      label: "체크리스트",
      itemId: item.id,
      text: item.text,
    })),
    { field: "title", label: "제목", text: task.text || "" },
  ];
  for (const field of fields) {
    const hit = firstTextMatch(field.text, query, {
      initialMode: field.field === "title",
    });
    if (!hit) continue;
    let start = Math.max(0, hit.start - 20),
      end = Math.min(field.text.length, hit.end + 68);
    // Do not split a surrogate pair at an excerpt boundary.
    if (start && /[\udc00-\udfff]/.test(field.text[start])) start--;
    if (end < field.text.length && /[\udc00-\udfff]/.test(field.text[end]))
      end++;
    const excerpt =
      (start ? "…" : "") +
      field.text.slice(start, end) +
      (end < field.text.length ? "…" : "");
    return {
      field: field.field,
      label: field.label,
      itemId: field.itemId,
      excerpt,
      query,
      needle: field.text.slice(hit.start, hit.end),
    };
  }
  return { field: "title", label: "제목", excerpt: "", query };
}
