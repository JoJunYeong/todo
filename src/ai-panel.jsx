import React, { useEffect, useState } from "react";
import {
  listAiConnections,
  issueAiConnection,
  revokeAiConnection,
} from "./ai-access.js";
import { AI_PROMPT } from "./ai-prompt.js";
import "./ai.css";

function download(name, value, type = "application/json") {
  const url = URL.createObjectURL(
    new Blob(
      [
        typeof value === "string"
          ? value
          : JSON.stringify(value, null, 2) + "\n",
      ],
      { type },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function AiPanel({ uid, notify, onBusyChange }) {
  const [connections, setConnections] = useState([]),
    [issued, setIssued] = useState(null),
    [name, setName] = useState("나의 AI"),
    [write, setWrite] = useState(false),
    [days, setDays] = useState(90),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    listAiConnections(uid)
      .then((v) => {
        if (live) setConnections(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [uid]);
  async function run(fn) {
    setError("");
    setBusy(true);
    onBusyChange(true);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <section className="ai-panel" aria-label="AI 연결 설정">
      <div className="settings-intro">
        <h2>AI가 내 일정과 메모를 바로 다루게</h2>
        <p>
          AI별 연결 파일을 발급하고 필요한 권한만 허용하세요. Daynote 비밀번호를
          AI에 줄 필요가 없어요.
        </p>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const result = await issueAiConnection(uid, { name, write, days });
            setIssued(result);
            setConnections(await listAiConnections(uid));
            notify("AI 연결을 만들었어요. 연결 파일을 내려받아 주세요.");
          });
        }}
      >
        <label>
          연결 이름
          <input
            aria-label="AI 연결 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            disabled={busy}
          />
        </label>
        <label>
          허용할 작업
          <select
            aria-label="AI 연결 권한"
            value={write ? "write" : "read"}
            onChange={(e) => setWrite(e.target.value === "write")}
            disabled={busy}
          >
            <option value="read">조회만 허용</option>
            <option value="write">조회와 일정·메모 저장 허용</option>
          </select>
        </label>
        <label>
          유효 기간
          <select
            aria-label="AI 연결 유효 기간"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            disabled={busy}
          >
            {[7, 30, 90, 365].map((n) => (
              <option value={n} key={n}>
                {n}일
              </option>
            ))}
          </select>
        </label>
        <button className="primary" type="submit" disabled={busy || !!issued}>
          {busy ? "처리 중…" : "새 AI 연결 만들기"}
        </button>
      </form>
      {issued && (
        <section className="ai-issued" aria-label="발급한 AI 연결">
          <h3>연결 파일을 안전하게 보관하세요</h3>
          <p>
            이 파일을 받은 AI는 허용한 기간과 권한으로 내 데이터에 접근해요.
            파일은 이 화면에서만 내려받을 수 있어요. 공유 대화나 Git에 올리지
            마세요.
          </p>
          <button
            className="primary"
            onClick={() =>
              download("daynote-ai-credentials.json", issued.credentials)
            }
          >
            연결 파일 내려받기
          </button>
          <button className="secondary" onClick={() => setIssued(null)}>
            파일 보관 완료
          </button>
        </section>
      )}
      <div className="ai-instructions">
        <h3>AI 지침에 붙여 넣기</h3>
        <p>
          연결 파일은 AI 도구의 비밀 저장소에 따로 넣고 아래 지침을 복사하세요.
          셸·HTTP API 또는 MCP를 실행할 수 있는 AI에서 사용할 수 있어요.
        </p>
        <div className="ai-buttons">
          <button
            className="secondary"
            onClick={() =>
              run(async () => {
                await navigator.clipboard.writeText(AI_PROMPT);
                notify("AI 지침을 복사했어요.");
              })
            }
          >
            AI 지침 복사
          </button>
          <button
            className="secondary"
            onClick={() =>
              download(
                "daynote-ai-instructions.txt",
                AI_PROMPT,
                "text/plain;charset=utf-8",
              )
            }
          >
            지침 내려받기
          </button>
          <a
            href={`${import.meta.env.BASE_URL}ai-guide.html`}
            target="_blank"
            rel="noreferrer"
          >
            연결 방법 · API 안내
          </a>
        </div>
        <details>
          <summary>전체 지침 보기</summary>
          <pre>{AI_PROMPT}</pre>
        </details>
      </div>
      <h3>발급한 연결</h3>
      {!connections.length && <p>아직 발급한 연결이 없어요.</p>}
      <ul className="ai-connections">
        {connections.map((c) => (
          <li key={c.id}>
            <div>
              <strong>{c.name}</strong>
              <p>
                {c.revoked
                  ? "폐기됨"
                  : c.expiresAt <= Date.now()
                    ? "만료됨"
                    : c.scopes.includes("write")
                      ? "조회·저장 허용"
                      : "조회만 허용"}{" "}
                · {new Date(c.expiresAt).toLocaleDateString("ko-KR")}까지
              </p>
            </div>
            {!c.revoked && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await revokeAiConnection(uid, c.id);
                    setConnections(await listAiConnections(uid));
                    if (issued?.connection.id === c.id) setIssued(null);
                    notify(
                      "AI 연결을 폐기했어요. 해당 연결의 접근을 차단했어요.",
                    );
                  })
                }
                aria-label={`${c.name} 연결 폐기`}
              >
                폐기
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
