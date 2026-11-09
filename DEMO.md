# Kinproof, 90-second demo (v2)

**발표자 = 아빠 준호.** 사기범은 발표자의 목소리를 복제해서 할머니께 전화한다. 발표자가 자기 폰으로 "Not me"를 누른다.
심사 기준: 문제-해법 명확성 · 기술 구현 · 창의성 / 트랙: AI for the Aging Population × Proving You're Human

| 시간 | 화면 | 내레이션 (영어, 그대로 읽거나 조금 줄여서) |
|---|---|---|
| 0:00–0:06 | **슬라이드 1**: Kinproof 로고 + 한 줄 소개 | "Hi, I'm Kanghoun. This is Kinproof. It checks that a caller is really your family before anyone sends money." |
| 0:06–0:12 | **슬라이드 2**: 한국 보이스피싱 ₩1.26T, +47%, 건당 ₩53.8M | "Last year Koreans lost 1.26 trillion won to voice phishing. Up 47 percent. 54 million won per victim." |
| 0:12–0:18 | **슬라이드 3**: 60세 이상 $7.75B, +59% / 번호 유출, 목소리 복제 | "Older adults are hit hardest. Phone numbers leak, voices get cloned, and the parent who lives alone is the easiest target." |
| 0:18–0:24 | 가족 소개 → 4명 동의 | "This is my family. My mother lives alone. We all installed Kinproof." |
| 0:24–0:36 | 로봇 약, 바닥 물기 | "In the morning a robot brings her pills and wipes up water before she slips." |
| 0:36–0:46 | ChatGPT·Claude 동기화 | "We already talk to AI every day. Kinproof shares the dates and plans. Not our worries." |
| 0:46–0:50 | 할머니 음성 | "My mother doesn't use apps. She just asks." |
| 0:50–1:15 ⭐ | 복제 음성 → Is this you? → Not me → 차단 | (처음 두 문장은 조용히) "That's my voice. Cloned in one minute. I'm in a meeting, my phone isn't on a call, and I'm in Pangyo, not Busan. So it asks me. I tap Not me. Blocked." |
| 1:15–1:20 | Home Protector + 로고 | "Everything the family needs, on one screen. Kinproof. A voice isn't proof anymore. Family is." |

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
- "에이전트는 어디 있어? 그냥 LLM 호출 아냐?" → 일부러 그렇게 설계했다. 전화 차단·송금 같은 안전 판단을 에이전트에게 맡기지 않는다. AI는 주장과 원문 인용을 뽑기만 하고, 코드가 인용을 대화 원문과 대조하고 점수를 결정적으로 계산하며, 실패하면 숨기지 않고 알린다. AI가 환각을 일으켜도 할머니 돈은 안 움직인다.
  - EN: "AI gathers the evidence. Verifiable code makes the call. A hallucination can't move Grandma's money."
  - 다음 단계: 가족 캘린더를 보고 먼저 연락을 돌리는 능동형 가족 에이전트 (예: 할머니 병원 일정 → 엄마에게 알림, 누가 모시고 갈지 조율).

## 녹화 체크리스트
- [ ] ElevenLabs 복제 mp3 → `scam_clone`으로 가져오기
- [ ] 한 번 돌려 캐시를 채운 뒤 `OPENAI_API_KEY="" KP_LLM_MODE=replay`로 서버를 켜고 녹화 (오프라인, 대기 없음)
- [ ] ⌘⇧5 녹화 시 오디오(복제 음성) 들어가는지 확인
- [ ] 제출 직전 `gh repo edit --visibility public --accept-visibility-change-consequences`
