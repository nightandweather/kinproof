# Kinproof, 90-second demo (v2)

**발표자 = 아빠 준호.** 사기범은 발표자의 목소리를 복제해서 할머니께 전화한다. 발표자가 자기 폰으로 "Not me"를 누른다.
심사 기준: 문제-해법 명확성 · 기술 구현 · 창의성 / 트랙: AI for the Aging Population × Proving You're Human

| 시간 | 화면 (자막) | 내레이션, 자막을 그대로 읽거나 조금 줄여서 |
|---|---|---|
| 0:00–0:08 | "Last year millions of SIM records leaked…" | "Last year millions of SIM records leaked. A phone number can be copied. So can a voice." |
| 0:08–0:15 | 가족 소개 → 4명 동의 | "This is my family. My mother lives alone. My son is fifteen. We all installed Kinproof." |
| 0:15–0:24 | 로봇 약, 바닥 물기 | "In the morning a robot brings my mother her pills, and wipes up water before she slips." |
| 0:24–0:36 | ChatGPT·Claude 동기화 | "We already talk to AI every day. Kinproof shares the dates and plans. Not our worries." |
| 0:36–0:40 | 할머니 음성 | "My mother doesn't use apps. She just asks." |
| 0:40–1:05 ⭐ | 복제 음성 통화 → Is this you? → Not me → 차단 | (처음 두 문장은 조용히 들려주기) "That's my voice. Cloned in one minute. I'm in a meeting, my phone isn't on a call, and I'm in Pangyo, not Busan. So it asks me. I tap Not me. Blocked." |
| 1:05–1:15 | Home Protector, 야간 드론 | "Everything the family needs is on one screen, and every decision is logged." |
| 1:15–1:20 | 로고 | "Kinproof. A voice isn't proof anymore. Family is." |

## 화면 조작 순서 (스토리 모드를 쓰면 자동)
1. Reset → ▶ Story mode (약 85초), 동의 → 로봇 → 물기 → 엄마·아빠·지훈 동기화 → 할머니 음성 → **복제 음성 통화 → 차단** → Home Protector → 야간 드론
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
