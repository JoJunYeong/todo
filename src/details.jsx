import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useLayoutEffect,
} from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  Plus,
  Trash2,
  Check,
  FileText,
  CalendarDays,
  Repeat2,
  Loader2,
  Bold,
  Italic,
  List,
  Link2,
  Info,
  CheckCheck,
  ImagePlus,
  ZoomIn,
} from "lucide-react";
import { Modal } from "./main.jsx";
import { dateKey, COLORS, COLOR_NAMES, FREQUENCIES } from "./domain.js";
import { authMessage } from "./auth.js";
import {
  prepareNoteImage,
  imageDataURL,
  savedNoteHTML,
} from "./note-images.js";
import { noteImageIds, imageId, MAX_NOTE_IMAGES } from "./image-data.js";

const safeHTML = (note, isMD) =>
  DOMPurify.sanitize(
    isMD
      ? marked.parse(note || "", { breaks: true, gfm: true })
      : /^\s*</.test(note || "") ||
          /<\/?(?:div|p|br|span|img|strong|em|b|i|a|table|ul|ol|li)\b[^>]*>/i.test(
            note || "",
          )
        ? note
        : String(note || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\n", "<br>"),
    {
      ADD_ATTR: ["target"],
      FORBID_TAGS: ["style", "script", "iframe", "form", "input"],
      FORBID_ATTR: ["style"],
    },
  ).replace(/<img\b/gi, '<img loading="lazy" decoding="async"');
export function Details({
  task,
  calendars,
  uid,
  store,
  onClose,
  onSaved,
  notify,
}) {
  const [title, setTitle] = useState(task.text),
    [date, setDate] = useState(task.date || ""),
    [listId, setListId] = useState(task.listId || ""),
    [calendarId, setCalendarId] = useState(task.calendarId),
    [color, setColor] = useState(task.color || "blank"),
    [done, setDone] = useState(task.done),
    [freq, setFreq] = useState(task.freq || 0),
    [recurrence, setRecurrence] = useState(task.recurrence || ""),
    [checklist, setChecklist] = useState(task.checklist || []),
    [newItem, setNewItem] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [noteDirty, setNoteDirty] = useState(false),
    [scope, setScope] = useState("single"),
    [preparingImages, setPreparingImages] = useState(false),
    [viewer, setViewer] = useState(null);
  const titleInput = useRef(),
    editor = useRef(),
    imageInput = useRef(),
    imageSelection = useRef(),
    stagedImages = useRef(new Map()),
    imageURLs = useRef(new Map()),
    imageLoads = useRef(new Map()),
    alive = useRef(true),
    initial = useRef(
      JSON.stringify({
        title,
        date,
        listId,
        calendarId,
        color,
        done,
        freq,
        recurrence,
        checklist,
      }),
    );
  const cal = calendars.find((c) => c.id === calendarId);
  const initialNoteHTML = useMemo(
    () => safeHTML(task.note, task.isMD),
    [task.id],
  );
  useLayoutEffect(() => {
    if (!titleInput.current) return;
    titleInput.current.style.height = "auto";
    titleInput.current.style.height =
      Math.min(titleInput.current.scrollHeight, 98) + "px";
  }, [title]);
  const dirty =
    noteDirty ||
    preparingImages ||
    JSON.stringify({
      title,
      date,
      listId,
      calendarId,
      color,
      done,
      freq,
      recurrence,
      checklist,
    }) !== initial.current;
  const close = useCallback(() => {
    if (saving) return;
    if (
      !dirty ||
      confirm("아직 저장하지 않은 변경사항이 있어요. 창을 닫을까요?")
    )
      onClose();
  }, [dirty, saving, onClose]);
  useEffect(() => {
    alive.current = true;
    if (editor.current) {
      hydrateImages();
    }
    return () => {
      alive.current = false;
      for (const url of imageURLs.current.values()) URL.revokeObjectURL(url);
      imageURLs.current.clear();
    };
  }, [task.id]);
  function selectionRange() {
    const selection = window.getSelection();
    return selection?.rangeCount &&
      editor.current.contains(selection.anchorNode)
      ? selection.getRangeAt(0).cloneRange()
      : null;
  }
  function restoreRange(range) {
    const selection = window.getSelection();
    if (!range || !editor.current.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor.current);
      range.collapse(false);
    }
    editor.current.focus();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  async function stageImage(file) {
    const ready = await prepareNoteImage(file);
    if (!alive.current) {
      URL.revokeObjectURL(ready.url);
      return null;
    }
    stagedImages.current.set(ready.attachment.id, ready.attachment);
    imageURLs.current.set(ready.attachment.id, ready.url);
    const image = document.createElement("img");
    image.dataset.daynoteImage = ready.attachment.id;
    image.src = ready.url;
    image.loading = "lazy";
    image.decoding = "async";
    image.alt = "캡처 이미지";
    image.width = ready.attachment.width;
    image.height = ready.attachment.height;
    return image;
  }
  async function hydrateImages() {
    const images = [
      ...(editor.current?.querySelectorAll("img[data-daynote-image]") || []),
    ];
    for (const image of images) {
      const id = image.dataset.daynoteImage;
      if (!imageId(id)) {
        image.removeAttribute("src");
        continue;
      }
      try {
        if (!imageURLs.current.has(id)) {
          if (!imageLoads.current.has(id))
            imageLoads.current.set(
              id,
              (async () => {
                const data = await store.getNoteImage(uid, id);
                const url = URL.createObjectURL(await imageDataURL(data.data));
                if (!alive.current) {
                  URL.revokeObjectURL(url);
                  return null;
                }
                imageURLs.current.set(id, url);
                return url;
              })(),
            );
          await imageLoads.current.get(id);
        }
        if (alive.current && image.isConnected && imageURLs.current.has(id))
          image.src = imageURLs.current.get(id);
      } catch {
        if (alive.current) {
          image.alt = "이미지를 불러오지 못했어요. 메모를 다시 열어 주세요.";
          image.dataset.imageError = "true";
        }
      }
    }
  }
  async function pasteImages(files, range) {
    if (preparingImages || saving) return;
    if (
      editor.current.querySelectorAll("img").length + files.length >
      MAX_NOTE_IMAGES
    ) {
      setError("메모 하나에 이미지는 30개까지 넣을 수 있어요.");
      return;
    }
    setPreparingImages(true);
    setError("");
    try {
      const images = [];
      for (const file of files) {
        const image = await stageImage(file);
        if (image) images.push(image);
      }
      if (!alive.current) return;
      restoreRange(range);
      format(
        "insertHTML",
        images.map((image) => image.outerHTML + "<br>").join(""),
      );
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setPreparingImages(false);
    }
  }
  async function pasteHTML(html, range) {
    const copy = document.createElement("div");
    copy.innerHTML = safeHTML(html, false);
    const embedded = [...copy.querySelectorAll('img[src^="data:"]')];
    if (
      editor.current.querySelectorAll("img").length +
        copy.querySelectorAll("img").length >
      MAX_NOTE_IMAGES
    ) {
      setError("메모 하나에 이미지는 30개까지 넣을 수 있어요.");
      return;
    }
    setPreparingImages(true);
    setError("");
    try {
      for (const image of embedded) {
        const staged = await stageImage(await imageDataURL(image.src));
        if (staged) image.replaceWith(staged);
      }
      if (!alive.current) return;
      restoreRange(range);
      format("insertHTML", copy.innerHTML);
      hydrateImages();
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setPreparingImages(false);
    }
  }
  const checklistUpdate = (id, patch) =>
    setChecklist((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const addItem = () => {
    if (!newItem.trim()) return;
    setChecklist((xs) => [
      ...xs,
      {
        id: crypto.randomUUID(),
        text: newItem.trim(),
        done: false,
        indent: 0,
        variant: "checklistItem",
      },
    ]);
    setNewItem("");
  };
  const format = (command, value) => {
    editor.current.focus();
    document.execCommand(command, false, value);
    setNoteDirty(true);
  };
  async function save(e) {
    e.preventDefault();
    if (saving || preparingImages) return;
    if (!title.trim()) {
      setError("할 일의 제목을 입력해 주세요.");
      return;
    }
    if (!date && !listId) {
      setError("날짜 또는 보관할 목록을 선택해 주세요.");
      return;
    }
    if (freq === 7 && !recurrence.trim()) {
      setError("사용자 지정 반복 규칙을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const note = noteDirty
        ? savedNoteHTML(editor.current, (html) => DOMPurify.sanitize(html))
        : (task.note ?? "");
      const ids = noteImageIds(note);
      const pending = ids
        .map((id) => stagedImages.current.get(id))
        .filter(Boolean);
      if (pending.length && !navigator.onLine)
        throw Error(
          "새 이미지를 저장하려면 인터넷 연결이 필요해요. 메모를 열어 둔 채 연결 후 다시 저장해 주세요.",
        );
      for (const image of pending) await store.saveNoteImage(uid, image);
      const patch = {
        text: title.trim(),
        date: date || null,
        listId: date ? null : listId,
        calendarId,
        color,
        done,
        freq: Number(freq),
        recurrence: Number(freq) === 7 ? recurrence : null,
        checklist,
        note,
        ...(noteDirty ? { isMD: false } : {}),
        ...(freq && !task.dtStart ? { dtStart: date || dateKey() } : {}),
        updatedAt: Date.now(),
      };
      await store.editTask(uid, task, patch, scope);
      notify("변경사항을 저장했어요.");
      onSaved();
    } catch (e) {
      setError(authMessage(e));
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!confirm("이 항목을 휴지통으로 옮길까요?")) return;
    setSaving(true);
    try {
      await store.deleteTask(uid, task);
      notify("휴지통으로 옮겼어요. 언제든 복원할 수 있어요.");
      onSaved();
    } catch (e) {
      setError(authMessage(e));
      setSaving(false);
    }
  }
  return (
    <>
      <Modal title="할 일 자세히" onClose={close} className="detail-modal">
        <form onSubmit={save}>
          <div className="detail-body">
            <div className="detail-title">
              <button
                type="button"
                role="checkbox"
                aria-checked={done}
                className={"detail-check " + (done ? "checked" : "")}
                aria-label="완료 상태 바꾸기"
                disabled={!!task.freq && scope === "series"}
                onClick={() => setDone(!done)}
              >
                {done && <Check size={19} />}
              </button>
              <textarea
                ref={titleInput}
                aria-label="할 일 제목"
                className="title-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                rows={1}
                maxLength={10000}
              />
            </div>
            <section className="note-section">
              <h3>
                <FileText size={16} />
                메모
                {preparingImages && <span role="status">이미지 준비 중…</span>}
              </h3>
              <div className="editor-toolbar">
                <button
                  type="button"
                  title="굵게"
                  aria-label="메모 굵게"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => format("bold")}
                >
                  <Bold size={15} />
                </button>
                <button
                  type="button"
                  title="기울임"
                  aria-label="메모 기울임"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => format("italic")}
                >
                  <Italic size={15} />
                </button>
                <button
                  type="button"
                  title="글머리 목록"
                  aria-label="메모 목록"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => format("insertUnorderedList")}
                >
                  <List size={15} />
                </button>
                <button
                  type="button"
                  title="링크"
                  aria-label="메모 링크"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const url = prompt("링크 주소 (https://)");
                    if (url && /^https?:\/\//i.test(url))
                      format("createLink", url);
                  }}
                >
                  <Link2 size={15} />
                </button>
                <button
                  type="button"
                  aria-label="메모 이미지 추가"
                  title="이미지 추가"
                  disabled={saving || preparingImages}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    imageSelection.current = selectionRange();
                    imageInput.current.click();
                  }}
                >
                  <ImagePlus size={16} />
                </button>
                <input
                  ref={imageInput}
                  type="file"
                  className="note-image-input"
                  hidden
                  accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                  multiple
                  onChange={(e) => {
                    const files = [...e.target.files];
                    e.target.value = "";
                    if (files.length)
                      pasteImages(files, imageSelection.current);
                  }}
                />
                <span>캡처 붙여넣기 · 이미지 추가</span>
              </div>
              <div
                ref={editor}
                dangerouslySetInnerHTML={{ __html: initialNoteHTML }}
                className="note-editor"
                contentEditable={!saving}
                aria-busy={preparingImages || undefined}
                suppressContentEditableWarning
                role="textbox"
                aria-label="메모 내용"
                aria-multiline="true"
                onInput={() => setNoteDirty(true)}
                onPaste={(e) => {
                  e.preventDefault();
                  if (preparingImages || saving) return;
                  const files = [...e.clipboardData.items]
                    .filter(
                      (item) =>
                        item.kind === "file" && item.type.startsWith("image/"),
                    )
                    .map((item) => item.getAsFile())
                    .filter(Boolean);
                  if (files.length) {
                    pasteImages(files, selectionRange());
                    return;
                  }
                  const html = e.clipboardData.getData("text/html");
                  if (html) pasteHTML(html, selectionRange());
                  else
                    format("insertText", e.clipboardData.getData("text/plain"));
                }}
                onDrop={(e) => {
                  const images = [...e.dataTransfer.files].filter((file) =>
                    file.type.startsWith("image/"),
                  );
                  if (images.length) {
                    e.preventDefault();
                    pasteImages(images, selectionRange());
                  }
                }}
                onClick={(e) => {
                  if (
                    e.target.matches("img[data-daynote-image]") &&
                    e.target.src
                  ) {
                    e.preventDefault();
                    setViewer({
                      image: e.target,
                      src: e.target.src,
                      native: false,
                    });
                    return;
                  }
                  const link = e.target.closest("a");
                  if (link && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    if (/^https?:\/\//.test(link.href))
                      window.open(link.href, "_blank", "noopener,noreferrer");
                  }
                }}
              />
            </section>
            <section className="checklist-section">
              <h3>
                <CheckCheck size={16} />
                체크리스트{" "}
                <span>
                  {checklist.filter((x) => x.done).length}/{checklist.length}
                </span>
              </h3>
              <div className="checklist-items">
                {checklist.map((item) => (
                  <div
                    key={item.id}
                    className={
                      "checklist-item " +
                      (item.variant === "header" ? "checklist-header" : "")
                    }
                    style={{
                      paddingLeft: Math.min(item.indent || 0, 2) * 16 + "px",
                    }}
                  >
                    {item.variant !== "header" && (
                      <input
                        aria-label={item.text + " 완료 상태"}
                        type="checkbox"
                        checked={item.done}
                        onChange={(e) =>
                          checklistUpdate(item.id, { done: e.target.checked })
                        }
                      />
                    )}
                    <input
                      aria-label="체크리스트 항목"
                      className={item.done ? "crossed" : ""}
                      value={item.text}
                      onChange={(e) =>
                        checklistUpdate(item.id, { text: e.target.value })
                      }
                    />
                    {item.highlighted && <span title="중요 항목">★</span>}
                    <button
                      type="button"
                      className="icon-button small"
                      aria-label={item.text + " 삭제"}
                      onClick={() =>
                        setChecklist((xs) => xs.filter((x) => x.id !== item.id))
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="add-checklist">
                <Plus size={15} />
                <input
                  aria-label="체크리스트 추가"
                  placeholder="체크리스트 항목 추가"
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addItem();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={addItem}
                  disabled={!newItem.trim()}
                >
                  추가
                </button>
              </div>
            </section>
            <details className="task-options">
              <summary>
                <CalendarDays size={16} />
                <span>일정 설정</span>
                <small>
                  {date || "날짜 없음"}
                  {freq ? " · " + FREQUENCIES[freq] : ""}
                </small>
              </summary>
              <div className="detail-fields">
                <label>
                  <CalendarDays size={16} />
                  <span>날짜</span>
                  <input
                    aria-label="할 일 날짜"
                    type="date"
                    disabled={!!task.freq && scope === "series"}
                    value={date}
                    onInput={(e) => {
                      setDate(e.currentTarget.value);
                      if (e.currentTarget.value) setListId("");
                    }}
                    onChange={(e) => {
                      setDate(e.target.value);
                      if (e.target.value) setListId("");
                    }}
                  />
                </label>
                <label>
                  <FileText size={16} />
                  <span>캘린더</span>
                  <select
                    aria-label="할 일 캘린더"
                    disabled={!!task.freq}
                    value={calendarId}
                    onChange={(e) => {
                      setCalendarId(e.target.value);
                      if (!date) setListId("");
                    }}
                  >
                    {calendars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                {!date && (
                  <label>
                    <List size={16} />
                    <span>목록</span>
                    <select
                      aria-label="할 일 목록"
                      value={listId}
                      onChange={(e) => setListId(e.target.value)}
                    >
                      <option value="">목록을 선택해 주세요</option>
                      {cal?.lists?.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  <Repeat2 size={16} />
                  <span>반복</span>
                  <select
                    aria-label="반복 주기"
                    disabled={!!task.freq && scope === "single"}
                    value={freq}
                    onChange={(e) => setFreq(Number(e.target.value))}
                  >
                    {Object.entries(FREQUENCIES).map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {freq === 7 && (
                  <label className="rrule-field">
                    <span>반복 규칙</span>
                    <input
                      aria-label="사용자 지정 반복 규칙"
                      disabled={!!task.freq && scope === "single"}
                      value={recurrence}
                      onChange={(e) => setRecurrence(e.target.value)}
                      placeholder="RRULE:FREQ=WEEKLY;BYDAY=MO,WE"
                    />
                  </label>
                )}
                {!!task.freq && (
                  <label>
                    <Repeat2 size={16} />
                    <span>적용 범위</span>
                    <select
                      aria-label="반복 일정 수정 범위"
                      value={scope}
                      onChange={(e) => setScope(e.target.value)}
                    >
                      <option value="single">이 일정만</option>
                      <option value="series">연결된 반복 일정 전체</option>
                    </select>
                  </label>
                )}
                {!!task.freq && (
                  <p className="recurrence-help">
                    {scope === "single"
                      ? "이 날짜의 일정만 바꿔요. 반복 주기를 바꾸려면 적용 범위를 전체로 선택해 주세요."
                      : "연결된 일정의 내용과 반복 주기를 함께 바꿔요. 날짜와 완료 상태는 각 일정에서 바꿀 수 있어요."}
                  </p>
                )}
                <div className="color-field">
                  <span>색상</span>
                  <div className="color-options">
                    {Object.entries(COLORS).map(([key, value]) => (
                      <button
                        type="button"
                        className={
                          "color-option " + (color === key ? "selected" : "")
                        }
                        key={key}
                        style={{ background: value }}
                        aria-label={COLOR_NAMES[key]}
                        aria-pressed={color === key}
                        onClick={() => setColor(key)}
                      >
                        {color === key && (
                          <Check
                            size={13}
                            style={{
                              color: key === "black" ? "#fff" : "#425e4c",
                            }}
                          />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {task.notifyAt && (
                <div className="subtle-info">
                  <Info size={15} /> 기존 알림:{" "}
                  {new Date(task.notifyAt).toLocaleString("ko-KR")} · 이 버전은
                  푸시 알림을 발송하지 않아요.
                </div>
              )}
            </details>
          </div>
          <footer className="modal-footer">
            <button
              type="button"
              className="danger-text"
              onClick={remove}
              disabled={saving}
            >
              <Trash2 size={16} />
              휴지통으로
            </button>
            <div>
              <button type="button" className="secondary" onClick={close}>
                취소
              </button>
              <button className="primary" disabled={saving || preparingImages}>
                {saving ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <Check size={16} />
                )}
                저장
              </button>
            </div>
          </footer>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      </Modal>
      {viewer && (
        <Modal
          title="캡처 이미지"
          onClose={() => setViewer(null)}
          className="image-viewer"
        >
          <div
            className={
              "image-viewer-canvas" + (viewer.native ? " native-size" : "")
            }
            tabIndex={0}
            aria-label="캡처 이미지 보기"
          >
            <img src={viewer.src} alt="캡처 이미지" />
          </div>
          <footer className="modal-footer">
            <button
              type="button"
              className="danger-text"
              onClick={() => {
                viewer.image.remove();
                setNoteDirty(true);
                setViewer(null);
              }}
            >
              메모에서 제거
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setViewer((value) => ({ ...value, native: !value.native }))
              }
            >
              <ZoomIn size={15} />
              {viewer.native ? "화면에 맞추기" : "원본 크기"}
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}
