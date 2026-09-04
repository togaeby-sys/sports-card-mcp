# Sports Card MCP

Claude Code에서 로컬 선수 사진을 받아 1080×1920 스포츠 카드 PNG를 만드는 TypeScript stdio MCP 서버입니다. 릴스는 기본적으로 전용 Chrome의 ChatGPT 웹을 자동 조작해 프롬프트 입력, 스타일 참고 이미지 첨부, 생성 결과 저장, 시각 검수·재시도와 원본 선수 합성까지 한 번에 수행합니다. 스토리·API 자동 제작은 fal.ai 경로를 명시해 사용할 수 있습니다. 선수 이미지는 어떤 생성 모델로도 다시 그리지 않으며, BiRefNet 세그멘테이션 결과에서 알파 마스크만 취해 원본 RGB에 적용합니다.

## 요구 사항

- Node.js 20 이상
- Google Chrome과 ChatGPT 로그인 세션(최초 1회 로그인)
- fal.ai API 키(스토리 자동 생성 또는 선수 누끼 캐시가 없을 때 필요)
- `assets` 폴더 안의 한글 지원 폰트(TTF/OTF/TTC/WOFF/WOFF2)
- 절대 경로로 지정한 `input`, `output`, `assets` 폴더

## 설치와 빌드

```bash
npm install
cp .env.example .env
npm run build
npm test
```

`.env`에서 `FAL_KEY`와 절대 경로를 설정합니다. 실제 API 키는 커밋하지 마세요. 기본 폴더는 이 프로젝트의 `input`, `output`, `assets`입니다. 스포츠용 OFL 폰트 세트가 `assets/fonts`에 포함되어 있으며 다른 한글 폰트를 쓰려면 허용 경로 정책에 따라 `assets` 안에 복사해야 합니다.

```dotenv
FAL_KEY=your-key
SPORTS_CARD_FONT_PATH=/absolute/path/to/sports-card-mcp/assets/fonts/do-hyeon/DoHyeon-Regular.ttf
```

서버는 `stdout`을 MCP JSON 전용으로 사용하고, 일반 상태 로그는 `stderr`에만 기록합니다. `FAL_KEY`는 로그나 도구 응답에 포함하지 않습니다.

## Claude Code 등록

빌드 후 다음 명령을 실행합니다. Claude Code를 실행하는 셸에 `FAL_KEY`가 설정되어 있거나 프로젝트 `.env`에 들어 있어야 합니다.

```bash
claude mcp add --transport stdio sports-card -- node /absolute/path/to/sports-card-mcp/dist/index.js
```

상태 확인:

```bash
claude mcp list
```

## 폴더 보안

- 읽기: 설정된 `input`, `output`, `assets` 내부만 허용
- 쓰기: 설정된 `output` 내부의 PNG와 MCP가 관리하는 GPT 앱 작업용 JSON/Markdown만 허용
- 사용자 입력과 출력 경로: 항상 절대 경로
- 입력 형식: JPG, JPEG, PNG, WEBP
- 출력 형식: PNG
- 실제 경로(`realpath`) 기반 검사로 `..`와 심볼릭 링크 탈출 차단
- 기본 제한: 입력 50MB, 다운로드 40MB, 이미지 8천만 픽셀

환경변수 `MAX_INPUT_BYTES`, `MAX_DOWNLOAD_BYTES`, `MAX_IMAGE_PIXELS`로 제한을 조정할 수 있습니다.

## 제공 도구

