/**
 * flow-watch.ts
 *
 * `oh-my-aegis flow --watch <flowJsonPath>` 서브커맨드.
 * tmux 패널 내부에서 실행되어 FLOW.json을 폴링하며 플로우차트를 갱신합니다.
 * `oh-my-aegis flow --once <flowJsonPath>` 는 현재 상태를 1회 출력합니다.
 */
export declare function runFlowWatch(args: string[]): Promise<number>;
