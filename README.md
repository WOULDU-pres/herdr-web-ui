# macOS Cmd+Backspace 재현 자료

별도 테스트 세션의 실제 브라우저 키 이벤트, WebSocket 프레임과 PTY 수신 바이트를 비교했습니다.
브라우저는 Linux의 Playwright Chromium이며, MacIntel 플랫폼과 Command 키 이벤트를 재현한 컨텍스트입니다.
실제 macOS/Safari 기기 검증은 수행하지 않았습니다.

| 키 | 수정 전 | 수정 후 |
| --- | --- | --- |
| Backspace | `7f` | `7f` |
| Cmd+Backspace | `7f` | `15` |
| Ctrl+U | `15` | `15` |

## 수정 전

![수정 전 실제 수신 바이트](before.png)

## 수정 후

![수정 후 실제 수신 바이트](after.png)

`7f`는 DEL(한 글자 삭제), `15`는 Ctrl+U(줄 앞부분 삭제)입니다.
실제 Node readline PTY에 `remove this entire input`을 입력하고 Cmd+Backspace를 누른 뒤 입력 버퍼가 빈 문자열이 되는 것도 검증했습니다.

[전체 브라우저 로그](ui-regression.log), [수정 전 실패 재현](before-regression.log), [#334 백포트 검증](backport.log), [검증 결과](validation.txt).
