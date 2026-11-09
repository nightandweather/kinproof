# Kinproof — 90-second demo (v2)

**발표자 = 아빠 준호.** 사기범은 발표자의 목소리를 복제해서 할머니께 전화한다. 발표자가 자기 폰으로 "Not me"를 누른다.
심사 기준: 문제-해법 명확성 · 기술 구현 · 창의성 / 트랙: AI for the Aging Population × Proving You're Human

| 시간 | 화면 | 내레이션 (영어, 약 210단어) |
|---|---|---|
| **0:00–0:10** 훅 | 검은 화면 자막: "2025: SIM data of millions leaked" → "Your number can be cloned. Your voice too." | "Last year a Korean carrier leaked SIM data for millions of people. Your number can be cloned — and with ten seconds of video, so can your voice." |
| **0:10–0:18** 문제→해법 | 폰 4대, 동의 4/4 | "My mother lives alone. My son is fifteen. So my family installs Kinproof — a security layer every family member opts into." |
| **0:18–0:28** 가족 위키 | 내 ChatGPT 동기화 → 승인 → 달력에 일정, "kept private: 주식" | "It learns from what we already tell our AI assistants: I'm at the Pangyo office all week. Only facts I approve are shared — my worries stay private." |
| **0:28–0:60** ⭐ 핵심 | `scam_clone` 재생: 내 복제 목소리 → 체크리스트 ✗ → 내 폰 "Is this you?" → **Not me** → 빨간 차단 → 112 카드 | "This is my cloned voice calling my mother. Kinproof doesn't trust voices. It checks what a clone can't copy: my real phone isn't on a call, I'm in a meeting with Do Not Disturb on, and the caller says Busan while my phone says Pangyo. It breaks through Do Not Disturb to ask me. I tap 'Not me'. Blocked — and my wife gets the reasons and a one-tap 112 report." |
| **0:60–0:74** 고령자 돌봄 | 할머니 큰 버튼 → 음성 대답 / 로봇 약 + 물기 사진 / 스미싱 문자 ⚠ | "The same family context protects her every day. She just talks. A home robot brings her pills and mops a spill before she slips. Smishing texts and transfers right after a suspicious call get flagged." (화면 자막: simulated devices) |
| **0:74–0:84** 기술 | 에이전트 로그, 증거 칩(인용 + code 배지) | "The model only extracts evidence. Every quote is verified in code, the score is deterministic, and it fails loud." |
| **0:84–0:90** 사업·마무리 | 로고 | "9,900 won a month per family. Kinproof — voice isn't proof anymore. Family is." |

## 화면 조작 순서 (스토리 모드를 쓰면 자동)
1. Reset → ▶ Story mode (약 85초) — 동의 → 로봇 → 물기 → 엄마·아빠·지훈 동기화 → 할머니 음성 → **복제 음성 통화 → 차단** → Home Protector → 야간 드론
2. 스토리 모드 대신 직접 클릭해도 됨: 동기화는 미리 끝내 두고, 통화 장면부터 녹화하면 가장 깔끔

## 꼭 들어갈 것
- 유심·목소리 복제 훅 (문제)
- **내 목소리 복제 → 내가 Not me** (Proving You're Human)
- 할머니 음성 + 돌봄 장면 1개 이상 (Aging)
- "모델은 추출, 판정은 코드" (기술)
- 시뮬레이션 표시가 보이는 상태로

## 질의응답 대비 한 줄
- "iPhone은 통화 음성을 못 읽잖아?" → 통화 분석은 통신사 제휴, 가족 검증(통화 중 여부·위치 일치·Not me)은 앱. 
- "딥페이크 탐지는?" → 탐지는 새 모델이 나올 때마다 진다. 우리는 복제할 수 없는 것을 검증한다.
- "15살 아이 사칭은?" → 같은 검증 (Teen scam 대본으로 시연 가능).
- "프라이버시?" → 대화가 아니라 승인된 사실만, 위치는 일치 여부만, 지도는 전원 동의 시에만.

## 녹화 체크리스트
- [ ] ElevenLabs 복제 mp3 → `scam_clone`으로 가져오기
- [ ] 한 번 돌려 캐시를 채운 뒤 `OPENAI_API_KEY="" KP_LLM_MODE=replay`로 서버를 켜고 녹화 (오프라인, 대기 없음)
- [ ] ⌘⇧5 녹화 시 오디오(복제 음성) 들어가는지 확인
- [ ] 제출 직전 `gh repo edit --visibility public --accept-visibility-change-consequences`
