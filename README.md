# 알림음 겹침 수정 검증 자료

별도 herdr 세션(`herdr-web-ui-test-sound`)의 테스트 pane에 `pane.report_agent`로 실제 상태 변화를 보내고,
Linux(WSL)의 Chrome에서 `scripts/alert-sound-regression.ts`를 실행한 결과입니다.
페이지의 `AudioContext`는 재생 요청된 음을 기록하는 대체 객체이며, `currentTime`은 실제처럼 흐릅니다.

| 로그 | 코드 | 결과 |
| --- | --- | --- |
| [before-main.log](before-main.log) | 수정 전 `main`(`7c5fe4e`) + 새 검사 | 실패: 두 pane이 동시에 대기하면 `[660, 880, 660, 880]` |
| [before-in-tab-only.log](before-in-tab-only.log) | 이번 변경에서 Web Lock만 끈 상태 | 실패: 두 탭이 같은 알림에 `[660, 880, 660, 880]` |
| [after-1.log](after-1.log), [after-2.log](after-2.log), [after-3.log](after-3.log) | 이번 변경 | 연속 3회 모두 통과 |
| [ui-regression.log](ui-regression.log) | 이번 변경, `bun run test:ui` 전체 | 67개 PASS, 종료 코드 0 |

헤드리스 환경이라 실제 스피커 출력은 포함하지 않았습니다.
