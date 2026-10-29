# AI 일정·메모 API

GitHub Pages의 `/todo/ai-guide.html`에 일반 사용자 안내와 복사할 프롬프트를 제공한다. `/todo/daynote-ai.mjs`는 외부 의존성 없이 실행하는 Node.js 22+ 클라이언트이며 JSON CLI와 stdio MCP를 지원한다. `/todo/ai-openapi.json`은 실제 Firebase HTTPS API의 OpenAPI 3.1 설명서다. Pages 자체는 API 서버가 아니며 인증된 Firebase 서버에 직접 요청한다.

## 인증과 권한

설정의 AI 연결에서 별도의 Firebase Authentication 계정을 생성한다. 기존 email/password 공급자를 사용하되 임의 이메일과 무작위 비밀번호를 생성하며 비밀번호는 보관하지 않는다. 보조 Auth 인스턴스는 메모리 저장을 사용하므로 소유자의 로그인과 캐시를 바꾸지 않는다. AI에는 이 전용 계정의 refreshToken, 공개 Firebase 설정, ownerUid와 agentUid만 담은 연결 파일을 전달한다. 소유자의 비밀번호나 refreshToken을 제공하지 않는다.

소유자는 `users/{ownerUid}/aiConnections/{agentUid}`에 이름, scopes(`read`, 선택적 `write`), createdAt, expiresAt, revoked를 저장한다. 비밀값은 이 문서에 저장하지 않는다. Firestore 규칙은 요청마다 소유자의 active, 연결 만료, 폐기, 범위를 확인한다. AI는 연결 자체를 수정하거나 다른 사용자의 데이터, 사용자·관리자·가져오기·이미지 컬렉션에 접근할 수 없다. 기존 소유자·관리자 사용 방법과 데이터 형식은 유지한다.

## 클라이언트 사용

연결 파일을 `~/.config/daynote/credentials.json`에 0600으로 보관하거나 `DAYNOTE_AI_CONFIG`로 파일 경로를 지정한다. 연결 파일·ID 토큰·refreshToken을 명령 인수, 로그나 프롬프트에 넣지 않는다.

```sh
node daynote-ai.mjs call < request.json
node daynote-ai.mjs mcp
```

입력 예:

```json
{"operation":"createTask","requestId":"board-plan-20261029-001","calendarId":"실제 캘린더 ID","date":"2026-10-29","text":"보드 시험 설계","note":"계획 초안. 실제 시험은 미수행."}
```

지원 작업은 status, listCalendars, listTasks, getTask, createTask, updateTask, appendNote다. MCP에서는 `daynote_create_task`처럼 이름을 사용한다. `listTasks`는 페이지에서 검색하므로 빈 결과여도 nextPageToken이 있으면 계속 조회한다. `complete`는 마지막 원본 페이지에 도달했는지를 의미하며 검색 결과의 전체 개수가 아니다. 목록은 저장된 반복 원본이며 반복 발생일을 만들어 내지 않는다.

note 입력은 일반 텍스트로 처리하고 HTML 문자를 이스케이프한다. 조회 결과 noteHtml은 보존된 HTML 원문이고 note는 읽기용 텍스트다. 기존 서식을 유지한 채 메모를 추가하려면 appendNote를 사용한다. updateTask의 patch.note는 사용자가 요청한 전체 교체에 사용한다. 업데이트는 지정한 필드만 보내며 원본의 미지원 필드와 반복 설정을 보존한다.

## HTTP 직접 사용

1. `POST https://securetoken.googleapis.com/v1/token?key=API_KEY`, form body `grant_type=refresh_token&refresh_token=REFRESH_TOKEN`. 반환된 user_id가 agentUid인지 확인한다. 새 refresh_token은 비밀 저장소에서 갱신하고 id_token을 Authorization Bearer 헤더에 사용한다.
2. 문서 루트는 `https://firestore.googleapis.com/v1/projects/PROJECT_ID/databases/(default)/documents`다. `GET /users/OWNER_UID/calendars`, `GET /users/OWNER_UID/tasks?pageSize=100`, `GET /users/OWNER_UID/tasks/TASK_ID`를 호출한다. 문서 fields는 Firestore Value 형식이다. stringValue, booleanValue, integerValue(문자열), nullValue, mapValue.fields, arrayValue.values를 사용한다. nextPageToken을 pageToken으로 이어 읽는다.
3. 쓰기는 `POST DOCUMENT_ROOT:commit`으로 task와 중복 방지 기록 두 개를 함께 보낸다. 기존 문서 수정에는 updateMask.fieldPaths와 currentDocument.updateTime을 반드시 보낸다. 새 문서에는 currentDocument.exists=false를 쓴다.
4. requestKey는 requestId 문자열의 SHA-256 소문자 hex다. 기록 경로는 `users/OWNER_UID/aiConnections/AGENT_UID/requests/REQUEST_KEY`. 기록 fields는 operation(createTask/updateTask/appendNote), taskId, contentHash, createdAt다. contentHash는 `{operation,...args}`의 모든 객체 키를 재귀적으로 정렬해 JSON 직렬화한 문자열의 SHA-256이다. 같은 키로 다른 내용은 거절한다. 요청 전 같은 기록이 있으면 다시 쓰지 않고 연결된 task를 읽는다.
5. 새 task ID는 `ai-` + SHA-256(`AGENT_UID:REQUEST_KEY`)다. 필수 필드 id,text,calendarId,done,date,note,color,listId,checklist,freq(0),order,createdAt,updatedAt를 사용한다. 날짜 미지정은 null, note는 이스케이프한 HTML이다.
6. commit 성공 뒤 task를 GET해서 실제 저장 내용을 확인한다. 실패나 네트워크 불명확 시 같은 requestId·인수로 조회·재시도하며 성공을 추정하지 않는다. 수정 충돌은 최신 원문과 사용자 요청을 다시 대조한다.

임의 HTTP 클라이언트보다 제공된 클라이언트/MCP 사용을 권장한다. 같은 인증과 실제 API를 사용하면서 위의 값 변환, 중복 방지, 충돌 검사와 저장 후 확인을 자동 처리한다. 서비스 계정 키나 관리자 OAuth 토큰은 AI 연결에 사용하지 않는다.

## 검증과 배포

`npm test`, `npm run build`를 실행한다. 기존 규칙·동기화와 AI 실제 REST 검사는 Auth/Firestore 에뮬레이터에서 순서대로 실행한다. 운영 프로젝트에 테스트를 연결하지 않는다.

```sh
npx firebase-tools@15.34.0 emulators:exec --project demo-daynote-ein6xs --only auth,firestore "npm run test:rules && npm run test:sync && npm run test:ai"
```

운영 배포는 `firestore.rules`의 SHA와 Pages 배포 묶음 SHA를 승인 요청에 함께 묶는다. 규칙을 먼저 게시하고 읽어 확인한 다음 승인된 정적 파일을 gh-pages에 게시한다. 소스 푸시는 자동 운영 배포를 실행하지 않는다. 배포 후 별도 시험 계정으로 발급·REST 저장·조회·폐기를 확인하고 시험 연결을 폐기한다. 고객 일정에 시험 내용을 만들지 않는다.

공식 문서: [Firestore REST 인증](https://firebase.google.com/docs/firestore/use-rest-api), [Firebase 토큰 갱신](https://firebase.google.com/docs/reference/rest/auth#section-refresh-token), [문서 commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit).
