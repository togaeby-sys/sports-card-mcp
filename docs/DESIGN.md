# Sports Card MCP 설계

## 목표와 불변 조건

이 서버는 Claude Code가 로컬 `stdio`로 호출하는 TypeScript MCP 서버다. 최종 결과는 항상 1080×1920 PNG이며, 선수 얼굴·유니폼·등번호·헬멧·배트·팀 로고는 생성 모델로 다시 그리지 않는다. 선수 분리는 세그멘테이션 모델이 만든 알파 마스크만 원본 RGB 픽셀에 적용한다. 생성형 모델은 선수가 없는 경기장 배경에만 사용한다.

`stdout`은 MCP 프로토콜 전용이다. 진단 로그는 `stderr`로만 보낸다. API 키는 코드, 오류, 로그, MCP 응답에 포함하지 않는다.

## 처리 흐름

```text
analyze_image
  -> extract_player (원본 해시 캐시, 마스크 기반 RGB 보존)
  -> generate_sports_background (prompt + seed 캐시, fal.ai)
  -> attention underlay (로컬 거대 등번호/점수 + 광선, 선수보다 뒤)
  -> composite_player (Sharp)
  -> add_effect_overlay (선수 뒤/주변의 로컬 SVG 효과)
  -> render_card_text (지정한 로컬 폰트 + SVG + Sharp)
  -> export_reels_card (1080x1920, PNG 검증/출력)
```

`create_sports_card`는 위 단계를 오케스트레이션한다. 실행 상태 manifest를 작업 폴더에 원자적으로 기록하고, 같은 입력으로 재호출하면 검증된 완료 산출물은 건너뛰므로 실패 단계부터 재개할 수 있다.

고임팩트 `cinematic_poster` 경로는 먼저 선수 없는 완성 포스터 플레이트를 생성한다. 플레이트에는 입체 제목, 프레임, 배경 숫자, 조명, 불꽃과 카피 패널이 포함된다. 원본 선수는 이 생성 요청에 포함하지 않고 이후 Sharp 합성 단계에서만 추가한다. `editorial_local` 경로는 기존처럼 배경 생성 후 모든 텍스트를 SVG로 렌더링한다.

### 시리즈 처리 흐름

```text
issue brief + 0..12 source photos + card copy
  -> series director (hook/context/twist/climax/cta role policy)
  -> GPT UI job queue (prompt + allowed style references + forbidden player attachments)
  -> Playwright opens dedicated Chrome/ChatGPT session
  -> prompt submission + style-reference upload + generated-image capture
  -> ChatGPT visual self-review and per-card regeneration on failure
  -> import and normalize to 1080x1920 PNG
  -> alpha-bounds normalization for each original player cutout
  -> 0..2 original-player composites
  -> technical visual QA (canvas, PNG, visibility, tonal range)
  -> exact-copy and no-generated-people manual gates
  -> retry only rejected card ids
  -> delivery manifest for Project003
```

`create_reels_series`의 기본값은 `render_provider: chatgpt_ui`다. stdio MCP가 Playwright로 전용 Chrome 프로필을 열고 카드별 작업을 순차 실행한다. 최초 로그인만 사용자가 수행하며 MCP는 자격 증명을 다루지 않는다. 선수 원본은 ChatGPT 첨부 목록에서 제외된다. `render_provider: manual_gpt_app`은 UI 장애 대응용 작업 큐이고, `fal_api`는 명시한 경우에만 기존 자동 포스터 경로를 사용한다. 암묵적 fallback은 없다.

시리즈 경로에서는 거대한 메인 타이포그래피를 로컬 SVG로 교체하지 않는다. 로컬 텍스트 도구는 `editorial_local` 또는 작은 마이크로카피에만 사용한다. GPT 앱이 만든 카피와 사람 미생성 여부를 사람이 확인하기 전까지 완료가 아니라 `review_required`다.

## 상황 기반 카드 디렉터

`design/attention`은 `issue_type`, 시즌, 구단색, 선수명, 등번호와 콘텐츠를 입력받아 결정적인 시각 전략을 반환하는 순수 함수다. `template: auto`이면 이슈별 기본 템플릿을 선택하고, 명시적인 템플릿은 그대로 존중한다. 결과에는 다음이 포함된다.

