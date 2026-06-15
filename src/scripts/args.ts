export interface ParsedArgs {
  flags: Record<string, string>;
  positional: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

export function requireCreator(flags: Record<string, string>): string {
  const c = flags.creator ?? process.env.SEARCH_CREATOR_ID;
  if (!c) throw new Error('Provide --creator <creatorId> (or set SEARCH_CREATOR_ID).');
  return c;
}