1. `analyze_image` — 형식, 크기, 방향 보정 크기, 알파, SHA-256 분석
2. `extract_player` — 원본 해시 캐시를 사용하는 마스크 기반 선수 PNG 분리
3. `generate_sports_background` — 선수 없는 fal.ai 배경 생성, prompt/seed 캐시 및 배경 재사용
4. `generate_poster_plate` — 기준 이미지 구도를 유지한 선수 없는 영화 포스터급 AI 타이포그래피 플레이트 생성
5. `composite_player` — 위치, 배율, 회전, anchor, shadow, rim light 합성
6. `add_effect_overlay` — 로컬 SVG 조명·입자 오버레이
7. `render_card_text` — 전달받은 assets 폰트를 포함한 SVG 한글 텍스트 렌더링
8. `export_reels_card` — 정확한 1080×1920 PNG 출력
9. `create_sports_card` — 포스터 플레이트 또는 로컬 편집형 7단계 파이프라인 실행
10. `create_reels_series` — ChatGPT 웹 이미지 생성부터 원본 선수 합성·완료 JSON까지 수행하는 기본 자동 릴스 제작
11. `setup_chatgpt_ui` — 전용 Chrome을 열고 최초 로그인/자동화 준비 상태 확인
12. `prepare_gpt_app_reels` — UI 장애 때만 사용하는 수동 작업 파일 준비
13. `import_gpt_app_card` — 수동 GPT 결과 한 장 정규화, 원본 선수 합성, 검수 기록
14. `get_gpt_app_reels_status` — 대기·검수·통과 카드와 다음 작업 조회
15. `finalize_gpt_app_reels` — 전체 연락시트와 Project003 전달용 JSON 생성

일정, 주제 결정, 사진 검색, 성과 분석과 학습, 음악·영상 결합 및 게시는 Project003의 책임입니다. 이 MCP의 공개 도구는 카드 제작에만 집중합니다.

## 영화 포스터 하이브리드 엔진

`create_sports_card`의 `poster_style`은 `auto`, `cinematic_poster`, `editorial_local`을 지원합니다. `auto`는 일정형을 제외한 이슈에서 `cinematic_poster`를 선택합니다.

`cinematic_poster`는 `assets/kim-jaehyun-ai-typography-plate-v2.png`를 기본 스타일 레퍼런스로 사용합니다. fal.ai가 선수 없는 상태에서 거대한 금속 입체 제목, 기울어진 다중 프레임, 배경 등번호, 방사형 폭발, 하단 이중 카피 패널을 하나의 완성 포스터 플레이트로 만들고 Sharp가 원본 선수 PNG만 중앙에 합성합니다. 선수 얼굴·유니폼·등번호·헬멧·배트·팀 로고는 생성 모델에 전달하지 않습니다.

AI가 생성한 한글은 철자 확인이 필요하므로 결과와 dry-run 응답에 `typography_verification_required`가 반환됩니다. 정확성이 최우선이거나 정보량이 많은 카드에는 `poster_style: "editorial_local"`을 사용하면 모든 글자를 로컬 SVG로 렌더링합니다.

`cinematic_poster`의 거대한 메인 제목을 `render_card_text`로 덮어쓰지 마십시오. 로컬 SVG는 편집형 카드 또는 작은 출처·날짜·해시태그에만 사용합니다. 영화 포스터 결과는 기술 검수와 AI 타이포 검수가 모두 통과해야 `passed`가 되며, 새 AI 판은 기본적으로 `review_required` 상태로 반환됩니다.

## 역할 기반 릴스 시리즈

여러 장의 릴스를 제작할 때는 `create_sports_card`를 반복 호출하지 말고 `create_reels_series`를 한 번 호출합니다. 이 도구는 카드 역할에 따라 기본 구도와 선수 사진 사용을 결정하며, `render_provider` 기본값은 `chatgpt_ui`입니다. ChatGPT 웹 UI 생성과 다운로드는 자동이며 선수 사진은 첨부되지 않습니다. fal.ai로 릴스 포스터를 자동 생성하려면 `render_provider: "fal_api"`를 명시해야 하며 자동 fallback은 없습니다.

| 역할 | 기본 구도 | 선수 기본값 |
|---|---|---|
| `hook` | 충격 숫자 중심 `number_shock` | 없음 |
| `context` / `evidence` | 선수+기록 `player_stat` | 1장 |
| `twist` | 기대와 현실의 텍스트 대비 `quote_tension` | 없음 |
| `climax` | 결단형 `decision_climax` | 1장, 크게 |
| `cta` | 저장·공유용 `clean_cta` | 없음 |