- 배경 아트 디렉션과 효과 강도
- 주색·보조색·강조색 팔레트
- 헤드라인 재질과 레이아웃 밀도
- 배경에 로컬 렌더링할 거대 등번호/점수
- 선수 기본 위치와 크기
- 시즌·리그·이슈가 결합된 상단 키커

AI 배경 프롬프트에는 글자와 숫자를 금지한다. 거대 숫자는 AI 배경과 선수 사이의 로컬 underlay에 렌더링하고, 정확해야 하는 모든 문구는 선수 합성 후 로컬 SVG로 렌더링한다. 따라서 다양한 이슈에 따른 시각적 변화와 문자 정확성을 동시에 유지한다.

## 모듈 경계

- `config`: 허용 디렉터리, 모델, 타임아웃/재시도, 폰트 환경 설정
- `design/attention`: 이슈별 단일 시선 초점, 역할별 폰트, 압축형 제목, 숫자/단위 분리와 국소 효과 강도 결정
- `security/paths`: 절대 경로, 확장자, realpath/symlink 탈출, 입출력 역할 검증
- `image`: 메타데이터 검사, 투명 선수 추출, Sharp 합성/효과/텍스트/내보내기
- `design/attention`: 이슈별 템플릿·팔레트·밀도·구도 자동 결정
- `providers`: 배경 생성 인터페이스와 fal.ai 구현. endpoint는 `FAL_BACKGROUND_MODEL`로 교체 가능
- `cache`: 콘텐츠 주소 방식의 선수/배경 캐시와 안전한 복사
- `pipeline`: 단계 manifest, dry-run/비용 예측, 재개 실행
- `series/director`: 카드 역할별 레이아웃, 선수 사용 수, 사진 배분과 영화 포스터 계약 결정
- `series/pipeline`: 다중 카드·다중 사진 오케스트레이션, 카드 단위 재시도와 검수 상태 관리
- `series/gpt-app`: GPT 앱 작업 큐, 앱 결과 가져오기, 원본 선수 합성, 수동 검수와 Project003 전달 명세
- `series/automated`: ChatGPT UI 카드 생성부터 가져오기·완료까지 한 호출로 연결
- `providers/chatgpt-ui`: 전용 Chrome 프로필, 로그인 상태, 첨부·프롬프트·이미지 저장·시각 검수와 재시도
- `image/quality`: 최종 크기·포맷·가시성·명암 범위 기술 검수
- `image/subject`: 알파 바운딩 박스를 이용한 선수 누끼 광학 정규화
- `learning`: 이전 버전 호환 코드. Project003 책임으로 이동했으며 기본 MCP 공개 도구와 생성 경로에서는 사용하지 않음
- `mcp`: Zod 입력 스키마, 카드 제작 도구 등록, 오류의 구조화된 MCP 응답 변환

## 파일 접근 보안

서버 시작 시 `SPORTS_CARD_INPUT_DIR`, `SPORTS_CARD_OUTPUT_DIR`, `SPORTS_CARD_ASSETS_DIR`를 절대 경로로 해석한다. 모든 사용자 경로는 다음 검사를 통과해야 한다.

1. 경로 자체가 절대 경로인지 확인한다.
2. 읽기는 존재 파일의 `realpath`, 쓰기는 가장 가까운 기존 부모의 `realpath`를 기준으로 검사한다.
3. 해당 역할에 허용된 루트의 하위인지 `path.relative`로 확인한다.
4. 심볼릭 링크를 통한 루트 이탈을 차단한다.
5. 입력은 JPG/JPEG/PNG/WEBP, 중간·출력은 PNG만 허용한다.

입력 이미지는 `input`에서만 읽는다. 중간/최종 산출물과 캐시는 `output`에만 쓴다. 폰트와 선택적 오버레이는 `assets`에서만 읽는다.

타이포그래피는 AI 배경에 맡기지 않는다. 제목은 한글 디스플레이 폰트, 기록 숫자와 영문 단위는 라틴 압축 폰트, 보조 정보는 본문 폰트로 분리한다. 임팩트는 굵은 3D 효과의 중첩이 아니라 크기 대비, 압축률, 짧은 그림자, 어두운 안전영역과 국소 조명으로 만든다.

