import React from "react";
import { textMatches } from "./search-context.js";

export function MatchedText({ text = "", query, initialMode = false }) {
  if (!query) return text;
  const ranges = textMatches(text, query, { initialMode });
  const children = [];
  let at = 0;
  for (const range of ranges) {
    children.push(text.slice(at, range.start));
    children.push(
      <mark key={range.start}>{text.slice(range.start, range.end)}</mark>,
    );
    at = range.end;
  }
  children.push(text.slice(at));
  return <>{children}</>;
}

export function SearchExcerpt({ match }) {
  return (
    <span className="search-context">
      <span className="search-context-source">{match.label}에서 찾음</span>
      <span className="search-excerpt">
        <MatchedText
          text={match.excerpt}
          query={match.query}
          initialMode={match.field === "title"}
        />
      </span>
    </span>
  );
}
