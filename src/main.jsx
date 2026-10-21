import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  lazy,
  Suspense,
  startTransition,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  Plus,
  Search,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowUpRight,
  SlidersHorizontal,
  LogOut,
  Menu,
  X,
  Settings,
  Sun,
  CheckCheck,
  FileText,
  Repeat2,
  ListChecks,
  MoreHorizontal,
  Inbox,
  ShieldCheck,
  Cloud,
  CloudOff,
  Trash2,
  ArrowLeft,
  Download,
  Upload,
  Loader2,
  ArrowRight,
  CornerDownLeft,
  Leaf,
  LayoutGrid,
  CheckCircle2,
} from "lucide-react";
import {
  dateKey,
  monday,
  addDays,
  expandWeek,
  buildSearchIndex,
  searchTasks,
  WEEKDAYS,
  COLORS,
  htmlText,
  authEmail,
} from "./domain.js";
import "./style.css";
import "./planner.css";
import { useHolidays } from "./use-holidays.js";
import { useRollover } from "./use-rollover.js";
import {
  readWeekPreview,
  saveWeekPreview,
  makeWeekPreview,
  rememberSession,
  hasRememberedSession,
  previewStorage,
} from "./preview-cache.js";

let detailsLoad;
const loadDetails = () =>
  (detailsLoad ||= import("./details.jsx").catch((error) => {
    detailsLoad = null;
    throw error;
  }));
const warmDetails = () => {
  loadDetails().catch(() => {});
};
const Details = lazy(() => loadDetails().then((m) => ({ default: m.Details })));
const Preferences = lazy(() =>
  import("./panels.jsx").then((m) => ({ default: m.Preferences })),
);
const Admin = lazy(() =>
  import("./panels.jsx").then((m) => ({ default: m.Admin })),
);
let authModule, storeModule, authLoad, storeLoad;
const loadAuth = () =>
  authModule
    ? Promise.resolve(authModule)
    : (authLoad ||= import("./auth.js").then((m) => (authModule = m)));
const loadStore = () =>
  storeModule
    ? Promise.resolve(storeModule)
    : (storeLoad ||= import("./store.js").then((m) => (storeModule = m)));