`photos`는 0~12장, 카드별 선수 사진은 0~2장을 지원합니다. `include_player: "auto"`이면 역할과 사용 가능한 사진을 보고 자동 배분하며, `photo_indices`로 명시적으로 고정할 수도 있습니다. 선수 누끼는 투명 여백을 기준으로 정규화한 뒤 배치하므로 원본 캔버스의 치우침이 구도에 그대로 전달되지 않습니다.

최초 1회 `setup_chatgpt_ui`를 호출해 열린 전용 Chrome에서 ChatGPT에 로그인합니다. 그 뒤 기본 경로는 `prepare → ChatGPT UI 생성 → 자동 저장 → ChatGPT 시각 검수 → 필요 시 자동 재생성 → import → finalize`를 한 호출 안에서 수행합니다. 문구나 사람 미생성 검수에 실패하면 해당 카드만 최대 `CHATGPT_UI_RETRIES`만큼 다시 생성합니다. `manual_gpt_app`은 UI 장애 시의 예외 경로입니다.

상세한 Project003 연동 계약과 호출 예시는 [docs/PROJECT003-INTEGRATION.md](docs/PROJECT003-INTEGRATION.md)를 참고하세요.

실행 결과의 `review_contact_sheet`에는 전체 카드를 한 화면에서 비교할 수 있는 검수용 모음 이미지가 저장됩니다. 이 파일은 검수 보조물이며 최종 릴스 카드만 1080×1920 규격을 사용합니다.

Dry-run 예시:

```json
{
  "series_id": "zimmermann-12ip-25runs",
  "output_dir": "/absolute/path/to/sports-card-mcp/output/zimmermann-series",
  "topic": "짐머맨 12이닝 25실점, 한화의 선택",
  "issue_summary": "기대를 안고 영입된 외국인 투수가 불펜 강등 위기에 선 이야기",
  "issue_type": "breaking_news",
  "season": "2026",
  "team_name": "한화 이글스",
  "team_color": "#F37321",
  "photos": [
    { "image_path": "/absolute/path/to/sports-card-mcp/input/zimmermann1.jpg", "preferred_roles": ["context"] },
    { "image_path": "/absolute/path/to/sports-card-mcp/input/zimmermann2.jpg", "preferred_roles": ["climax"] }
  ],
  "cards": [
    { "id": "hook", "role": "hook", "headline": "25실점", "hero_number": "25", "subheadline": "12이닝 만에 역대급 오점" },
    { "id": "context", "role": "context", "headline": "12이닝 · 25실점", "subheadline": "기대를 안고 왔던 그 투수" },
    { "id": "twist", "role": "twist", "headline": "로테이션을 바꿀 투수", "subheadline": "지금은 불펜 강등 위기" },
    { "id": "climax", "role": "climax", "headline": "한화의 선택", "subheadline": "지금 결단이 필요한 순간" },
    { "id": "cta", "role": "cta", "headline": "한화 팬이라면", "subheadline": "저장해둘 이야기" }
  ],
  "dry_run": true
}
```

## 상황 기반 관심 유도 엔진

`create_sports_card`에서 `template: "auto"`와 `issue_type`을 사용하면 카드 디렉터가 상황에 맞는 템플릿, 시각 밀도, 강조색, 배경 연출, 거대 등번호/점수, 제목 크기와 선수 기본 위치를 자동으로 선택합니다. 사용자가 `player_position`, `visual_intensity`, `layout_density`, `accent_color`를 지정하면 해당 값만 우선 적용됩니다.

지원 이슈 유형:

- 순간 임팩트: `walk_off`, `grand_slam`, `home_run`, `victory`, `rivalry`
- 명예·기록: `championship`, `record`, `milestone`, `award`, `all_star`
- 뉴스: `transfer`, `contract`, `breaking_news`
- 정보형: `schedule`, `generic`

자동 전략의 예:

| 이슈 | 기본 템플릿 | 시각 밀도 | 핵심 연출 |
|---|---|---|---|
| `walk_off` / `grand_slam` | `cinematic_red` | maximum | 폭발광, 불꽃, 거대 등번호, 금속성 금색 제목 |
| `championship` / `record` | `championship_gold` | dense~maximum | 블랙·골드, 기록 숫자, 시상식 조명 |
| `transfer` / `contract` | `breaking_news` | maximum | 속보 프레임, 대각선 속도선, 주황 강조 |
| `schedule` | `night_stadium` | balanced | 정보 가독성, 절제된 입자와 경기장 조명 |

