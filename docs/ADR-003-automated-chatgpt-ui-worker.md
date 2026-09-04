# ADR-003: Chrome 기반 ChatGPT UI 작업자로 릴스 제작 자동화

**Status:** Accepted  
**Date:** 2026-09-03  
**Deciders:** sports-card-mcp 운영자

## Context

ADR-002의 파일 작업 큐는 선수 원본 보호와 카드별 재개에는 적합했지만, 사용자가 ChatGPT 앱에서 프롬프트 입력과 다운로드를 직접 해야 했다. 이는 릴스 자동화 요구를 충족하지 않는다. 설치된 macOS “ChatGPT” 앱은 현재 Codex 앱과 동일한 번들로 식별되어 외부 제어 대상으로 사용할 수 없지만, Google Chrome은 설치되어 있으며 ChatGPT 웹은 동일한 비-API 이미지 생성 경로를 제공한다.

## Decision

Playwright Core와 시스템 Google Chrome을 이용한 전용 ChatGPT UI 작업자를 MCP 내부에 둔다. `create_reels_series`의 기본 `render_provider`는 `chatgpt_ui`다.

한 번의 MCP 호출은 다음을 순차 실행한다.

1. 역할별 포스터 프롬프트와 안전한 첨부 목록 생성
2. 전용 Chrome 프로필의 ChatGPT 로그인 상태 확인
3. 스타일 참고 이미지만 첨부하고 선수 원본 첨부는 차단
4. 프롬프트 자동 전송과 이미지 생성 완료 대기
5. 생성 이미지를 output 작업 폴더에 직접 저장
6. 같은 ChatGPT 대화에서 정확한 문구와 사람 미생성을 JSON으로 시각 검수
7. 검수 실패 시 오류 지시와 함께 카드만 자동 재생성
8. 원본 선수 누끼를 Sharp로 합성
9. 기술 검수, 연락시트와 Project003 전달 JSON 생성

최초 한 번의 로그인은 사용자가 열린 전용 Chrome에서 수행한다. MCP는 자격 증명을 읽거나 입력하거나 저장하지 않는다. 이후 로그인 세션은 output 내부의 전용 브라우저 프로필에 유지된다.

## Options Considered

### A. 수동 파일 작업 큐

| Dimension | Assessment |
|---|---|
| 자동화 | 불충분 |
| 복구 | 카드 단위로 우수 |
| 운영 부담 | 카드마다 사람 조작 필요 |

### B. macOS 네이티브 앱 좌표 자동화

| Dimension | Assessment |
|---|---|
| 자동화 | 가능 |
| 안정성 | 낮음; 화면 좌표·포커스 의존 |
| 현재 환경 | ChatGPT와 Codex 번들 충돌 |

### C. Playwright 전용 Chrome 프로필

| Dimension | Assessment |
|---|---|
| 자동화 | 로그인 이후 완전 자동 |
| 안정성 | DOM 선택자 다중 fallback과 명시적 오류 지원 |
| 복구 | 기존 작업 큐 manifest로 카드 단위 재개 |
| 보안 | 첨부 allowlist와 선수 원본 denylist 적용 |

## Consequences

- 최초 로그인 1회는 자동화할 수 없으며 사용자가 해야 한다.
- ChatGPT 웹 UI가 크게 변경되면 `CHATGPT_UI_CHANGED` 오류로 중단되며 선택자 갱신이 필요하다.
- UI 자동화는 카드별로 순차 실행하여 동일 대화/다운로드 충돌을 피한다.
- 생성 및 자체 검수는 ChatGPT 구독 사용량에 포함되며 fal.ai 포스터 API 비용은 들지 않는다.
- 선수 누끼 캐시가 없으면 BiRefNet 호출 비용은 별도로 발생할 수 있다.
- `manual_gpt_app`은 장애 대응용 수동 큐, `fal_api`는 명시적 무인 대체 경로로 유지한다.

## Action Items

1. [x] Playwright Core와 시스템 Chrome 연결
2. [x] 로그인 준비/상태 MCP 도구
3. [x] 프롬프트·스타일 첨부·이미지 저장 자동화
4. [x] AI 시각 검수와 카드별 재생성
5. [x] 원본 선수 합성 및 최종 전달 자동화
6. [x] 모형 UI 드라이버 기반 단위 테스트
