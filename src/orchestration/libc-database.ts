export interface LibcMatch {
  id: string;
  buildId?: string;
  symbols: Record<string, number>;
}

export interface LibcLookupRequest {
  symbolName: string;
  address: string;
}

export interface LibcLookupResult {
  matches: LibcMatch[];
  lookupSource: string;
  query: LibcLookupRequest[];
}

const COMMON_LIBCS: LibcMatch[] = [
  {
    id: "libc6_2.31-0ubuntu9.9_amd64",
    symbols: {
      puts: 0x0875a0,
      printf: 0x064e80,
      read: 0x111130,
      write: 0x1111d0,
      system: 0x055410,
      execve: 0x0e5f00,
      str_bin_sh: 0x1b75aa,
      __libc_start_main: 0x026fc0,
      __free_hook: 0x1eeb28,
      __malloc_hook: 0x1ebb70,
      setcontext: 0x058d00,
      one_gadget_0: 0x0e6c7e,
      one_gadget_1: 0x0e6c81,
      one_gadget_2: 0x0e6c84,
    },
  },
  {
    id: "libc6_2.27-3ubuntu1_amd64",
    symbols: {
      puts: 0x0809c0,
      printf: 0x064e10,
      read: 0x110070,
      write: 0x110140,
      system: 0x04f440,
      execve: 0x0e4e30,
      str_bin_sh: 0x1b3e9a,
      __libc_start_main: 0x021ab0,
      __free_hook: 0x3ed8e8,
      __malloc_hook: 0x3ebc30,
      setcontext: 0x052110,
      one_gadget_0: 0x04f2a5,
      one_gadget_1: 0x04f302,
      one_gadget_2: 0x10a2fc,
    },
  },
  {
    id: "libc6_2.23-0ubuntu11.3_amd64",
    symbols: {
      puts: 0x06f690,
      printf: 0x055800,
      read: 0x0f7250,
      write: 0x0f72b0,
      system: 0x045390,
      execve: 0x0cc770,
      str_bin_sh: 0x18cd57,
      __libc_start_main: 0x020740,
      __free_hook: 0x3c67a8,
      __malloc_hook: 0x3c4b10,
      setcontext: 0x047b75,
      one_gadget_0: 0x045216,
      one_gadget_1: 0x04526a,
      one_gadget_2: 0x0f02a4,
      one_gadget_3: 0x0f1147,
    },
  },
];

function parseAddress(value: string): bigint | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-f]+$/.test(normalized)) {
    return null;
  }

  try {
    return BigInt(normalized);
  } catch {
    return null;
  }
}

function normalizeSymbolName(name: string): string {
  return name.trim();
}

function safeQueryRequests(requests: LibcLookupRequest[]): LibcLookupRequest[] {
  if (!Array.isArray(requests)) {
    return [];
  }

  const output: LibcLookupRequest[] = [];
  for (const request of requests) {
    const symbolName = normalizeSymbolName(request.symbolName ?? "");
    const parsed = parseAddress(request.address ?? "");
    if (!symbolName || parsed === null) {
      continue;
    }
    output.push({
      symbolName,
      address: `0x${parsed.toString(16)}`,
    });
  }
  return output;
}

function symbolOffsetNibble(offset: number): string {
  return (offset & 0xfff).toString(16).padStart(3, "0");
}

/**
 * Extract the last 3 hex nibbles from an address.
 */
export function extractOffset(address: string): string {
  const parsed = parseAddress(address ?? "");
  if (parsed === null) {
    return "";
  }
  const nibbles = Number(parsed & BigInt(0xfff));
  return nibbles.toString(16).padStart(3, "0");
}

/**
 * Perform local libc lookup by matching leaked symbol low 12-bit offsets.
 */