AI는 어떤 모드에서도 선수·구단 로고를 생성하지 않습니다. `cinematic_poster`에서는 포스터 플레이트의 장식 타이포그래피를 AI가 만들며, `editorial_local`에서는 모든 글자를 포함된 OFL 폰트로 로컬 렌더링합니다. `dry_run` 응답의 `poster`와 `design_strategy`에서 선택된 방식, 모델, 스타일 레퍼런스, 구도와 검수 필요 여부를 API 호출 전에 확인할 수 있습니다.

## Project003과의 책임 분리

게시 일정, 주제·사실 검증, 사진 검색, 계정 성과 분석과 학습, 음악·영상 결합, Instagram 게시는 Project003에서 처리합니다. 이 MCP는 Project003이 전달한 확정 명세로 카드 이미지를 제작하고 검수 가능한 산출물을 반환합니다. 이전 학습 모듈 코드는 호환을 위해 저장소에 남아 있을 수 있지만 MCP 공개 도구로 등록하지 않으며 기본 카드 생성에 자동 적용하지 않습니다.

전체 입력 스키마는 MCP의 `tools/list`로 확인할 수 있습니다. 모든 도구는 성공 시 JSON 객체를, 실패 시 `code`, `message`, `retryable`, 선택적 `stage`가 포함된 구조화 오류를 반환합니다.

`render_card_text`의 각 text block은 기본 필드 외에 `style_preset`을 지원합니다. 값은 `clean`, `impact_white`, `impact_gold`, `impact_orange`이며 임팩트 프리셋은 절제된 금속 질감, 얇은 외곽선과 짧은 깊이 그림자를 로컬 SVG로 렌더링합니다. 두꺼운 3D 돌출과 화면 전체 글로우 대신 압축 비율, 자간과 명암 대비로 스포츠 편집 디자인의 힘을 만듭니다. `font_style`과 `letter_spacing`으로 이탤릭과 자간도 조정할 수 있습니다.

각 text block은 `font_path`, `scale_x`, `skew_x`와 `plate`도 지원합니다. `plate`에는 `fill`, `opacity`, `border_color`, `border_width`, `padding_x`, `padding_y`, `radius`, `cut_corners`를 지정할 수 있어 방송 그래픽형 라벨과 정보 바를 만들 수 있습니다. 기본 자동 파이프라인은 Black Han Sans를 압축형 한글 제목에, Do Hyeon을 한글 보조 문구에, Anton을 영문·숫자에 적용하며 `39 HR`처럼 숫자와 단위가 결합된 값은 크기를 분리해 렌더링합니다. 포함된 OFL 폰트의 원본 라이선스는 각 폰트 폴더에 있습니다.

## 샘플 호출

Claude Code에서 다음과 같이 요청할 수 있습니다.

> `/absolute/path/to/sports-card-mcp/input/player.jpg`를 사용해 sports-card MCP의 `create_sports_card`를 호출해 줘. `poster_style`은 `cinematic_poster`, 출력은 `/absolute/path/to/sports-card-mcp/output/card.png`, 이슈는 `walk_off`, 팀 색상은 `#7A0019`, 제목은 `끝내기 만루홈런`, 선수명은 `김재현`, 등번호는 `22`, 부제는 `한 방으로 경기를 끝냈다`, 영문 태그라인은 `WALK-OFF GRAND SLAM`으로 설정해. 먼저 dry_run으로 포스터 구도와 API 호출 수를 확인한 다음 제작해 줘.

먼저 비용만 확인하려면 같은 입력에 `dry_run: true`를 지정합니다. 예시 JSON:

