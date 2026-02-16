import { buildReadinessReport } from "../config/readiness";
import { loadConfig } from "../config/loader";
import { NotesStore } from "../state/notes-store";

export function runReadiness(projectDir: string): unknown {
  const config = loadConfig(projectDir);
  const notesStore = new NotesStore(projectDir, config.markdown_budget);
  return buildReadinessReport(projectDir, notesStore, config);
}
