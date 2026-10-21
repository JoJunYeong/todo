import React, { useState, useEffect, useRef } from "react";
import {
  FileText,
  Download,
  Upload,
  ShieldCheck,
  Users,
  Search,
  Loader2,
  CheckCircle2,
  KeyRound,
  Info,
  LockKeyhole,
} from "lucide-react";
import { Modal } from "./main.jsx";
import { dateKey, parseBackup, backupStats } from "./domain.js";
import { changePassword, authMessage } from "./auth.js";

const download = (name, data) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export function Preferences({
  profile,
  uid,
  store,
  tasks,
  calendars,
  onClose,
  notify,
  onImported,
}) {
  const [tab, setTab] = useState("general"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [name, setName] = useState(profile.displayName),
    [pending, setPending] = useState(null),
    [progress, setProgress] = useState(null),
    [passwords, setPasswords] = useState({ current: "", next: "", repeat: "" });
  const fileRef = useRef();
  const run = async (fn, msg) => {
    setError("");
    setBusy(true);
    try {
      await fn();
      if (msg) notify(msg);
    } catch (e) {
      setError(authMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const exportData = () =>
    run(async () => {
      const data = await store.exportBackup(uid);
      download("daynote-" + profile.username + "-" + dateKey() + ".json", data);
    }, "백업 파일을 내려받았어요.");
  async function selectFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    try {
      if (file.size > 100 * 1024 * 1024)
        throw Error("100MB 이하의 JSON 파일을 선택해 주세요.");
      const raw = JSON.parse(await file.text()),
        data = parseBackup(raw);
      setPending({ raw, data, name: file.name, stats: backupStats(data) });
    } catch (e) {
      setError(e.message);
    }
  }
  const importData = () =>
    run(async () => {
      setProgress({
        written: 0,
        total:
          pending.data.tasks.length +
          pending.data.calendars.length +
          (pending.data.noteImages?.length || 0),
      });
      const receipt = await store.importBackup(uid, pending.raw, setProgress);
      download("daynote-import-receipt-" + dateKey() + ".json", receipt);
      notify(
        `항목 ${receipt.counts.tasks.toLocaleString()}개를 가져오고 서버에서 대조했어요.`,
      );
      onImported(pending.data.calendars[0].id);
    }, null);
  return (
    <Modal
      title="설정 및 백업"
      onClose={() => {
        if (!busy) onClose();
      }}
      className="settings-modal"
    >
      <div className="settings-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "general"}
          onClick={() => setTab("general")}
        >
          내 계정
        </button>
        <button
          role="tab"
          aria-selected={tab === "backup"}
          onClick={() => setTab("backup")}
        >
          데이터 및 백업
        </button>
        <button
          role="tab"
          aria-selected={tab === "password"}
          onClick={() => setTab("password")}
        >
          비밀번호
        </button>
      </div>
      <div className="settings-body">
        {tab === "general" ? (
          <>
            <div className="settings-intro">
              <ShieldCheck size={28} />
              <h2>나만의 작은 작업 공간</h2>
              <p>아이디별로 캘린더와 메모가 독립적으로 저장돼요.</p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () =>
                    store.updateUser(uid, {
                      displayName: name.trim() || profile.username,
                    }),
                  "이름을 변경했어요.",
                );
              }}
            >
              <label>
                아이디
                <input value={profile.username} disabled />
              </label>
              <label>
                이름
                <input
                  aria-label="표시 이름"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  required
                />
              </label>
              <button className="primary" disabled={busy}>
                변경사항 저장
              </button>
            </form>
            <div className="auto-rollover-setting">
              <label>
                <input
                  type="checkbox"
                  aria-label="미완료 할 일 자동 넘김"
                  checked={profile.settings?.autoRollover !== false}
                  disabled={busy}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    run(
                      () =>
                        store.updateUser(uid, {
                          "settings.autoRollover": enabled,
                        }),
                      enabled
                        ? "미완료 할 일을 다음 날로 넘겨요."
                        : "할 일의 날짜를 그대로 유지해요.",
                    );
                  }}
                />
                미완료 할 일 자동 넘김
              </label>
              <p>
                2026년 10월 21일 이후의 일반 일정부터 적용해요. 접속 중 날짜가
                바뀌거나 다음에 접속하면 오늘로 옮겨요. 반복 일정은 기존 주기를
                유지해요.
              </p>
            </div>
            <div className="account-summary">
              <div>
                <b>{calendars.length}</b>
                <span>캘린더</span>
              </div>
              <div>
                <b>{tasks.filter((t) => !t.deleted).length.toLocaleString()}</b>
                <span>보관된 항목</span>
              </div>
              <div>
                <b>
                  {tasks
                    .filter((t) => t.note && !t.deleted)
                    .length.toLocaleString()}
                </b>
                <span>메모</span>
              </div>
            </div>
            <div className="subtle-info">
              <Info size={15} />
              <span>
                PC, 태블릿, 휴대폰에서 같은 아이디로 접속하면 동기화돼요. 공유
                기기에서는 사용 후 로그아웃해 주세요.
              </span>
            </div>
          </>
        ) : tab === "backup" ? (
          <>
            <div className="settings-intro">
              <FileText size={28} />
              <h2>내 데이터는 언제든 꺼내 쓸 수 있게</h2>
              <p>메모·이미지·체크리스트·반복 설정을 포함한 JSON 백업이에요.</p>
            </div>
            <div className="backup-action">
              <div>
                <h3>전체 데이터 내보내기</h3>
                <p>삭제 표시를 포함해 서버에 저장된 모든 항목을 내려받아요.</p>
              </div>
              <button
                className="secondary"
                onClick={exportData}
                disabled={busy}
              >
                <Download size={16} />
                내보내기
              </button>
            </div>
            <div className="backup-action">
              <div>
                <h3>백업에서 가져오기</h3>
                <p>기존 항목을 덮어쓰지 않고 새 항목을 추가해요.</p>
              </div>
              <button
                className="secondary"
                onClick={() => fileRef.current.click()}
                disabled={busy}
              >
                <Upload size={16} />
                파일 선택
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                aria-label="백업 파일"
                onChange={selectFile}
                hidden
              />
            </div>
            {pending && (
              <section className="import-preview">
                <h3>{pending.name}</h3>
                <p>
                  캘린더 {pending.stats.calendars}개 · 항목{" "}
                  {pending.stats.tasks.toLocaleString()}개
                </p>
                <p>
                  메모 {pending.stats.notes.toLocaleString()}개 · 체크리스트{" "}
                  {pending.stats.checklists}개
                  {!!pending.stats.images &&
                    ` · 이미지 ${pending.stats.images}개`}
                </p>
                <div className="subtle-info">
                  <ShieldCheck size={16} />
                  가져온 뒤 모든 원본 필드를 서버 데이터와 대조해요.
                </div>
                {progress && busy && (
                  <>
                    <progress value={progress.written} max={progress.total} />
                    <p aria-live="polite">
                      {progress.written.toLocaleString()} /{" "}
                      {progress.total.toLocaleString()}개 저장 중…
                    </p>
                  </>
                )}
                <button
                  className="primary"
                  onClick={importData}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <Upload size={16} />
                  )}
                  가져오기 시작
                </button>
              </section>
            )}
            <p className="settings-caption">
              Tweek 자료는 공식 API로 내보낸 전체 백업을 지원해요. 브라우저에
              보이는 한 주만 가져오는 방식이 아니에요.
            </p>
          </>
        ) : (
          <>
            <div className="settings-intro">
              <KeyRound size={28} />
              <h2>비밀번호 변경</h2>
              <p>현재 비밀번호를 확인한 뒤 새 비밀번호로 바꿔요.</p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (passwords.next !== passwords.repeat) {
                  setError("새 비밀번호가 서로 달라요.");
                  return;
                }
                run(async () => {
                  await changePassword(passwords.current, passwords.next);
                  setPasswords({ current: "", next: "", repeat: "" });
                }, "비밀번호를 변경했어요.");
              }}
            >
              <label>
                현재 비밀번호
                <input
                  type="password"
                  aria-label="현재 비밀번호"
                  autoComplete="current-password"
                  value={passwords.current}
                  onChange={(e) =>
                    setPasswords({ ...passwords, current: e.target.value })
                  }
                  required
                />
              </label>
              <label>
                새 비밀번호
                <input
                  type="password"
                  aria-label="새 비밀번호"
                  autoComplete="new-password"
                  value={passwords.next}
                  onChange={(e) =>
                    setPasswords({ ...passwords, next: e.target.value })
                  }
                  minLength={8}
                  required
                />
              </label>
              <label>
                새 비밀번호 확인
                <input
                  type="password"
                  aria-label="새 비밀번호 확인"
                  autoComplete="new-password"
                  value={passwords.repeat}
                  onChange={(e) =>
                    setPasswords({ ...passwords, repeat: e.target.value })
                  }
                  minLength={8}
                  required
                />
              </label>
              <button className="primary" disabled={busy}>
                비밀번호 변경
              </button>
            </form>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