export function Modal({ title, onClose, children, className = "" }) {
  const box = useRef();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const timer = setTimeout(
      () =>
        box.current
          ?.querySelector('input,textarea,button,[tabindex="0"]')
          ?.focus(),
      20,
    );
    const key = (e) => {
      if (box.current !== [...document.querySelectorAll(".modal")].at(-1))
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === "Tab") {
        const all = [
          ...box.current.querySelectorAll(
            'button:not(:disabled),input:not(:disabled),textarea,select,[tabindex="0"],[contenteditable="true"]',
          ),
        ].filter((x) => x.getClientRects().length);
        if (!all.length) return;
        const first = all[0],
          last = all.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", key, true);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        ref={box}
        className={"modal " + className}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header">
          <span>{title}</span>
          <button className="icon-button" aria-label="닫기" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Check size={21} strokeWidth={2.6} />
      </span>
      <span>
        daynote<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
function Spinner({ label = "불러오는 중…" }) {
  return (
    <div className="loading">
      <Loader2 className="spin" size={20} />
      <span>{label}</span>
    </div>
  );
}

function Login({ ready }) {
  const [mode, setMode] = useState("login"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const values = new FormData(e.currentTarget);
    try {
      const auth = await loadAuth();
      if (mode === "login")
        await auth.login(values.get("username"), values.get("password"));
      else
        await auth.register(
          values.get("username"),
          values.get("password"),
          values.get("displayName"),
        );
    } catch (e) {
      setError(authModule?.authMessage(e) || e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-art">
        <Brand />
        <div className="art-copy">
          <span className="eyebrow">A LITTLE SPACE FOR YOUR EVERYDAY</span>
          <h1>
            하루는 가볍게.
            <br />한 주는 한눈에.
          </h1>
          <p>
            해야 할 일부터 문득 떠오른 생각까지.
            <br />
            나의 속도대로 채워가는 작은 여백.
          </p>
        </div>
        <div className="paper-preview" aria-hidden="true">
          <div className="paper-top">
            <span>MY LITTLE WEEK</span>
            <span>→</span>
          </div>
          <div className="paper-days">
            <div>
              <b>
                MON <span>19</span>
              </b>
              <p className="scribble crossed">새로운 한 주 시작하기</p>
              <p className="scribble marker">가장 중요한 일 하나</p>
              <p className="scribble">산책하며 생각 정리</p>
              <div className="paper-lines" />
            </div>
            <div>
              <b>
                TUE <span>20</span>
              </b>
              <p className="scribble">커피 한 잔의 여유</p>
              <p className="scribble green-marker">차근차근, 내 페이스로</p>
              <div className="paper-lines" />
            </div>
          </div>
          <div className="paper-flower">
            <Leaf size={37} />
          </div>
        </div>
        <span className="art-foot">LESS NOISE. MORE ROOM FOR YOU.</span>
      </div>
      <main className="login-form-area">
        <div className="mobile-brand">
          <Brand />
        </div>
        <div className="login-form">
          <span className="eyebrow">YOUR WEEK, YOUR WAY</span>
          <h2>
            {mode === "login"
              ? "반가워요, 다시."
              : "나만의 여백을 만들어 볼까요?"}
          </h2>
          <p>
            {mode === "login"
              ? "오늘의 생각과 할 일이 기다리고 있어요."
              : "아이디마다 독립된 캘린더와 메모가 생겨요."}
          </p>
          <form onSubmit={submit}>
            {mode === "register" && (
              <label>
                이름
                <input
                  name="displayName"
                  autoComplete="name"
                  maxLength={100}
                  placeholder="어떻게 불러드릴까요?"
                  required
                />
              </label>
            )}
            <label>
              아이디
              <input
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck="false"
                placeholder="아이디를 입력해 주세요"
                pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}"
                minLength={3}
                maxLength={32}
                required
              />
            </label>
            <label>
              비밀번호
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                placeholder={
                  mode === "login"
                    ? "비밀번호를 입력해 주세요"
                    : "8자 이상으로 입력해 주세요"
                }
                minLength={mode === "register" ? 8 : 1}
                required
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="primary login-submit"
              disabled={busy || !ready}
            >
              {busy ? (
                <Loader2 className="spin" size={18} />
              ) : (
                <>
                  {mode === "login" ? "로그인" : "계정 만들기"}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="login-switch">
            {mode === "login" ? "처음 오셨나요?" : "이미 계정이 있나요?"}{" "}
            <button
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
              }}
            >
              {mode === "login" ? "계정 만들기" : "로그인"}
            </button>
          </div>
          <p className="login-small">
            <ShieldCheck size={14} /> 나의 일정은 내 계정에서만 볼 수 있어요.
          </p>
        </div>
        <footer>작은 계획이 모여, 나다운 하루.</footer>
      </main>
    </div>
  );
}

function TaskCard({
  task,
  onOpen,
  onToggle,
  onDrop,
  compact = false,
  pending = false,
}) {
  return (
    <div
      className={
        "task-card " +
        (task.done ? "is-done " : "") +
        (task.color === "black" ? "dark-task " : "") +
        (compact ? "compact " : "") +
        (pending ? "preview-card " : "")
      }
      style={{ "--task-color": COLORS[task.color] || task.color || "#fff" }}
      draggable={!pending}
      aria-busy={pending || undefined}
      onDragStart={(e) => {
        e.dataTransfer.setData("application/daynote", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.stopPropagation();
        onDrop?.(e, task);
      }}
    >
      <button
        className="task-checkbox"
        role="checkbox"
        aria-checked={task.done}
        aria-label={(task.done ? "완료 취소: " : "완료: ") + task.text}
        disabled={pending}
        onClick={() => onToggle(task)}
      >
        {task.done && <Check size={13} />}
      </button>
      <button
        className="task-open"
        onPointerEnter={warmDetails}
        onPointerDown={warmDetails}
        onFocus={warmDetails}
        disabled={pending}
        onClick={() => onOpen(task)}
      >
        <span className="task-title">{task.text || "제목 없는 할 일"}</span>
        <span className="task-meta">
          {task.isoDate && (
            <span>
              {new Date(task.isoDate).toLocaleTimeString("ko-KR", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </span>
          )}
          {(task.note || task.hasNote) && (
            <FileText size={12} aria-label="메모 있음" />
          )}
          {!!task.checklist?.length && (
            <span>
              <ListChecks size={13} />
              {task.checklist.filter((x) => x.done).length}/
              {task.checklist.length}
            </span>
          )}
          {!!task.freq && <Repeat2 size={12} aria-label="반복 일정" />}
        </span>
      </button>
    </div>
  );
}
function QuickAdd({ label, onAdd }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) {
          onAdd(value.trim());
          setValue("");
        }
      }}
    >
      <Plus size={15} />
      <input
        aria-label={label}
        placeholder="할 일 추가"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={10000}
      />
      <button aria-label={label + " 저장"} disabled={!value.trim()}>
        <CornerDownLeft size={13} />
      </button>
    </form>
  );
}

function Planner({ user, profile, isAdmin, store, notify }) {
  const [preview] = useState(() => readWeekPreview(previewStorage(), user.uid));
  const [today, setToday] = useState(dateKey);
  const [start, setStart] = useState(monday()),
    [selectedDay, setSelectedDay] = useState(today),
    [tasks, setTasks] = useState([]),
    [calendars, setCalendars] = useState(preview?.calendars || []),
    [calId, setCalId] = useState(
      profile.settings?.selectedCalendarId || preview?.calendarId || "",
    ),
    [loaded, setLoaded] = useState(false),
    [sync, setSync] = useState({ cached: true, pending: false }),
    [view, setView] = useState("week"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [sidebarOpen, setSidebarOpen] = useState(false),
    [panel, setPanel] = useState(null),
    [activeTask, setActiveTask] = useState(null),
    [online, setOnline] = useState(navigator.onLine),
    [dataError, setDataError] = useState("");
  const [hideCompleted, setHideCompleted] = useState(
      !!profile.settings?.hideCompleted,
    ),
    [searchLimit, setSearchLimit] = useState(60);
  const holidays = useHolidays(start, online);
  const rolloverError = useRollover({
    uid: user.uid,
    store,
    tasks: tasks.filter((task) => task.id !== activeTask?.id),
    today,
    ready: loaded && !sync.cached && !sync.pending && online,
    enabled: profile.settings?.autoRollover !== false,
  });
  useEffect(() => {
    const tick = () => setToday(dateKey());
    const timer = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  const previousToday = useRef(today);
  useEffect(() => {
    const previous = previousToday.current;
    if (
      previous !== today &&
      start === monday(previous) &&
      selectedDay === previous
    ) {
      setStart(monday(today));
      setSelectedDay(today);
    }
    previousToday.current = today;
  }, [today, start, selectedDay]);
  const init = useRef(false),
    inputSearch = useRef(),
    sidebarRef = useRef(),
    sidebarToggle = useRef(),
    contentRef = useRef();
  useEffect(() => {
    if (!sidebarOpen) return;
    const narrow = matchMedia("(max-width: 899px)"),
      previousOverflow = document.body.style.overflow;
    const setScroll = () => {
      document.body.style.overflow = narrow.matches
        ? "hidden"
        : previousOverflow;
      if (contentRef.current) contentRef.current.inert = narrow.matches;
      sidebarRef.current?.setAttribute(
        "role",
        narrow.matches ? "dialog" : "complementary",
      );
      if (narrow.matches)
        sidebarRef.current?.setAttribute("aria-modal", "true");
      else sidebarRef.current?.removeAttribute("aria-modal");
    };
    const key = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setSidebarOpen(false);
      }
      if (event.key === "Tab" && narrow.matches) {
        const controls = [
          ...sidebarRef.current.querySelectorAll(
            "button:not(:disabled),a[href]",
          ),
        ];
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    setScroll();
    sidebarRef.current?.querySelector("button")?.focus();
    narrow.addEventListener("change", setScroll);
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (contentRef.current) contentRef.current.inert = false;
      narrow.removeEventListener("change", setScroll);
      document.removeEventListener("keydown", key);
      sidebarToggle.current?.focus();
    };
  }, [sidebarOpen]);
  const error = useCallback(
    (e) => {
      setDataError(
        e.code === "permission-denied"
          ? "접근 권한을 확인할 수 없습니다. 계정 상태를 확인해 주세요."
          : e.message,
      );
      notify(authModule.authMessage(e), "error");
    },
    [notify],
  );
  useEffect(() => {
    const a = store.watchTasks(
        user.uid,
        (items, meta) => {
          startTransition(() => {
            setTasks(items);
            setSync(meta);
            if (!meta.cached || items.length) setLoaded(true);
          });
        },
        error,
      ),
      b = store.watchCalendars(
        user.uid,
        (items, meta) => {
          setCalendars(items);
          if (!items.length && !meta.cached && !init.current) {
            init.current = true;
            store.defaultCalendar(user.uid).catch(error);
          }
        },
        error,
      );
    return () => {
      a();
      b();
    };
  }, [user.uid, store, error]);
  useEffect(() => {
    if (calendars.length && !calendars.some((c) => c.id === calId))
      setCalId(calendars[0]?.id || "");
  }, [calendars, calId]);
  useEffect(() => {
    const yes = () => setOnline(true),
      no = () => setOnline(false);
    window.addEventListener("online", yes);
    window.addEventListener("offline", no);
    return () => {
      window.removeEventListener("online", yes);
      window.removeEventListener("offline", no);
    };
  }, []);
  useEffect(() => {
    const key = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k" && !panel && !activeTask) {
        e.preventDefault();
        setSidebarOpen(false);
        requestAnimationFrame(() => inputSearch.current?.focus());
        setView("search");
      }
      if (e.key === "Escape" && !panel && !activeTask) {
        setSidebarOpen(false);
        if (search) {
          setSearch("");
          setView("week");
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [panel, activeTask, search]);
  const previewActive =
    !loaded && preview?.start === start && preview?.calendarId === calId;
  const calendar = calendars.find((c) => c.id === calId),
    ownTasks = useMemo(
      () => tasks.filter((t) => t.calendarId === calId),
      [tasks, calId],
    ),
    week = useMemo(
      () => (previewActive ? preview.tasks : expandWeek(ownTasks, start)),
      [previewActive, preview, ownTasks, start],
    );
  const live = useMemo(() => ownTasks.filter((t) => !t.deleted), [ownTasks]),
    index = useMemo(
      () => (search ? buildSearchIndex(tasks) : []),
      [tasks, !!search],
    );
  const results = useMemo(
    () => searchTasks(index, search, { status: filter, limit: searchLimit }),
    [index, search, filter, searchLimit],
  );
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i)),
    completed = week.filter((t) => t.done).length,
    total = week.length;
  useEffect(() => {
    if (!loaded || !calId || !calendars.length) return;
    const timer = setTimeout(() => {
      const openingWeek = monday(today);
      saveWeekPreview(
        previewStorage(),
        makeWeekPreview(
          user.uid,
          calId,
          openingWeek,
          calendars,
          start === openingWeek ? week : expandWeek(ownTasks, openingWeek),
        ),
      );
    }, 200);
    return () => clearTimeout(timer);
  }, [loaded, user.uid, calId, start, calendars, week, ownTasks, today]);
  useEffect(() => {
    if (!loaded) return;
    if (window.requestIdleCallback) {
      const id = requestIdleCallback(warmDetails, { timeout: 1500 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(warmDetails, 200);
    return () => clearTimeout(id);
  }, [loaded]);
  const run = async (fn, message) => {
    try {
      await fn();
      if (message) notify(message);
    } catch (e) {
      error(e);
    }
  };
  const toggle = (t) => run(() => store.toggleTask(user.uid, t));
  const newTask = (text, place) =>
    run(() => store.addTask(user.uid, { text, calendarId: calId, ...place }));
  const openTask = (t) =>
    setActiveTask(
      !t.date && !t.listId && t.freq && t.dtStart
        ? { ...t, date: t.dtStart }
        : t,
    );
  const backlogProps = {
    calendar,
    live,
    hideCompleted,
    uid: user.uid,
    store,
    run,
    drop,
    openTask,
    toggle,
    newTask,
  };
  const changeView = (v) => {
    setView(v);
    setSidebarOpen(false);
    if (v !== "search") setSearch("");
  };
  const moveWeek = (n) => {
    const next = addDays(start, n * 7);
    setStart(next);
    setSelectedDay(addDays(selectedDay, n * 7));
  };
  function drop(event, date, listId = null, before = null) {
    event.preventDefault();
    const id = event.dataTransfer.getData("application/daynote"),
      task = week.find((t) => t.id === id) || tasks.find((t) => t.id === id);
    if (!task || task.id === before?.id) return;
    const peers = (
      date
        ? week.filter((t) => t.date === date)
        : live.filter((t) => t.listId === listId)
    ).sort((a, b) => (a.order || 0) - (b.order || 0));
    const at = before
      ? peers.findIndex((t) => t.id === before.id)
      : peers.length;
    const order =
      at === 0
        ? (peers[0]?.order || 0) - 1024
        : at === peers.length
          ? (peers.at(-1)?.order || Date.now()) + 1024
          : ((peers[at - 1].order || 0) + (peers[at].order || 0)) / 2;
    run(() => store.patchTask(user.uid, task, { date, listId, order }));
  }
  const logout = async () => {
    if (
      sync.pending &&
      !confirm("아직 동기화 중인 변경이 있어요. 로그아웃할까요?")
    )
      return;
    await authModule.logout();
  };
  const viewTitle =
    view === "search"
      ? "검색"
      : view === "trash"
        ? "휴지통"
        : view === "all"
          ? "전체 할 일"
          : view === "someday"
            ? "언젠가"
            : "나의 한 주";
  const sidebar = (
    <>
      <div className="sidebar-header">
        <Brand />
        <button
          className="icon-button"
          aria-label="사이드바 접기"
          onClick={() => setSidebarOpen(false)}
        >
          <X size={20} />
        </button>
      </div>
      <div className="workspace-label">내 일정</div>
      <nav aria-label="주 메뉴">
        <button
          className={view === "week" ? "nav-item active" : "nav-item"}
          onClick={() => changeView("week")}
        >
          <CalendarDays size={18} />
          <span>나의 한 주</span>
          <span className="nav-key">W</span>
        </button>
        <button
          className={view === "all" ? "nav-item active" : "nav-item"}
          onClick={() => changeView("all")}
        >
          <CheckCheck size={18} />
          <span>전체 할 일</span>
          <span className="nav-count">
            {live.filter((t) => !t.done && !t.recurringTodoId).length}
          </span>
        </button>
        <button
          className={view === "someday" ? "nav-item active" : "nav-item"}
          onClick={() => changeView("someday")}
        >
          <Inbox size={18} />
          <span>언젠가</span>
        </button>
      </nav>
      <div className="sidebar-section">
        <span>내 캘린더</span>
        <button
          className="icon-button small"
          aria-label="캘린더 추가"
          onClick={() => {
            const name = prompt("새 캘린더 이름");
            if (name?.trim())
              run(() =>
                store.saveCalendar(user.uid, {
                  id: crypto.randomUUID(),
                  name: name.trim().slice(0, 200),
                  order: calendars.length,
                  lists: [{ id: crypto.randomUUID(), name: "언젠가" }],
                }),
              );
          }}
        >
          <Plus size={15} />
        </button>
      </div>
      <div className="calendar-list">
        {calendars.map((c) => (
          <button
            key={c.id}
            className={"calendar-choice " + (calId === c.id ? "selected" : "")}
            onClick={() => {
              setCalId(c.id);
              run(() =>
                store.updateUser(user.uid, {
                  "settings.selectedCalendarId": c.id,
                }),
              );
              setSidebarOpen(false);
            }}
          >
            <span
              className="calendar-dot"
              style={{ background: c.color || "#71977e" }}
            />
            <span>{c.name}</span>
            {calId === c.id && <Check size={14} />}
          </button>
        ))}
      </div>
      <div className="sidebar-bottom">
        <button className="nav-item" onClick={() => changeView("trash")}>
          <Trash2 size={17} />
          <span>휴지통</span>
        </button>
        <button
          className="nav-item"
          onClick={() => {
            setSidebarOpen(false);
            setPanel("settings");
          }}
        >
          <Settings size={17} />
          <span>설정 및 백업</span>
        </button>
        {isAdmin && (
          <button
            className="nav-item"
            onClick={() => {
              setPanel("admin");
              setSidebarOpen(false);
            }}
          >
            <ShieldCheck size={17} />
            <span>관리자</span>
          </button>
        )}
        <div className="user-row">
          <span className="avatar">
            {(profile.displayName || profile.username).slice(0, 1)}
          </span>
          <div>
            <strong>{profile.displayName}</strong>
            <small>@{profile.username}</small>
          </div>
          <button
            className="icon-button"
            aria-label="로그아웃"
            onClick={logout}
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </>
  );
  return (
    <div className={"app-layout" + (sidebarOpen ? " sidebar-open" : "")}>
      {sidebarOpen && (
        <>
          <button
            className="sidebar-scrim"
            aria-label="사이드바 바깥에서 닫기"
            tabIndex={-1}
            onClick={() => setSidebarOpen(false)}
          />
          <aside
            className="sidebar"
            id="workspace-sidebar"
            aria-label="작업 공간 메뉴"
            ref={sidebarRef}
          >
            {sidebar}
          </aside>
        </>
      )}
      <div className="app-content" ref={contentRef}>
        <header className="topbar">
          <div className="topbar-left">
            <button
              ref={sidebarToggle}
              className="icon-button sidebar-toggle"
              aria-label={sidebarOpen ? "사이드바 접기" : "사이드바 펼치기"}
              aria-expanded={sidebarOpen}
              aria-controls="workspace-sidebar"
              onClick={() => setSidebarOpen((open) => !open)}
            >
              <Menu size={21} />
            </button>
            <h1 className="view-title">{viewTitle}</h1>
            <button
              className="calendar-switch"
              onClick={() => setSidebarOpen(true)}
              aria-label={"캘린더 선택: " + (calendar?.name || "나의 캘린더")}
            >
              <span>{calendar?.name || "나의 캘린더"}</span>
              <ChevronDown size={13} />
            </button>
          </div>
          <div className="topbar-right">
            {view === "week" && (
              <span
                className="completion-summary"
                aria-label={`이번 주 ${total}개 중 ${completed}개 완료`}
              >
                {completed}/{total} 완료
              </span>
            )}
            <div
              className={"sync-status " + (!online ? "offline" : "")}
              title={
                !online
                  ? "인터넷이 연결되면 저장 내용을 동기화해요."
                  : sync.pending
                    ? "서버에 변경사항을 저장하고 있어요."
                    : sync.cached
                      ? "저장된 내용을 표시하고 서버와 연결하고 있어요."
                      : "서버에 저장됐어요."
              }
            >
              {!online ? (
                <CloudOff size={15} />
              ) : sync.pending ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Cloud size={15} />
              )}
              <span>
                {!online
                  ? "오프라인"
                  : !loaded
                    ? "연결 중"
                    : sync.pending
                      ? "저장 중"
                      : sync.cached
                        ? "연결 중"
                        : "저장됨"}
              </span>
            </div>
            <button
              className="avatar top-avatar"
              aria-label="계정 설정"
              onClick={() => setPanel("settings")}
            >
              {profile.displayName.slice(0, 1)}
            </button>
          </div>
        </header>
        <main className="main-content">
          <section className="toolbar">
            <div className="week-controls">
              <button
                className="period-label"
                onClick={() =>
                  document.getElementById("date-picker").showPicker?.()
                }
              >
                <CalendarDays size={18} />
                <span>
                  {new Date(start + "T12:00:00").toLocaleDateString("ko-KR", {
                    year: "numeric",
                    month: "long",
                  })}
                </span>
                <ChevronDown size={15} />
                <input
                  id="date-picker"
                  type="date"
                  aria-label="날짜로 이동"
                  value={start}
                  onChange={(e) => {
                    if (e.target.value) {
                      setStart(monday(e.target.value));
                      setSelectedDay(e.target.value);
                      setView("week");
                    }
                  }}
                />
              </button>
              <div className="week-arrows">
                <button
                  className="icon-button"
                  aria-label="이전 주"
                  onClick={() => moveWeek(-1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  className="today-button"
                  onClick={() => {
                    setStart(monday());
                    setSelectedDay(today);
                    setView("week");
                  }}
                >
                  오늘
                </button>
                <button
                  className="icon-button"
                  aria-label="다음 주"
                  onClick={() => moveWeek(1)}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
            <div className="toolbar-actions">
              <div className="search-field">
                <Search size={16} />
                <input
                  ref={inputSearch}
                  aria-label="전체 일정 검색"
                  placeholder="일정·메모 검색"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSearchLimit(60);
                    setView(e.target.value ? "search" : "week");
                  }}
                />
                <kbd>⌘ K</kbd>
                {search && (
                  <button
                    className="icon-button small"
                    aria-label="검색 지우기"
                    onClick={() => {
                      setSearch("");
                      setView("week");
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <button
                className={"filter-button " + (hideCompleted ? "enabled" : "")}
                onClick={() => {
                  const next = !hideCompleted;
                  setHideCompleted(next);
                  run(() =>
                    store.updateUser(user.uid, {
                      "settings.hideCompleted": next,
                    }),
                  );
                }}
                aria-label={
                  hideCompleted ? "완료 항목 표시" : "완료 항목 숨기기"
                }
                aria-pressed={hideCompleted}
                title={hideCompleted ? "완료 항목 표시" : "완료 항목 숨기기"}
              >
                <SlidersHorizontal size={17} />
                <span>{hideCompleted ? "미완료만" : "완료 포함"}</span>
              </button>
            </div>
          </section>
          {dataError && (
            <div role="alert" className="form-error">
              {dataError}
            </div>
          )}
          {rolloverError && (
            <div role="status" className="form-error">
              {rolloverError}
            </div>
          )}
          {!loaded && !(previewActive && view === "week") ? (
            <div className="board-skeleton" aria-label="일정 불러오는 중">
              {days.map((d) => (
                <div key={d}>
                  <span />
                  <i />
                  <i />
                  <i />
                </div>
              ))}
            </div>
          ) : view === "week" ? (
            <>
              <div
                className="mobile-day-picker"
                role="tablist"
                aria-label="요일 선택"
              >
                {days.map((d, i) => (
                  <button
                    role="tab"
                    aria-selected={selectedDay === d}
                    key={d}
                    className={
                      (selectedDay === d ? "chosen " : "") +
                      (d === today ? "is-today " : "") +
                      (holidays.days[d] ? "is-holiday" : "")
                    }
                    aria-label={`${d} ${WEEKDAYS[i]}요일${holidays.days[d] ? " · " + holidays.days[d].join(" · ") : ""}`}
                    title={holidays.days[d]?.join(" · ")}
                    onClick={() => setSelectedDay(d)}
                  >
                    <span>{WEEKDAYS[i]}</span>
                    <strong>{Number(d.slice(-2))}</strong>
                    <i
                      className={
                        week.some((t) => t.date === d && !t.done)
                          ? "has-tasks"
                          : ""
                      }
                    />
                  </button>
                ))}
              </div>
              <div className="week-board">
                {days.map((day, i) => {
                  const items = week.filter(
                    (t) => t.date === day && (!hideCompleted || !t.done),
                  );
                  return (
                    <section
                      className={
                        "day-column " +
                        (day === today ? "today-column " : "") +
                        (day === selectedDay ? "selected-day " : "") +
                        (holidays.days[day] ? "holiday-column " : "") +
                        (i > 4 ? "weekend" : "")
                      }
                      key={day}
                      aria-label={
                        day +
                        " " +
                        WEEKDAYS[i] +
                        "요일" +
                        (holidays.days[day]
                          ? " · " + holidays.days[day].join(" · ")
                          : "")
                      }
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => drop(e, day)}
                    >
                      <header className="day-heading">
                        <div>
                          <span className="day-name">
                            {WEEKDAYS[i]}
                            <span className="day-full">요일</span>
                          </span>
                          {day === today && (
                            <span className="today-tag">TODAY</span>
                          )}
                        </div>
                        <div className="day-date-row">
                          <strong>{Number(day.slice(-2))}</strong>
                          <span>
                            {items.length
                              ? items.length + "개 할 일"
                              : "여유로운 하루"}
                          </span>
                        </div>
                        {holidays.days[day] && (
                          <p className="holiday-name">
                            {holidays.days[day].join(" · ")}
                          </p>
                        )}
                      </header>
                      <div className="day-tasks">
                        {items.map((t) => (
                          <TaskCard
                            key={t.id}
                            task={t}
                            onOpen={openTask}
                            pending={!loaded}
                            onToggle={toggle}
                            onDrop={(e, b) => drop(e, day, null, b)}
                          />
                        ))}
                        <QuickAdd
                          label={day + " 할 일 추가"}
                          onAdd={(text) => newTask(text, { date: day })}
                        />
                        {!items.length && (
                          <div className="day-empty">
                            <span>
                              오늘의 작은 계획을
                              <br />
                              남겨 보세요.
                            </span>
                          </div>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
              <div className="board-hint">
                <span>
                  <span className="tiny-dot" />{" "}
                  {new Date(start + "T12:00:00").getMonth() + 1}월{" "}
                  {Number(start.slice(-2))}일 —{" "}
                  {new Date(addDays(start, 6) + "T12:00:00").getMonth() + 1}월{" "}
                  {Number(addDays(start, 6).slice(-2))}일
                </span>
                <div
                  className="holiday-source"
                  title={`한국천문연구원 자료 · holidays.dist.be 제공${holidays.updatedAt ? " · 갱신 " + new Date(holidays.updatedAt).toLocaleString("ko-KR") : ""}`}
                >
                  <a
                    href="https://github.com/distbe/holidays#데이터-출처"
                    target="_blank"
                    rel="noreferrer"
                  >
                    한국 공휴일
                  </a>
                  <button
                    type="button"
                    onClick={holidays.refresh}
                    disabled={holidays.loading}
                    aria-label="공휴일 정보 새로고침"
                  >
                    {holidays.loading
                      ? "확인 중…"
                      : holidays.failed
                        ? holidays.available
                          ? "이전 정보 · 재시도"
                          : "불러오기 재시도"
                        : "새로고침"}
                  </button>
                </div>
                <span>
                  드래그해서 날짜와 순서를 바꿔 보세요{" "}
                  <ArrowUpRight size={12} />
                </span>
              </div>
              {loaded && <Backlogs {...backlogProps} />}
            </>
          ) : view === "someday" ? (
            <Backlogs {...backlogProps} />
          ) : view === "search" ? (
            <section className="results-section">
              <div className="results-header">
                <span>
                  {search
                    ? "검색 결과 " +
                      results.length +
                      (results.length === searchLimit ? "개 이상" : "개")
                    : "검색어를 입력해 주세요"}
                </span>
                <select
                  aria-label="검색 완료 상태"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">전체 상태</option>
                  <option value="open">미완료</option>
                  <option value="done">완료</option>
                </select>
              </div>
              {results.map((t) => (
                <div className="search-result" key={t.id}>
                  <TaskCard
                    task={t}
                    onOpen={openTask}
                    onToggle={toggle}
                    compact
                  />
                  <span className="result-placement">
                    {calendars.find((c) => c.id === t.calendarId)?.name} ·{" "}
                    {t.date ||
                      calendar?.lists?.find((l) => l.id === t.listId)?.name ||
                      "언젠가"}
                  </span>
                  {t.note && <p>{htmlText(t.note).slice(0, 180)}</p>}
                </div>
              ))}
              {search && !results.length && (
                <div className="empty-state">
                  <Search size={30} />
                  <h3>일치하는 항목이 없어요</h3>
                  <p>단어를 짧게 나누거나 다른 표현으로 검색해 보세요.</p>
                </div>
              )}
              {results.length === searchLimit && (
                <button
                  className="secondary more-results"
                  onClick={() => setSearchLimit((n) => n + 100)}
                >
                  결과 더 보기
                </button>
              )}
            </section>
          ) : (
            <section className="all-tasks">
              <div className="section-heading">
                <h2>{view === "trash" ? "삭제된 항목" : "모든 일정"}</h2>
                <span>
                  {
                    ownTasks.filter((t) =>
                      view === "trash" ? t.deleted : !t.deleted,
                    ).length
                  }
                  개
                </span>
              </div>
              {ownTasks
                .filter((t) =>
                  view === "trash"
                    ? t.deleted
                    : !t.deleted && (!hideCompleted || !t.done),
                )
                .sort((a, b) =>
                  (b.date || "9999").localeCompare(a.date || "9999"),
                )
                .slice(0, searchLimit)
                .map((t) => (
                  <div className="all-task-row" key={t.id}>
                    <span className="all-date">{t.date || "언젠가"}</span>
                    <TaskCard task={t} onOpen={openTask} onToggle={toggle} />
                    {view === "trash" && (
                      <button
                        className="secondary"
                        onClick={() =>
                          run(
                            () => store.restoreTask(user.uid, t),
                            "항목을 복원했어요.",
                          )
                        }
                      >
                        복원
                      </button>
                    )}
                  </div>
                ))}
              {ownTasks.filter((t) =>
                view === "trash" ? t.deleted : !t.deleted,
              ).length > searchLimit && (
                <button
                  className="secondary more-results"
                  onClick={() => setSearchLimit((n) => n + 100)}
                >
                  더 보기
                </button>
              )}
            </section>
          )}
          <footer className="page-footer">
            <span>조금 더 가벼운 하루, daynote.</span>
            <span>
              ONE THING AT A TIME <Leaf size={12} />
            </span>
          </footer>
        </main>
      </div>
      <Suspense
        fallback={
          activeTask ? (
            <Modal
              title="할 일 자세히"
              onClose={() => setActiveTask(null)}
              className="detail-modal"
            >
              <div className="detail-body" aria-busy="true">
                <h2 className="detail-loading-title">{activeTask.text}</h2>
                <section className="note-section">
                  <h3>메모</h3>
                  <div className="note-loading-preview">
                    {htmlText((activeTask.note || "").slice(0, 16000)) ||
                      "메모를 열고 있어요…"}
                  </div>
                </section>
              </div>
            </Modal>
          ) : (
            <div className="panel-loading">
              <Spinner />
            </div>
          )
        }
      >
        {activeTask && (
          <Details
            task={activeTask}
            calendars={calendars}
            uid={user.uid}
            store={store}
            onClose={() => setActiveTask(null)}
            notify={notify}
            onSaved={() => setActiveTask(null)}
          />
        )}{" "}
        {panel === "settings" && (
          <Preferences
            profile={profile}
            uid={user.uid}
            store={store}
            calendars={calendars}
            tasks={tasks}
            onClose={() => setPanel(null)}
            notify={notify}
            onImported={(id) => {
              setCalId(id);
              run(() =>
                store.updateUser(user.uid, {
                  "settings.selectedCalendarId": id,
                }),
              );
              setPanel(null);
              setView("week");
            }}
          />
        )}
        {panel === "admin" && isAdmin && (
          <Admin
            currentUid={user.uid}
            store={store}
            onClose={() => setPanel(null)}
            notify={notify}
          />
        )}
      </Suspense>
    </div>
  );
}

function Backlogs({
  calendar,
  live,
  hideCompleted,
  uid,
  store,
  run,
  drop,
  openTask,
  toggle,
  newTask,
}) {
  return (
    <section className="backlogs">
      <div className="section-heading">
        <div>
          <Inbox size={18} />
          <h2>언젠가, 여유가 생기면</h2>
          <span>당장 하지 않아도 괜찮아요</span>
        </div>
        <button
          className="text-button"
          onClick={() => {
            const name = prompt("새 목록 이름");
            if (name?.trim())
              run(() =>
                store.saveCalendar(uid, {
                  ...calendar,
                  lists: [
                    ...(calendar.lists || []),
                    {
                      id: crypto.randomUUID(),
                      name: name.trim().slice(0, 200),
                    },
                  ],
                }),
              );
          }}
        >
          <Plus size={15} />
          <span>목록 추가</span>
        </button>
      </div>
      <div className="backlog-grid">
        {(calendar?.lists || []).map((list, i) => {
          const items = live
            .filter((t) => t.listId === list.id && (!hideCompleted || !t.done))
            .sort((a, b) => (a.order || 0) - (b.order || 0));
          return (
            <section
              className="backlog-column"
              key={list.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => drop(e, null, list.id)}
            >
              <header>
                <span
                  className="list-dot"
                  style={{
                    background: ["#92a8ce", "#c9ab78", "#a2b697", "#bb9fbb"][
                      i % 4
                    ],
                  }}
                />
                <button
                  className="list-name"
                  title="목록 이름 바꾸기"
                  onClick={() => {
                    const name = prompt("목록 이름", list.name);
                    if (name?.trim())
                      run(() =>
                        store.saveCalendar(uid, {
                          ...calendar,
                          lists: calendar.lists.map((l) =>
                            l.id === list.id
                              ? { ...l, name: name.trim().slice(0, 200) }
                              : l,
                          ),
                        }),
                      );
                  }}
                >
                  {list.name}
                </button>
                <span className="list-count">{items.length}</span>
              </header>
              <div>
                {items.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onOpen={openTask}
                    onToggle={toggle}
                    onDrop={(e, b) => drop(e, null, list.id, b)}
                  />
                ))}
                <QuickAdd
                  label={list.name + " 할 일 추가"}
                  onAdd={(text) => newTask(text, { listId: list.id })}
                />
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
function App() {
  const [authReady, setAuthReady] = useState(false),
    [user, setUser] = useState(null),
    [profile, setProfile] = useState(null),
    [isAdmin, setAdmin] = useState(false),
    [store, setStore] = useState(null),
    [bootError, setBootError] = useState(""),
    [toast, setToast] = useState(null);
  const toastTimer = useRef(),
    notify = useCallback((message, type = "success") => {
      clearTimeout(toastTimer.current);
      setToast({ message, type });
      toastTimer.current = setTimeout(
        () => setToast(null),
        type === "error" ? 6500 : 3500,
      );
    }, []);
  useEffect(() => {
    let unsub,
      disposed = false;
    if (hasRememberedSession(previewStorage())) loadStore().catch(() => {});
    loadAuth()
      .then((a) => {
        if (disposed) return;
        unsub = a.watchAuth((u) => {
          rememberSession(previewStorage(), u?.uid);
          setUser(u);
          setAuthReady(true);
          if (!u) {
            setProfile(null);
            setAdmin(false);
            setStore(null);
          }
        });
      })
      .catch((e) => {
        setBootError(
          "로그인 서비스를 연결하지 못했어요. 인터넷 연결을 확인한 뒤 새로고침해 주세요.",
        );
        setAuthReady(true);
      });
    return () => {
      disposed = true;
      unsub?.();
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    let a,
      b,
      cancelled = false,
      creating = false,
      touched = false,
      touchTimer;
    loadStore()
      .then((s) => {
        if (cancelled) return;
        setStore(s);
        a = s.watchProfile(
          user.uid,
          (p, meta) => {
            if (cancelled) return;
            setProfile(p);
            if (!p && !meta?.cached && !creating) {
              creating = true;
              s.ensureProfile(user).catch(
                (e) => !cancelled && setBootError(authModule.authMessage(e)),
              );
            }
            if (
              p?.active &&
              !touched &&
              Date.now() - (p.lastSeenAt || 0) > 3600000
            ) {
              touched = true;
              touchTimer = setTimeout(
                () =>
                  s
                    .updateUser(user.uid, { lastSeenAt: Date.now() })
                    .catch(() => {}),
                2000,
              );
            }
            if (p && !p.active)
              notify(
                "이 계정의 사용이 중지됐어요. 관리자에게 확인해 주세요.",
                "error",
              );
          },
          (e) => setBootError(authModule.authMessage(e)),
        );
        b = s.watchAdmin(user.uid, setAdmin);
      })
      .catch((e) => setBootError(authModule.authMessage(e)));
    return () => {
      cancelled = true;
      a?.();
      b?.();
      clearTimeout(touchTimer);
    };
  }, [user?.uid, notify]);
  return (
    <>
      {bootError ? (
        <div className="fatal-error">
          <Brand />
          <h2>연결을 확인해 주세요</h2>
          <p role="alert">{bootError}</p>
          <button className="primary" onClick={() => location.reload()}>
            다시 연결
          </button>
          <button
            className="text-button"
            onClick={() => authModule?.logout().then(() => setBootError(""))}
          >
            로그아웃
          </button>
        </div>
      ) : !authReady ? (
        <Spinner label="로그인 상태를 확인하고 있어요…" />
      ) : !user ? (
        <Login ready={authReady} />
      ) : !profile || !store ? (
        <Spinner label="나의 작업 공간을 열고 있어요…" />
      ) : !profile.active ? (
        <div className="fatal-error">
          <ShieldCheck size={35} />
          <h2>사용이 중지된 계정이에요</h2>
          <p>관리자에게 계정 상태를 확인해 주세요.</p>
          <button className="primary" onClick={() => authModule.logout()}>
            로그아웃
          </button>
        </div>
      ) : (
        <Planner
          key={user.uid}
          user={user}
          profile={profile}
          isAdmin={isAdmin}
          store={store}
          notify={notify}
        />
      )}{" "}
      {toast && (
        <div className={"toast " + toast.type} role="status">
          {toast.type === "success" ? (
            <CheckCircle2 size={17} />
          ) : (
            <CloudOff size={17} />
          )}
          <span>{toast.message}</span>
          <button aria-label="알림 닫기" onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
}
class AppBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="fatal-error">
        <Brand />
        <h2>화면을 다시 열어 주세요</h2>
        <p>
          일시적인 오류가 발생했어요. 다시 불러오면 이어서 사용할 수 있어요.
        </p>
        <button className="primary" onClick={() => location.reload()}>
          다시 불러오기
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")).render(
  <AppBoundary>
    <App />
  </AppBoundary>,
);
