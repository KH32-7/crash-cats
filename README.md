# CRASH CATS: Turbo Arena

고양이가 운전하는 전투 차량을 부품으로 조립하고, 자동 물리 배틀로 상대 차를 부수는 브라우저 게임입니다. (CATS: Crash Arena Turbo Stars 스타일, Three.js + Rapier 2D)

**플레이:** https://kh32-7.github.io/crash-cats/

## 모드
- **빠른 배틀** — 다른 플레이어가 저장한 차(서버) 또는 봇과 대결, 트로피·코인·상자 획득
- **온라인 대전** — 빠른 매칭 / 방 코드, 3판 2선승, 라운드 사이 차 수정 (멀티플레이 서버 필요)
- **로컬 2P** — 한 기기에서 두 명이 대결

> GitHub Pages는 정적 호스팅이라 실시간 대전 서버가 없습니다. Pages 버전에서는 빠른 배틀이 봇 상대로 동작하고 로컬 2P는 그대로 됩니다.
> 서버를 따로 띄운 뒤 저장소 변수 `VITE_WS_URL`(예: `wss://my-server.example.com/ws`)을 설정하고 다시 배포하면 온라인 대전이 켜집니다.

## 로컬 실행
```bash
npm install
npm run dev              # 클라이언트 http://127.0.0.1:5288 + 대전 서버 :5189
npm run build && npm start   # 프로덕션: 한 서버가 dist/ + /ws 제공 (:5189, PORT 환경변수)
npm test                 # Playwright 플레이테스트 + 두 브라우저 온라인 대전
npm run sim:balance      # 결정론/밸런스 헤드리스 검사
```

## 에셋
- Higgsfield 생성: 아레나 배경, 차고 배경, 로고, 아바타, 상자·코인·트로피 아이콘, 고양이 드라이버/불도저 3D, 아나운서 음성
- 절차적 생성: 차량 부품 전부, 바닥·소품, VFX, 효과음·음악

자세한 설계와 검증 기록은 `artifacts/design.md`, `artifacts/final-evidence.md` 참고.