## 선수 픽셀 보존

기본 세그멘테이션 provider는 `FAL_SEGMENTATION_MODEL`의 결과를 알파 마스크로 취급한다. 결과가 RGBA 피사체 이미지이면 그 알파 채널만 사용하고, RGB는 반드시 원본에서 가져온다. 결과가 단일 채널 마스크여도 동일하다. 원본과 마스크는 같은 크기로 정규화하고 `joinChannel`로 합친다. 캐시 키는 원본 파일 SHA-256과 세그멘테이션 모델 버전이다.

## 배경 provider 추상화

`BackgroundProvider.generate(request)`는 모델 고유 입력/응답을 캡슐화한다. 초기 endpoint는 `fal-ai/flux-pro/kontext/text-to-image`이며 `FAL_BACKGROUND_MODEL`로 다른 text-to-image endpoint를 주입할 수 있다. 선수나 원본 사진은 배경 요청에 넣지 않는다. 프롬프트에는 `no people, no player, no text, no logos`를 강제한다.

배경 캐시 키는 provider, endpoint, 정규화한 prompt, seed, 종횡비의 SHA-256이다. `reuse_background_path`가 있으면 API를 호출하지 않는다.

## 안정성 및 비용

- 원격 호출은 AbortSignal 기반 timeout과 지수 backoff 재시도를 사용한다.
- 인증/유효성 오류는 재시도하지 않고, timeout/429/5xx/네트워크 오류만 재시도한다.
- 다운로드도 크기 상한과 timeout을 적용한다.
- `dry_run`은 파일/API 변경 없이 단계 계획, 캐시 적중 여부, 예상 API 호출 수를 반환한다.
- 일반 실행 응답에도 실제 API 호출 수, 캐시 사용, 단계별 산출물을 반환한다.
- 단계 manifest와 deterministic 작업 경로로 전체 재실행을 피한다.

## Project003 책임 경계

주제 선정, 사실 검증, 일정, 사진 검색, 성과 분석·학습, 영상·음악 결합과 게시는 Project003이 담당한다. MCP는 그 결과로 받은 카드 명세를 재해석해 다른 주제를 만들지 않는다. 반환되는 delivery manifest는 Project003이 후속 파이프라인에서 사용할 카드 순서, 역할, 절대 출력 경로와 검수 상태만 담는다.

## 오류 모델

오류는 `code`, 사용자 메시지, 재시도 가능 여부, 실패 단계만 노출한다. 주요 코드는 `PATH_NOT_ALLOWED`, `FILE_NOT_FOUND`, `INVALID_EXTENSION`, `INVALID_IMAGE`, `IMAGE_TOO_LARGE`, `FONT_NOT_FOUND`, `FAL_KEY_MISSING`, `API_TIMEOUT`, `API_RETRY_EXHAUSTED`, `PIPELINE_STEP_FAILED`다. 내부 stack과 환경변수 값은 MCP 응답에 넣지 않는다.

## 테스트 전략

샘플 바이너리는 저장하지 않는다. 테스트 안에서 Sharp로 작은 합성 이미지를 만들고 다음을 검증한다.

- 경로 traversal/symlink 및 확장자 차단
- 이미지 분석과 크기 제한
- 알파 마스크 적용 후 RGB 픽셀 보존
- 배경/선수 캐시 키 안정성
- SVG escape와 폰트 오류
- 1080×1920 PNG 출력
- dry-run의 API 예상 횟수와 외부 호출 없음
- MCP 서버가 stdout 오염 없이 initialize 요청에 응답하고 종료되는지
- 역할별 선수 사진 자동 배분과 영화 포스터 레이아웃 선택
- 기술 품질 게이트와 새 시리즈 MCP 도구 노출
- GPT 앱 작업에서 선수 사진이 첨부 목록에 들어가지 않는지
- GPT 앱 결과 정규화, 원본 선수 합성, 수동 검수 게이트와 카드별 재개
- 이슈별 자동 템플릿·밀도·영웅 숫자 선택과 안전한 색상 검증
