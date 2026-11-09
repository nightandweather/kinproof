# Kinproof — 90-second demo video

심사 기준: **문제-해법 명확성 · 기술 구현 · 창의성** → 문제(10초) → 핵심 장면(45초) → 플랫폼(20초) → 기술·사업(15초)
녹화: Chrome 전체 화면 → **⌘⇧5** 화면 녹화 + 마이크로 영어 내레이션. 화면은 Story mode로 돌리거나 단계별로 직접 클릭.

| 시간 | 화면 | 내레이션 (영어, 약 220단어) |
|---|---|---|
| **0:00–0:10** 문제 | 검은 화면에 숫자 → 폰 4대 | "Last year Koreans lost 1.26 trillion won to voice phishing — 54 million won per victim. Now a scammer needs ten seconds of audio to clone your grandson's voice." |
| **0:10–0:18** 해법 한 줄 | 폰 4대 동의 화면 → 4/4 | "Kinproof is a family safety layer. Every family member installs it and agrees — then Grandma is protected." |
| **0:18–0:28** 가족 위키 | 엄마 ChatGPT 동기화 → 승인 → 달력에 일정이 떨어짐, 비공개 주제 | "It learns from what families already tell their AI assistants. Mom mentions Grandma's MRI to ChatGPT — Kinproof shares the appointment, not the chat. Her job worries stay private." |
| **0:28–0:58** ⭐ 핵심: 복제 음성 전화 | `scam_clone` 재생: 복제 음성이 들리고, 자막 → 체크리스트 ✗ → 지훈 폰 "Is this you?" → Not me → 빨간 차단 | "This call is my own voice, cloned in a minute. It sounds exactly like Ji-hoon — so Kinproof doesn't trust the voice. It checks what a clone can't copy: Ji-hoon's real phone isn't on a call, he's at work in Gangnam with Do Not Disturb on, but the caller says Busan. Kinproof breaks through Do Not Disturb and asks the real Ji-hoon. He taps 'Not me.' Blocked — and Mom and Dad are told exactly why." |
| **0:58–1:12** 고령자 돌봄 플랫폼 | 할머니 음성 버튼 → 소리로 대답 / Home Protector: 로봇 약, 바닥 물기 전후 사진 / 타임테이블 | "The same family context runs Grandma's day. She just talks. A home robot brings her pills and mops a spill before she slips. Everyone sees one calendar." (로봇 장면 화면 위에 'simulated devices' 자막) |
| **1:12–1:24** 기술 신뢰 | 에이전트 로그 + 증거 칩(통화 인용, 위키 인용, code 배지) | "Under the hood, the model only extracts evidence. Every quote is verified in code, scores are deterministic, and if the model fails, it fails loud." |
| **1:24–1:30** 사업 + 마무리 | 로고 | "9,900 won a month per family. One stopped scam pays for 450 years. Kinproof — voice isn't proof anymore. Family is." |

## 꼭 들어가야 하는 것 (빠지면 감점)
1. **문제 숫자** (첫 10초)
2. **복제 음성 → 차단** 장면 전체 (Proving You're Human의 증거)
3. **할머니가 말로 쓰는 장면** 1개 (AI for the Aging Population의 증거)
4. **모델은 추출만, 판정은 코드** 한 문장 (기술 구현 점수)
5. 시뮬레이션인 부분(로봇·GPS·통화 상태)은 화면에 "simulated"라고 표시된 상태로 보여주기

## 빼도 되는 것 (레포에는 남겨두기)
집안일, 빨래, 지도, 현관 도어캠, 집 기기 명령 → 시간 남으면 1~2초만 스치듯

## 녹화 체크리스트
- [ ] Reset → 동의 4/4 → 동기화와 승인까지 끝낸 상태에서 녹화 시작 (모델 응답 대기 시간 줄이기)
- [ ] `KP_LLM_MODE=replay`로 서버를 다시 켜면, 한 번 돌린 응답을 캐시에서 바로 재생 (와이파이 무관, 대기 없음)
- [ ] 복제 음성이 영상에 들리도록 시스템 오디오 녹음 켜기 (⌘⇧5 → 옵션 → 마이크 / 또는 Loom)
- [ ] 90초 넘으면 1:12–1:24 구간을 줄이기
- [ ] 제출 직전: `gh repo edit --visibility public --accept-visibility-change-consequences`
