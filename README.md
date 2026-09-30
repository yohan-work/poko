# Poko

**A friendly local AI desktop agent for getting real work done in your projects.**

Poko is an early-stage open-source project. The first milestone is a character-led desktop app; local coding-agent execution is planned for a later phase. Features described as planned are not available yet.

## Project status

- [x] Foundation and architecture documented
- [ ] Character and chat desktop app (Phase 01)
- [ ] Codex CLI worker (Phase 02)
- [ ] Local task and memory persistence (Phase 03)
- [ ] Approval workflow (Phase 04)

## What Poko is aiming for

Talk to a small desktop character in plain language. When a request needs real work, Poko will route it to a local agent, show understandable progress, and report the result. The long-term design keeps the user experience in Poko while providers and tools work behind a clear permission boundary.

## Development

The runnable application is being built in Phase 01. Development setup instructions will be added with that implementation. Read [the architecture](docs/architecture.md) and [the phase plan](docs/phases/phase-01.md) for the current design and scope.

## Security direction

Poko is designed to keep tool execution out of the UI renderer and to require explicit approval for dangerous actions. Codex execution and approval enforcement are not implemented yet. Do not use this early-stage project to run unattended actions.

## Contributing

Contributions and feedback are welcome. Please open an issue to discuss larger changes before starting implementation. Each milestone is developed through a pull request with review and verification.

## License

Poko is licensed under the MIT License. See [LICENSE](LICENSE).
