/**
 * Best-effort screen for commands Poko never offers for approval: network access, installs and
 * publishing, deployment, git operations that reach a remote or discard work, privilege
 * escalation, and recursive deletion. Phase 04 keeps these unavailable.
 *
 * This is defense in depth, not containment. A shell can hide intent (variables, eval, scripts),
 * so an approved command still runs outside the sandbox and the approval card says so.
 */
const deniedPatterns: Array<{ reason: string; pattern: RegExp }> = [
  { reason: "network", pattern: /\bhttps?:\/\//i },
  {
    reason: "network",
    pattern:
      /(^|[\s;&|(`$"'])(curl|wget|ssh|scp|sftp|rsync|nc|ncat|telnet|ftp|socat)(\s|$|["';&|)])/i,
  },
  {
    reason: "install or publish",
    pattern:
      /(^|[\s;&|(`$"'])(npm|pnpm|yarn|bun|pip|pip3|gem|cargo|brew|apt|apt-get|go)\s+(install|i|add|publish|update|upgrade|get)(\s|$|["';&|)])/i,
  },
  { reason: "install or publish", pattern: /(^|[\s;&|(`$"'])(npx|bunx|pnpx)(\s|$|["';&|)])/i },
  {
    reason: "git remote or discard",
    pattern:
      /(^|[\s;&|(`$"'])git\s+(push|pull|fetch|clone|remote|reset|clean|rebase|checkout\s+--|restore|stash\s+drop)(\s|$|["';&|)])/i,
  },
  {
    reason: "deployment",
    pattern:
      /(^|[\s;&|(`$"'])(vercel|netlify|firebase|flyctl|fly|heroku|kubectl|terraform|helm)(\s|$|["';&|)])|docker\s+(push|login)/i,
  },
  { reason: "privilege", pattern: /(^|[\s;&|(`$"'])(sudo|su|doas|chown)(\s|$|["';&|)])/i },
  {
    reason: "recursive delete",
    pattern: /(^|[\s;&|(`$"'])rm\s+(-[a-z]*r[a-z]*|--recursive)(\s|$|["';&|)])/i,
  },
  { reason: "disk", pattern: /(^|[\s;&|(`$"'])(mkfs|dd|diskutil|shutdown|reboot)(\s|$|["';&|)])/i },
];

/** The reason a command is never offered for approval, or null when it may be shown. */
export function deniedCommandReason(command: string): string | null {
  return deniedPatterns.find(({ pattern }) => pattern.test(command))?.reason ?? null;
}
