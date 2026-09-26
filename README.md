# CRASH CATS: Turbo Arena

고양이가 운전하는 전투 차량을 부품으로 조립하고, 자동 물리 배틀로 상대 차를 부수는 브라우저 게임입니다. (CATS: Crash Arena Turbo Stars 스타일, Three.js + Rapier 2D)

**플레이:** https://kh32-7.github.io/crash-cats/

## 모드
- **빠른 배틀** — 다른 플레이어가 저장한 차(서버 버전) 또는 봇과 대결, 트로피·코인·상자 획득
- **온라인 대전 (방 코드)** — 한 명이 **방 만들기** → 4글자 코드를 친구에게 전달 → 친구가 코드 입력 후 **참가**. 3판 2선승, 라운드 사이 상대 차를 보고 내 차 수정
- **로컬 2P** — 한 기기에서 두 명이 대결

### 멀티플레이 방식
- **GitHub Pages 버전:** 서버 없이 **P2P(WebRTC)** 로 연결됩니다. 방을 만든 사람의 브라우저가 심판(권위) 역할을 하고, 두 브라우저가 같은 시드로 결정론적 물리 전투를 똑같이 재생합니다. 연결 중개에는 무료 공개 PeerJS 서버를 씁니다. 매우 제한적인 네트워크(일부 회사망·모바일 대칭 NAT)에서는 연결이 안 될 수 있습니다.
- **서버 버전 (`npm start`):** 빠른 매칭(랜덤 상대), 방 코드, 고스트 풀까지 Node WebSocket 서버로 동작합니다. Pages 빌드에 `VITE_WS_URL` 저장소 변수를 설정하면 서버 모드로 바뀝니다.

## 로컬 실행
```bash
npm install
npm run dev              # 클라이언트 http://127.0.0.1:5288 + 대전 서버 :5189
npm run build && npm start   # 프로덕션: 한 서버가 dist/ + /ws 제공 (:5189, PORT 환경변수)
npm test                 # Playwright: 플레이테스트, 두 브라우저 서버 대전, 두 브라우저 P2P 방 대전
npm run sim:balance      # 결정론/밸런스 헤드리스 검사
```

## 에셋
- Higgsfield 생성: 아레나 배경, 차고 배경, 로고, 아바타, 상자·코인·트로피 아이콘, 고양이 드라이버/불도저 3D, 아나운서 음성
- 절차적 생성: 차량 부품 전부, 바닥·소품, VFX, 효과음·음악

자세한 설계와 검증 기록은 `artifacts/design.md`, `artifacts/final-evidence.md` 참고.
