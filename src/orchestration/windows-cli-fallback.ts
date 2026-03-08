export interface WindowsCliFallbackCandidate {
  name: string;
  command: string;
  install: string[];
  rationale: string;
}

export interface WindowsCliFallbackPlan {
  tool: string;
  purpose: string;
  candidates: WindowsCliFallbackCandidate[];
  searchCommands: string[];
}

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase();
}

function genericPlan(tool: string, purpose: string): WindowsCliFallbackPlan {
  return {
    tool,
    purpose,
    candidates: [
      {
        name: `${tool}-cli-search`,
        command: `winget search ${JSON.stringify(tool)}`,
        install: [
          `winget search ${JSON.stringify(tool)}`,
          `choco search ${JSON.stringify(tool)}`,
        ],
        rationale: "Search for a CLI-capable package first, then install with winget or choco.",
      },
    ],
    searchCommands: [
      `winget search ${JSON.stringify(tool)}`,
      `choco search ${JSON.stringify(tool)}`,
      `powershell -NoProfile -Command "Get-Command ${tool} -ErrorAction SilentlyContinue"`,
    ],
  };
}

export function buildWindowsCliFallbackPlan(tool: string, purpose = "continue the current task without GUI blockers"): WindowsCliFallbackPlan {
  const key = normalizeKey(tool);
  if (!key) {
    return genericPlan("unknown-tool", purpose);
  }

  if (key.includes("wireshark") || key.includes("pcap")) {
    return {
      tool,
      purpose,
      candidates: [
        {
          name: "tshark",
          command: "tshark -r capture.pcapng",
          install: [
            "winget install -e --id WiresharkFoundation.Wireshark",
            "choco install wireshark -y",
          ],
          rationale: "Wireshark GUI workflows can be replaced with tshark for capture inspection and filtering.",
        },
      ],
      searchCommands: ["where tshark", "winget search wireshark", "choco search wireshark"],
    };
  }

  if (key.includes("ghidra") || key.includes("ida") || key.includes("disassembler") || key.includes("reverse")) {
    return {
      tool,
      purpose,
      candidates: [
        {
          name: "rizin",
          command: "rizin -A <binary>",
          install: [
            "winget install -e --id RizinOrg.Rizin",
            "choco install rizin -y",
          ],
          rationale: "Rizin gives a CLI-native reverse-engineering path when GUI disassemblers are blocked.",
        },
        {
          name: "radare2",
          command: "r2 -A <binary>",
          install: [
            "winget install -e --id RadareOrg.Radare2",
            "choco install radare2 -y",
          ],
          rationale: "radare2 is a common CLI fallback for binary inspection and patching tasks.",
        },
      ],
      searchCommands: ["where rizin", "where r2", "winget search rizin", "winget search radare2"],
    };
  }

  if (key.includes("browser") || key.includes("chrome") || key.includes("edge") || key.includes("burp")) {
    return {
      tool,
      purpose,
      candidates: [
        {
          name: "curl",
          command: "curl -i https://target.example",
          install: [],
          rationale: "curl is present on most modern Windows installs and covers non-interactive HTTP validation.",
        },
        {
          name: "httpie",
          command: "http GET https://target.example",
          install: [
            "winget install -e --id HTTPie.HTTPie",
            "choco install httpie -y",
          ],
          rationale: "HTTPie is a friendly CLI fallback for browser/proxy validation flows.",
        },
      ],
      searchCommands: ["where curl", "where http", "winget search httpie"],
    };
  }

  if (key.includes("procmon") || key.includes("task manager") || key.includes("process")) {
    return {
      tool,
      purpose,
      candidates: [
        {
          name: "powershell-process",
          command: 'powershell -NoProfile -Command "Get-Process | Sort-Object CPU -Descending | Select-Object -First 20"',
          install: [],
          rationale: "PowerShell can replace most GUI process/task inspection flows on Windows.",
        },
      ],
      searchCommands: ["where powershell", 'powershell -NoProfile -Command "Get-Command Get-Process"'],
    };
  }

  return genericPlan(tool, purpose);
}
