/**
 * The environment handed to the private browser.
 *
 * A child process inherits its parent's environment by default, and that default
 * is wrong here in a way that is easy to miss because nothing visibly breaks.
 * The MCP server runs inside the operator's shell session, so its environment
 * routinely carries:
 *
 *  - **proxy configuration** (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`,
 *    `NO_PROXY`, and their lowercase spellings). Chromium honours these. A
 *    runtime that contractually makes no outbound request would, on a machine
 *    with a corporate proxy set, send every request it does make through a third
 *    party — and the proxy URL itself often embeds credentials;
 *  - **code injection vectors** (`LD_PRELOAD`, `LD_LIBRARY_PATH`,
 *    `DYLD_INSERT_LIBRARIES`, `DYLD_LIBRARY_PATH`, `NODE_OPTIONS`). Any of these
 *    loads attacker- or accident-chosen code into the browser we launch, inside
 *    the same trust boundary as the designs it renders;
 *  - **credentials** (`AWS_*`, `GITHUB_TOKEN`, `*_API_KEY`, `*_SECRET`, …).
 *    Chromium has no use for a single one of them, and a crash report or a
 *    `/proc/<pid>/environ` read turns an inherited secret into a leaked one.
 *
 * So the policy is **deny by default**: the child gets only the variables named
 * here, and nothing else, whatever the parent happens to be holding. An
 * allowlist fails closed — an unfamiliar variable is simply absent, rather than
 * being passed through because nobody thought to add it to a blocklist.
 *
 * `DENIED_EXACT`/`DENIED_PATTERNS` exist on top of that not because the
 * allowlist needs help, but because they are the *statement of intent* the tests
 * assert against: they name what must never appear even if someone later widens
 * the allowlist or adds a wildcard. They are checked after the allowlist, so a
 * mistake in one is caught by the other.
 */

/**
 * Variables the child genuinely needs. Everything here is either required for a
 * process to start at all (loader, temp, locale) or required for Playwright to
 * find the browser it is supposed to launch.
 */
const ALLOWED = [
  // POSIX + Windows process basics
  'PATH',
  'PATHEXT',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  // Windows loader and shell basics. Chromium does not start without these.
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'PROGRAMDATA',
  'COMMONPROGRAMFILES',
  'LOCALAPPDATA',
  'APPDATA',
  'USERPROFILE',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'SESSIONNAME',
  // Where the pinned browser lives. Setup points this at the payload's own
  // browser directory; without it Playwright looks in the machine-wide cache.
  'PLAYWRIGHT_BROWSERS_PATH',
]

/**
 * Never present in the child, stated explicitly.
 *
 * Case-insensitive: Windows environment names are case-insensitive, and the
 * lowercase proxy spellings are the ones curl-style tooling actually sets.
 */
const DENIED_EXACT = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'FTP_PROXY',
  'PROXY',
  'NODE_OPTIONS',
  'NODE_REPL_EXTERNAL_MODULE',
  'NODE_EXTRA_CA_CERTS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'BASH_ENV',
  'ENV',
  'PYTHONSTARTUP',
  'PERL5OPT',
  'GIT_SSH_COMMAND',
  'SSH_AUTH_SOCK',
  'ELECTRON_RUN_AS_NODE',
]

/** Credential-shaped names. Anything matching is refused whatever it is called. */
const DENIED_PATTERNS = [
  /TOKEN/,
  /SECRET/,
  /PASSWORD/,
  /PASSWD/,
  /API[_-]?KEY/,
  /^AWS_/,
  /^AZURE_/,
  /^GOOGLE_APPLICATION_CREDENTIALS$/,
  /^GH_/,
  /^GITHUB_/,
  /CREDENTIAL/,
  /^NPM_CONFIG_/,
  /SESSION_KEY/,
  /PRIVATE_KEY/,
]

/**
 * Values forced on regardless of the parent.
 *
 * `DO_NOT_TRACK` and the Playwright telemetry flags are the runtime's "telemetry
 * disabled" contract expressed to the child rather than assumed of it. The
 * browser-download skip matters more than it looks: if Playwright decides a
 * browser is missing it will try to fetch one, and this runtime must never
 * download anything — a missing browser is an error the operator resolves during
 * setup, not something the runtime silently repairs over the network.
 */
const FORCED: Record<string, string> = {
  DO_NOT_TRACK: '1',
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  PLAYWRIGHT_SKIP_BROWSER_GC: '1',
}

function isDenied(name: string): boolean {
  const upper = name.toUpperCase()
  if (DENIED_EXACT.includes(upper)) return true
  return DENIED_PATTERNS.some((pattern) => pattern.test(upper))
}

/**
 * Build the environment for a child process this server launches.
 *
 * Returns a fresh object every call; nothing here mutates `process.env`, because
 * the MCP process's own environment is the host's business, not ours.
 */
export function childEnvironment(parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const allowed = new Set(ALLOWED)
  const result: Record<string, string> = {}

  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined) continue
    if (!allowed.has(name.toUpperCase())) continue
    if (isDenied(name)) continue
    result[name] = value
  }

  for (const [name, value] of Object.entries(FORCED)) {
    result[name] = value
  }

  return result
}

/** Exposed for the adversarial tests, which assert on the policy itself. */
export const CHILD_ENV_POLICY = {
  allowed: [...ALLOWED],
  deniedExact: [...DENIED_EXACT],
  deniedPatterns: DENIED_PATTERNS.map((pattern) => pattern.source),
  forced: { ...FORCED },
  isDenied,
}