export function localLookup(requests: LibcLookupRequest[]): LibcLookupResult {
  const query = safeQueryRequests(requests);
  if (query.length === 0) {
    return {
      matches: [],
      lookupSource: "local",
      query: [],
    };
  }

  const matches = COMMON_LIBCS.filter((libc) => {
    return query.every((request) => {
      const symbolOffset = libc.symbols[request.symbolName];
      if (typeof symbolOffset !== "number") {
        return false;
      }
      return symbolOffsetNibble(symbolOffset) === extractOffset(request.address);
    });
  });

  return {
    matches,
    lookupSource: "local",
    query,
  };
}

/**
 * Build libc.rip API lookup URL from leaked symbol requests.
 */
export function buildLibcRipUrl(requests: LibcLookupRequest[]): string {
  const query = safeQueryRequests(requests);
  if (query.length === 0) {
    return "https://libc.rip/";
  }

  const params = query
    .map((request) => `${encodeURIComponent(request.symbolName)}=${encodeURIComponent(extractOffset(request.address))}`)
    .join("&");
  return `https://libc.rip/api/find?${params}`;
}

/**
 * Build a libc-database command for local shell usage.
 */
export function buildLibcDbCommand(requests: LibcLookupRequest[]): string {
  const query = safeQueryRequests(requests);
  if (query.length === 0) {
    return "./find";
  }

  const args = query
    .map((request) => {
      const safeSymbol = request.symbolName.replace(/[^a-zA-Z0-9_@.$]/g, "");
      return `${safeSymbol} ${extractOffset(request.address)}`;
    })
    .join(" ");
  return `./find ${args}`.trim();
}

/**
 * Return useful exploitation offsets for a selected libc.
 */
export function getUsefulOffsets(libc: LibcMatch): Record<string, number | null> {
  const symbols = libc?.symbols ?? {};
  const oneGadgetKeys = Object.keys(symbols)
    .filter((key) => key.startsWith("one_gadget_"))
    .sort();

  const offsets: Record<string, number | null> = {
    puts: symbols.puts ?? null,
    printf: symbols.printf ?? null,
    read: symbols.read ?? null,
    write: symbols.write ?? null,
    system: symbols.system ?? null,
    execve: symbols.execve ?? null,
    str_bin_sh: symbols.str_bin_sh ?? null,
    __libc_start_main: symbols.__libc_start_main ?? null,
    __free_hook: symbols.__free_hook ?? null,
    __malloc_hook: symbols.__malloc_hook ?? null,
    setcontext: symbols.setcontext ?? null,
  };

  for (const key of oneGadgetKeys) {
    offsets[key] = symbols[key] ?? null;
  }

  return offsets;
}

/**
 * Build a readable summary from libc lookup result.
 */
export function buildLibcSummary(result: LibcLookupResult): string {
  const queryText = result.query.map((q) => `${q.symbolName}@${extractOffset(q.address)}`).join(", ") || "none";
  if (result.matches.length === 0) {
    return [
      `Libc lookup source: ${result.lookupSource}`,
      `Query: ${queryText}`,
      "No local libc candidates matched all provided leaked offsets.",
    ].join("\n");
  }

  const lines = [
    `Libc lookup source: ${result.lookupSource}`,
    `Query: ${queryText}`,
    `Candidates: ${result.matches.length}`,
  ];

  for (const libc of result.matches) {
    const useful = getUsefulOffsets(libc);
    lines.push(
      `- ${libc.id}${libc.buildId ? ` (buildId=${libc.buildId})` : ""}`,
      `  system=${useful.system ?? "n/a"} | /bin/sh=${useful.str_bin_sh ?? "n/a"} | __free_hook=${useful.__free_hook ?? "n/a"}`
    );
  }

  return lines.join("\n");
}

/**
 * Compute libc base address from leaked runtime address and symbol offset.
 */
export function computeLibcBase(leakedAddress: string, symbolOffset: number): string {
  const parsedLeak = parseAddress(leakedAddress ?? "");
  if (parsedLeak === null || !Number.isFinite(symbolOffset) || symbolOffset < 0) {
    return "";
  }

  const offset = BigInt(Math.trunc(symbolOffset));
  if (parsedLeak < offset) {
    return "";
  }

  const base = parsedLeak - offset;
  return `0x${base.toString(16)}`;
}