```json
{
  "player_image": "/absolute/path/to/sports-card-mcp/input/player.jpg",
  "output_path": "/absolute/path/to/sports-card-mcp/output/card.png",
  "template": "night_stadium",
  "poster_style": "cinematic_poster",
  "background_prompt": "비 내리는 한국 프로야구 포스트시즌 야간 경기장",
  "team_color": "#003478",
  "headline": "승리의 주인공",
  "score_text": "7 : 3",
  "subheadline": "9회말 결승 홈런",
  "english_tagline": "WALK-OFF GRAND SLAM",
  "footer": "2026 POSTSEASON",
  "player_position": {
    "x": 540,
    "y": 1120,
    "scale": 1,
    "rotation": 0,
    "anchor": "center"
  },
  "text_safe_area": {
    "x": 80,
    "y": 80,
    "width": 920,
    "height": 1760
  },
  "seed": 42,
  "font_path": "/absolute/path/to/sports-card-mcp/assets/NotoSansKR-Bold.ttf",
  "dry_run": true
}
```

지원 템플릿은 `cinematic_red`, `championship_gold`, `night_stadium`, `certificate`, `breaking_news`입니다.

### 자동 디렉팅 호출 예시

끝내기 만루홈런처럼 강한 순간은 위치와 템플릿을 생략해도 됩니다.

```json
{
  "player_image": "/absolute/path/to/sports-card-mcp/input/kim-jaehyun.jpg",
  "output_path": "/absolute/path/to/sports-card-mcp/output/kim-jaehyun-grand-slam.png",
  "template": "auto",
  "issue_type": "grand_slam",
  "season": "2026 시즌",
  "league_label": "KBO HIGHLIGHT",
  "team_name": "키움 히어로즈",
  "player_name": "김재현",
  "jersey_number": "22",
  "team_color": "#7A0019",
  "secondary_color": "#111111",
  "accent_color": "#FF8A00",
  "headline": "끝내기\n만루홈런",
  "score_text": "WALK-OFF GRAND SLAM",
  "subheadline": "한 방으로 경기를 끝냈다",
  "callout": "9회말 승부를 끝낸 결정적 한 방",
  "footer": "2026 KBO SEASON",
  "layout_density": "maximum",
  "seed": 22
}
```

기록·계약·이적·일정 카드도 같은 구조에서 `issue_type`, 문구와 구단색만 바꾸면 됩니다. 배경 비용을 먼저 확인하려면 `dry_run: true`를 추가하세요.

## 비용 절감과 실패 재개

- 선수 누끼: 원본 SHA-256 + 세그멘테이션 모델 + 알고리즘 버전으로 캐시
- 배경: provider/model + 정규화 prompt + seed + aspect ratio로 캐시
- `reuse_background_path`: 허용 폴더의 기존 배경을 사용하고 배경 API 호출 생략
- `dry_run`: 파일 생성이나 API 호출 없이 캐시 적중과 예상 API 호출 수 반환
- 단계 재개: `output/.work/<work-id>/manifest.json`과 단계별 PNG를 보존하여 동일 요청 재호출 시 완료 단계를 건너뜀
- `force: true`: 캐시와 재개 산출물을 무시하고 다시 실행

일반적인 최초 전체 실행은 세그멘테이션 1회 + 배경 생성 1회로 API 호출 2회입니다. 두 캐시가 모두 적중하면 0회입니다.

## 모델 교체

초기 배경 endpoint는 `fal-ai/flux-pro/kontext/text-to-image`입니다. 배경 provider 인터페이스가 모델별 호출을 캡슐화하므로 text-to-image 입력이 호환되는 다른 endpoint로 바꿀 수 있습니다.

```dotenv
FAL_BACKGROUND_MODEL=fal-ai/flux-pro/kontext/text-to-image
FAL_SEGMENTATION_MODEL=fal-ai/birefnet/v2
```

선수 분리는 생성 과정이 아니라 세그멘테이션 과정입니다. 기본 provider는 BiRefNet의 `mask_only` 결과를 받아 원본 RGB에 알파만 합칩니다.

## 개발 명령

```bash
npm run dev
npm run typecheck
npm run build
npm test
npm start
```

상세 구조와 오류/보안 설계는 [docs/DESIGN.md](docs/DESIGN.md)를 참고하세요.
