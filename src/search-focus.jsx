import React, { useLayoutEffect, useState } from "react";
import { firstTextMatch } from "./search-context.js";

const blocks = /^(P|DIV|LI|UL|OL|H[1-6]|PRE|BLOCKQUOTE|TR|TD|TH|BR|HR|IMG)$/;

function noteRange(editor, query, isMD) {
  const strings = [],
    nodes = [];
  let length = 0;
  const append = (text, node) => {
    if (node) nodes.push({ node, start: length, end: length + text.length });
    strings.push(text);
    length += text.length;
  };
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) append(node.data, node);
    else if (node.nodeType === Node.ELEMENT_NODE) {
      const block = blocks.test(node.tagName);
      if (block) append(" ");
      for (const child of node.childNodes) walk(child);
      if (block) append(" ");
    }
  };
  for (const child of editor.childNodes) walk(child);
  const text = strings.join("");
  const hit =
    firstTextMatch(text, query) ||
    (isMD && firstTextMatch(text, query.replace(/[*_`~\[\]#]/g, "")));
  if (!hit) return null;
  const first = nodes.find((node) => node.end > hit.start);
  const last = nodes.findLast((node) => node.start < hit.end);
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, Math.max(0, hit.start - first.start));
  range.setEnd(last.node, Math.min(last.node.length, hit.end - last.start));
  return () => [...range.getClientRects()];
}

// A short-lived mirror measures editable form values without selecting text,
// focusing a field, inserting <mark> tags or touching the editor's undo stack.
function inputRects(input, query, initialMode) {
  const hit = firstTextMatch(input.value, query, { initialMode });
  if (!hit) return [];
  const style = getComputedStyle(input),
    box = input.getBoundingClientRect();
  const scaleX = box.width / input.offsetWidth || 1,
    scaleY = box.height / input.offsetHeight || 1;
  const mirror = document.createElement("div");
  for (const key of [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "lineHeight",
    "letterSpacing",
    "textAlign",
    "direction",
    "padding",
    "borderWidth",
    "boxSizing",
    "wordBreak",
    "overflowWrap",
  ])
    mirror.style[key] = style[key];
  Object.assign(mirror.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: input.offsetWidth + "px",
    height: "auto",
    visibility: "hidden",
    pointerEvents: "none",
    borderStyle: "solid",
    whiteSpace: input.tagName === "TEXTAREA" ? "pre-wrap" : "pre",
  });
  mirror.textContent = input.value;
  document.body.append(mirror);
  try {
    const range = document.createRange();
    range.setStart(mirror.firstChild, hit.start);
    range.setEnd(mirror.firstChild, hit.end);
    const rects = [...range.getClientRects()];
    if (!rects.length) return [];
    if (input.tagName === "INPUT")
      input.scrollLeft = Math.max(0, rects[0].left - input.clientWidth * 0.25);
    else
      input.scrollTop = Math.max(0, rects[0].top - input.clientHeight * 0.25);
    return rects.map((r) => ({
      left: Math.max(box.left, box.left + (r.left - input.scrollLeft) * scaleX),
      right: Math.min(
        box.right,
        box.left + (r.right - input.scrollLeft) * scaleX,
      ),
      top: Math.max(box.top, box.top + (r.top - input.scrollTop) * scaleY),
      bottom: Math.min(
        box.bottom,
        box.top + (r.bottom - input.scrollTop) * scaleY,
      ),
    }));
  } finally {
    mirror.remove();
  }
}

function mergeRects(rects) {
  const merged = [];
  for (const rect of rects
    .filter((r) => r.right > r.left && r.bottom > r.top)
    .sort((a, b) => a.top - b.top || a.left - b.left)) {
    const previous = merged.at(-1);
    if (
      previous &&
      Math.abs(previous.top - rect.top) < 5 &&
      rect.left <= previous.right + 3
    ) {
      previous.right = Math.max(previous.right, rect.right);
      previous.bottom = Math.max(previous.bottom, rect.bottom);
    } else
      merged.push({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      });
  }
  return merged.slice(0, 32);
}

export function SearchFocus({ target, editorRef, titleRef, isMD }) {
  const [rects, setRects] = useState([]);
  useLayoutEffect(() => {
    if (!target?.query) return;
    const editor = editorRef.current,
      body = editor?.closest(".detail-body");
    if (!body) return;
    let read;
    if (target.field === "note")
      read = noteRange(editor, target.needle || target.query, isMD);
    else {
      const input =
        target.field === "title"
          ? titleRef.current
          : [...body.querySelectorAll("[data-checklist-id]")]
              .find((row) => row.dataset.checklistId === target.itemId)
              ?.querySelector('input[type="text"], input:not([type])');
      if (input)
        read = () =>
          inputRects(
            input,
            target.needle || target.query,
            target.field === "title",
          );
    }
    if (!read) return;
    let ended = false,
      interacted = false,
      frame,
      timer;
    const update = () => {
      if (ended) return;
      const box = body.getBoundingClientRect(),
        sx = box.width / body.offsetWidth || 1,
        sy = box.height / body.offsetHeight || 1;
      let matches = mergeRects(read());
      if (!matches.length) return;
      if (!interacted)
        body.scrollTop +=
          (matches[0].top - box.top) / sy -
          body.clientTop -
          Math.min(96, body.clientHeight * 0.22);
      matches = mergeRects(read());
      setRects(
        matches.map((r) => ({
          left: (r.left - box.left) / sx + body.scrollLeft - body.clientLeft,
          top: (r.top - box.top) / sy + body.scrollTop - body.clientTop,
          width: (r.right - r.left) / sx,
          height: (r.bottom - r.top) / sy,
        })),
      );
    };
    const userInteraction = () => {
      interacted = true;
    };
    const finish = () => {
      ended = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
        body.removeEventListener(event, userInteraction, true);
      for (const event of ["beforeinput", "input"])
        body.removeEventListener(event, finish, true);
      setRects([]);
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    });
    update();
    observer.observe(editor);
    observer.observe(body);
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
      body.addEventListener(event, userInteraction, {
        capture: true,
        passive: true,
      });
    for (const event of ["beforeinput", "input"])
      body.addEventListener(event, finish, { capture: true, passive: true });
    timer = setTimeout(finish, 2200);
    return finish;
  }, [target, editorRef, titleRef, isMD]);
  if (!rects.length) return null;
  return (
    <>
      {rects.map((rect, i) => (
        <span
          key={i}
          data-search-focus={target.field}
          className="search-focus-rect"
          style={rect}
          aria-hidden="true"
        />
      ))}
      <span className="search-focus-status" role="status">
        {target.label}에서 검색한 위치로 이동했어요.
      </span>
    </>
  );
}
