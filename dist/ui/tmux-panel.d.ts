/**
 * tmux-panel.ts
 *
 * tmux 세션 내에서 Aegis Flow 패널을 생성하고 관리합니다.
 * tmux 외부 실행 시 조용히 스킵합니다.
 */
/**
 * tmux 세션 내에서 우측 분할 패널을 생성하고
 * `oh-my-aegis flow --watch <rootDir>` 를 실행합니다.
 */
export declare function spawnFlowPanel(rootDir: string): void;
/** 플러그인 종료 시 Flow 패널 닫기 */
export declare function closeFlowPanel(): void;
