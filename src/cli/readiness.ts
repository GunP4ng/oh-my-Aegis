import { buildReadinessReport } from "../config/readiness";
import { loadConfig } from "../config/loader";
import { NotesStore } from "../state/notes-store";

export function runReadiness(projectDir: string): unknown {
  const configWarnings: string[] = [];
  const config = loadConfig(projectDir, { onWarning: (msg) => configWarnings.push(msg) });
  const notesStore = new NotesStore(projectDir, config.markdown_budget);
  const report = buildReadinessReport(projectDir, notesStore, config);
  return { ...report, configWarnings };
}
