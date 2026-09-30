# Poko

**A friendly local AI desktop agent for getting real work done in your projects.**

Poko is an early-stage open-source project. The first milestone is a character-led desktop app; local coding-agent execution is planned for a later phase. Features described as planned are not available yet.

## Project status

- [x] Foundation and architecture documented
- [x] Character and chat desktop app (Phase 01)
- [x] Read-only Codex project analysis (Phase 02)
- [ ] Local task and memory persistence (Phase 03)
- [ ] Approval workflow (Phase 04)

## What Poko is aiming for

Talk to a small desktop character in plain language. When a request needs real work, Poko will route it to a local agent, show understandable progress, and report the result. The long-term design keeps the user experience in Poko while providers and tools work behind a clear permission boundary.

## Development

Requirements: Node.js 24+ and pnpm 10+.

```sh
pnpm install
pnpm dev
```

Useful checks:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Poko can analyze a selected workspace through the locally installed Codex CLI with a restricted read-only permission profile. File edits, persistent task history, and approval-gated write access are still planned work. Read [the architecture](docs/architecture.md) and [the Phase 02 plan](docs/phases/phase-02.md) for the current design and limits.

## Security direction

Poko keeps tool execution out of the UI renderer. The current Codex worker is limited to read-only analysis; it does not support file edits or unattended external actions. Approval-gated write access is planned for Phase 04.

## Contributing

Contributions and feedback are welcome. Please open an issue to discuss larger changes before starting implementation. Each milestone is developed through a pull request with review and verification.

## License

Poko is licensed under the MIT License. See [LICENSE](LICENSE).
