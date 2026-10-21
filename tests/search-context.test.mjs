import { test } from "node:test";
import assert from "node:assert/strict";
import {
  firstTextMatch,
  textMatches,
  searchContext,
} from "../src/search-context.js";
import { buildSearchIndex, searchTasks, htmlText } from "../src/domain.js";

test("search excerpts locate a sentence near the end of a long memo rather than its opening", () => {
  const task = {
    text: "일반 제목",
    note: "시작 내용 ".repeat(600) + "계약서 검토 후 회신하기",
    checklist: [],
  };
  const context = searchContext(task, "계약서 검토");
  assert.equal(context.field, "note");
  assert.ok(context.excerpt.startsWith("…"));
  assert.ok(context.excerpt.includes("계약서 검토 후 회신하기"));
  assert.ok(context.excerpt.length < 130);
  assert.ok(!context.excerpt.startsWith("시작 내용"));
});
test("an exact phrase takes priority over an earlier isolated query word", () => {
  const text = "검토 예정입니다. ".repeat(10) + "계약서 검토 완료";
  const range = firstTextMatch(text, "계약서 검토");
  assert.equal(text.slice(range.start, range.end), "계약서 검토");
  assert.equal(range.start, text.indexOf("계약서"));
});
test("Unicode and whitespace normalization map highlights back to the original glyphs", () => {
  for (const [text, query, expected] of [
    ["앞 ＡＢＣ 뒤", "abc", "ＡＢＣ"],
    ["한\n\t  글과 끝", "한 글", "한\n\t  글"],
    ["앞 가나 뒤", "가나", "가나"],
    ["앞 ㄱㅏ 뒤", "가", "ㄱㅏ"],
    ["앞 ﬃ 뒤", "ffi", "ﬃ"],
    ["앞 İ 뒤", "i", "İ"],
    ["😀 앞 계약서 뒤", "계약서", "계약서"],
  ]) {
    const range = firstTextMatch(text, query);
    assert.ok(range, text);
    assert.equal(text.slice(range.start, range.end), expected, text);
  }
});
test("initials highlight the actual Hangul title and checklist hits keep their item identity", () => {
  const title = searchContext(
    { text: "보고서 작성", note: "", checklist: [] },
    "ㅂㄱㅅ",
  );
  assert.equal(title.field, "title");
  const range = textMatches("보고서 작성", "ㅂㄱㅅ", { initialMode: true })[0];
  assert.equal("보고서 작성".slice(range.start, range.end), "보고서");
  const item = searchContext(
    {
      text: "다른 제목",
      note: "메모",
      checklist: [{ id: "chosen", text: "서류 우편 발송" }],
    },
    "우편",
  );
  assert.equal(item.field, "checklist");
  assert.equal(item.itemId, "chosen");
  assert.ok(item.excerpt.includes("우편"));
});
test("overlapping, repeated and regex-like queries produce bounded literal ranges", () => {
  assert.deepEqual(textMatches("aaaa", "aa a"), [{ start: 0, end: 4 }]);
  assert.deepEqual(textMatches("[a]+ 그리고 [a]+", "[a]+"), [
    { start: 0, end: 4 },
    { start: 9, end: 13 },
  ]);
  assert.deepEqual(textMatches("내용", "  "), []);
  assert.equal(firstTextMatch("내용", "없는말"), null);
  assert.ok(textMatches("x ".repeat(1000), "x").length <= 80);
});
test("search text preserves inline phrases, block boundaries and visible HTML entities", () => {
  const task = {
    id: "inline",
    text: "별도 제목",
    note: "<ul><li>다른 항목</li><li>계<strong>약서</strong> &quot;검토&quot; &#xAC00;</li></ul>",
    checklist: [],
  };
  assert.equal(htmlText(task.note), '다른 항목 계약서 "검토" 가');
  assert.equal(searchTasks(buildSearchIndex([task]), "계약서")[0].id, task.id);
  assert.ok(searchContext(task, "계약서").excerpt.includes('계약서 "검토" 가'));
});
