# Project003 연동 계약

## 책임 경계

Project003이 정하는 것:

- 제작 일정, 게시 시간, 주제와 사실관계
- 카드 수, 역할, 문구, 구단색, 시즌과 사진 선택
- GPT 앱 작업 실행 시점
- 카드 결합, 음악, 영상, 게시, 계정 분석과 학습

sports-card-mcp가 하는 것:

- 카드 역할별 영화 포스터 구도 지시
- GPT 앱용 카드별 작업 파일 생성
- GPT 앱 결과 규격화
- 원본 선수 누끼와 로컬 합성
- 기술 검수, 수동 검수 상태, 실패 카드 재개
- 완성 PNG와 전달용 JSON 생성

## 기본 릴스 흐름

1. 최초 1회 `setup_chatgpt_ui`를 호출하고 열린 전용 Chrome에서 사용자가 ChatGPT에 로그인합니다.
2. Project003이 `create_reels_series`를 호출합니다. `render_provider`를 생략하면 `chatgpt_ui`입니다.
3. MCP가 카드별 프롬프트 입력, 스타일 참고 이미지 첨부, 이미지 생성·저장과 시각 검수를 자동 수행합니다.
4. 검수 실패 카드는 자동 재생성하고, 통과한 포스터 판에만 원본 선수 누끼를 합성합니다.
5. MCP가 전체 연락시트와 delivery manifest를 자동 생성합니다.
6. 상태가 `passed`이면 Project003이 PNG를 영상·음악 파이프라인으로 넘깁니다.

## 상태 처리

- `waiting_for_generation`: GPT 앱 결과 대기
- `partially_imported`: 일부 카드만 가져옴
- `review_required`: 결과는 있으나 문구·사람 미생성 또는 기술 검수 미통과
- `passed`: 모든 검수 통과
- 카드 실패 시 전체 시리즈를 다시 만들지 말고 해당 `card_id`만 재생성해 `force: true`로 가져옵니다.

## 필수 운영 규칙

- 자동화 첨부 allowlist에는 스타일 참고 이미지만 들어가며 선수 사진은 차단됩니다.
- 생성 결과는 브라우저 다운로드 폴더를 거치지 않고 MCP output 작업 폴더에 직접 저장됩니다.
- 정확한 문구와 사람 미생성 조건은 같은 ChatGPT 대화에서 자동 검수하고 실패 시 카드만 다시 생성합니다.
- `render_provider: "manual_gpt_app"`은 ChatGPT UI 변경 등 장애 대응 때만 사용합니다.
- `render_provider: "fal_api"`는 UI를 사용하지 않는 대체 자동 제작이 꼭 필요한 경우에만 명시합니다.
- 스토리 자동 제작은 기존 `create_sports_card`를 사용합니다.

## 최소 호출 예시

```json
{
  "series_id": "zimmermann-12ip-25runs",
  "output_dir": "/Users/johnjung/projects/sports-card-mcp/output/zimmermann-series",
  "topic": "짐머맨 12이닝 25실점, 한화의 선택",
  "issue_summary": "기대와 배신의 서사",
  "issue_type": "breaking_news",
  "season": "2026",
  "team_name": "한화 이글스",
  "team_color": "#F37321",
  "render_provider": "chatgpt_ui",
  "photos": [
    {
      "image_path": "/Users/johnjung/projects/sports-card-mcp/input/zimmermann1.jpg",
      "preferred_roles": ["context"]
    }
  ],
  "cards": [
    {
      "id": "hook",
      "role": "hook",
      "hero_number": "25",
      "headline": "25실점",
      "subheadline": "12이닝 만에 역대급 오점"
    },
    {
      "id": "context",
      "role": "context",
      "headline": "12이닝 · 25실점",
      "subheadline": "기대를 안고 왔던 그 투수"
    }
  ]
}
```

UI 장애 시 수동 가져오기:

```json
{
  "job_manifest": "/Users/johnjung/projects/sports-card-mcp/output/zimmermann-series/.gpt-app/JOB_ID/job.json",
  "card_id": "context",
  "generated_image": "/Users/johnjung/projects/sports-card-mcp/output/zimmermann-series/.gpt-app/JOB_ID/inbox/02-context.png",
  "exact_text_verified": true,
  "no_generated_people_verified": true
}
```
