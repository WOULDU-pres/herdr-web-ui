# evidence/chat-follow-new-session

PR 검증 자료입니다. 테스트 전용 herdr 세션과 임시 폴더(/tmp/omo-new-probe)에서 생성했습니다.

- before.png / after.png: omo에서 /new 직후(아무것도 입력하지 않음) 채팅 화면, 수정 전과 수정 후
- probe-before.log / probe-after.log: 각 단계의 /api/pane/conversation 응답과 화면 텍스트
- omo-new-probe.ts: 위 기록을 만든 재현 스크립트
