# ADR-002: GPT 앱 릴스 제작을 작업 큐와 가져오기 단계로 분리

**Status:** Superseded by ADR-003  
**Date:** 2026-09-03  
**Deciders:** sports-card-mcp 운영자

## Context

릴스 첫 장은 로컬 SVG 조합보다 영화 포스터급 입체 타이포그래피와 장면 밀도가 중요하다. ChatGPT 앱의 이미지 생성은 이 표현에 적합하지만, stdio MCP 프로세스가 GUI 로그인 세션과 화면 좌표를 직접 제어하면 앱 업데이트·로그인·권한 팝업에 취약해진다. 선수 사진을 생성 모델에 넣으면 얼굴·유니폼·등번호가 다시 그려질 위험도 있다.

Project003은 주제, 일정, 카드 역할, 사진 검색, 성과 분석, 음악·영상 결합과 게시를 담당한다. 이 MCP의 책임은 카드 제작에 한정한다.

## Decision

`create_reels_series`의 기본 provider를 `gpt_app`으로 한다. 한 번의 호출로 완성 이미지를 가장하는 대신 다음의 재개 가능한 3단계 계약을 제공한다.

1. `prepare_gpt_app_reels`: 카드별 프롬프트, 스타일 참고파일, 금지 첨부파일, 다운로드 위치와 작업 명세를 생성한다.
2. `import_gpt_app_card`: GPT 앱 결과 한 장을 정규화하고 원본 선수 누끼를 Sharp로 합성한 뒤 기술·수동 검수 상태를 기록한다.
3. `finalize_gpt_app_reels`: 전체 카드 연락시트와 Project003 전달용 JSON을 만든다.

선수 원본 사진은 GPT 앱의 첨부 목록에 포함하지 않는다. 카드에 사람이 필요한 경우 GPT 앱에는 빈 선수 슬롯을 만들게 하고, 세그멘테이션 알파 마스크를 적용한 원본 RGB만 로컬 합성한다. `fal_api`는 `render_provider: "fal_api"`를 명시했을 때만 릴스 포스터 판에 사용하며 암묵적 fallback은 금지한다.

## Options Considered

### A. MCP가 ChatGPT GUI를 직접 자동 조작

| Dimension | Assessment |
|---|---|
| Complexity | High |
| Reliability | Low; 화면·로그인 상태 의존 |
| Security | OS 접근성·화면 제어 권한 필요 |
| Recovery | 실패 위치 식별이 어려움 |

### B. 파일 기반 작업 큐와 명시적 앱 작업자

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Reliability | High; 앱 작업과 합성 상태 분리 |
| Security | 선수 사진 전송 차단을 명세로 검증 가능 |
| Recovery | 카드 단위 재생성·재가져오기 가능 |

### C. 모든 릴스를 fal.ai API로 자동 생성

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | 이미지마다 API 비용 발생 |
| Visual fit | 현재 목표 스타일과 차이가 날 수 있음 |
| Recovery | 기존 캐시·재시도 지원 |

## Consequences

- GPT 앱 단계에는 사람의 앱 조작 또는 별도 GUI 작업자가 필요하다.
- MCP는 로그인 정보나 ChatGPT 세션을 보관하지 않는다.
- 각 카드의 정확한 문구와 사람 미생성 여부는 수동 확인 전까지 `review_required`다.
- GPT 앱 결과는 허용된 `input`, `output`, `assets` 폴더 안에 저장해야 가져올 수 있다.
- fal.ai 포스터 비용은 기본 릴스 경로에서 발생하지 않는다. 선수 누끼 캐시가 없으면 세그멘테이션 호출만 발생할 수 있다.

## Action Items

1. [x] GPT 앱 작업 준비 도구
2. [x] 카드별 결과 가져오기와 원본 선수 합성
3. [x] 상태 조회, 카드별 재시도와 최종 전달 명세
4. [x] `create_reels_series` 기본 provider를 `gpt_app`으로 설정
5. [x] Instagram 분석 도구를 MCP 공개 표면에서 제거하고 Project003으로 책임 이동