export function Admin({ currentUid, store, onClose, notify }) {
  const [users, setUsers] = useState([]),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(null),
    [loaded, setLoaded] = useState(false);
  useEffect(
    () =>
      store.watchUsers(
        (u) => {
          setUsers(u);
          setLoaded(true);
        },
        (e) => setError(authMessage(e)),
      ),
    [store],
  );
  async function toggle(u) {
    if (
      !confirm(
        `${u.username} 계정의 사용을 ${u.active ? "중지" : "허용"}할까요?`,
      )
    )
      return;
    setBusy(u.id);
    try {
      await store.updateUser(u.id, { active: !u.active });
      notify("계정 상태를 변경했어요.");
    } catch (e) {
      setError(authMessage(e));
    } finally {
      setBusy(null);
    }
  }
  const filtered = users.filter((u) =>
    [u.username, u.displayName].some((x) =>
      x.toLowerCase().includes(query.toLowerCase()),
    ),
  );
  return (
    <Modal title="관리자 · 기본 관리" onClose={onClose} className="admin-modal">
      <div className="settings-body">
        <div className="settings-intro">
          <ShieldCheck size={28} />
          <h2>작업 공간 관리</h2>
          <p>
            계정 상태를 관리해요. 다른 사용자의 일정과 메모는 열람하지 않아요.
          </p>
        </div>
        <div className="admin-stats">
          <div>
            <Users size={18} />
            <strong>{users.length}</strong>
            <span>전체 계정</span>
          </div>
          <div>
            <CheckCircle2 size={18} />
            <strong>{users.filter((u) => u.active).length}</strong>
            <span>사용 중</span>
          </div>
          <div>
            <LockKeyhole size={18} />
            <strong>{users.filter((u) => !u.active).length}</strong>
            <span>사용 중지</span>
          </div>
        </div>
        <div className="search-field admin-search">
          <Search size={16} />
          <input
            aria-label="사용자 검색"
            placeholder="아이디 또는 이름 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {!loaded && !error && <p>사용자 목록을 불러오고 있어요…</p>}
        <div className="admin-user-list">
          {filtered.map((u) => (
            <article className="admin-user" key={u.id}>
              <span className="avatar">{u.displayName.slice(0, 1)}</span>
              <div className="admin-user-info">
                <strong>
                  {u.displayName} {u.id === currentUid && <small>나</small>}
                </strong>
                <span>@{u.username}</span>
                <small>
                  최근 접속{" "}
                  {u.lastSeenAt
                    ? new Date(u.lastSeenAt).toLocaleDateString("ko-KR")
                    : "기록 없음"}
                </small>
              </div>
              <span className={"status-pill " + (u.active ? "active" : "")}>
                {u.active ? "사용 중" : "중지"}
              </span>
              {u.id !== currentUid && (
                <button
                  className="secondary"
                  disabled={busy === u.id}
                  onClick={() => toggle(u)}
                >
                  {u.active ? "사용 중지" : "사용 허용"}
                </button>
              )}
            </article>
          ))}
        </div>
        <div className="subtle-info">
          <ShieldCheck size={16} />
          <span>
            관리 권한은 화면의 표시 여부와 별도로 DB 보안 규칙에서 확인해요.
            사용 중지된 계정은 저장된 데이터에 접근할 수 없어요.
          </span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
