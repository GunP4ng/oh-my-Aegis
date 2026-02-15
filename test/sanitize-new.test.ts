import { describe, expect, it } from "bun:test";
import { detectInteractiveCommand, sanitizeThinkingBlocks } from "../src/risk/sanitize";

describe("detectInteractiveCommand", () => {
  it("blocks git rebase -i", () => {
    const result = detectInteractiveCommand("git rebase -i HEAD~3");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("git_rebase_i");
  });

  it("blocks git rebase --interactive", () => {
    const result = detectInteractiveCommand("git rebase --interactive main");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("git_rebase_i");
  });

  it("blocks git add -i", () => {
    const result = detectInteractiveCommand("git add -i");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("git_add_i");
  });

  it("blocks git add --patch", () => {
    const result = detectInteractiveCommand("git add --patch");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("git_add_i");
  });

  it("blocks git commit without -m", () => {
    const result = detectInteractiveCommand("git commit");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("git_commit_no_msg");
  });

  it("allows git commit -m 'msg'", () => {
    const result = detectInteractiveCommand("git commit -m 'fix bug'");
    expect(result).toBeNull();
  });

  it("allows git commit --message='msg'", () => {
    const result = detectInteractiveCommand("git commit --message='fix bug'");
    expect(result).toBeNull();
  });

  it("blocks vim", () => {
    const result = detectInteractiveCommand("vim src/index.ts");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("editor_vim");
  });

  it("blocks nano", () => {
    const result = detectInteractiveCommand("nano file.txt");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("editor_vim");
  });

  it("blocks pipe to less", () => {
    const result = detectInteractiveCommand("cat file.txt | less");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("less_more");
  });

  it("blocks bare python", () => {
    const result = detectInteractiveCommand("python3");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("interactive_python");
  });

  it("allows python with script", () => {
    const result = detectInteractiveCommand("python3 script.py");
    expect(result).toBeNull();
  });

  it("allows python -c", () => {
    const result = detectInteractiveCommand("python3 -c 'print(1)'");
    expect(result).toBeNull();
  });

  it("blocks bare node", () => {
    const result = detectInteractiveCommand("node");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("interactive_node");
  });

  it("allows node with script", () => {
    const result = detectInteractiveCommand("node app.js");
    expect(result).toBeNull();
  });

  it("blocks bash -i", () => {
    const result = detectInteractiveCommand("bash -i");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("interactive_flag");
  });

  it("allows normal bash commands", () => {
    const result = detectInteractiveCommand("ls -la");
    expect(result).toBeNull();
  });

  it("allows git status", () => {
    const result = detectInteractiveCommand("git status");
    expect(result).toBeNull();
  });

  it("allows cat", () => {
    const result = detectInteractiveCommand("cat README.md");
    expect(result).toBeNull();
  });
});

describe("sanitizeThinkingBlocks", () => {
  it("returns null for normal text", () => {
    expect(sanitizeThinkingBlocks("Hello world")).toBeNull();
  });

  it("returns null for empty text", () => {
    expect(sanitizeThinkingBlocks("")).toBeNull();
    expect(sanitizeThinkingBlocks("   ")).toBeNull();
  });

  it("returns null for properly balanced thinking blocks", () => {
    expect(sanitizeThinkingBlocks("<thinking>some thought</thinking>")).toBeNull();
  });

  it("closes unclosed thinking tags", () => {
    const result = sanitizeThinkingBlocks("<thinking>some thought");
    expect(result).not.toBeNull();
    expect(result).toContain("</thinking>");
  });

  it("removes orphaned closing tags", () => {
    const result = sanitizeThinkingBlocks("some text</thinking>");
    expect(result).not.toBeNull();
    expect(result).not.toContain("</thinking>");
    expect(result).toContain("some text");
  });

  it("strips thinking: prefix", () => {
    const result = sanitizeThinkingBlocks("thinking: here is my analysis");
    expect(result).not.toBeNull();
    expect(result).not.toMatch(/^thinking:/i);
    expect(result).toContain("here is my analysis");
  });

  it("does not strip thinking: if inside actual tags", () => {
    const text = "<thinking>thinking: nested</thinking>";
    const result = sanitizeThinkingBlocks(text);
    // Tags are balanced, so no modification needed
    expect(result).toBeNull();
  });
});
