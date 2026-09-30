# Coding skill

Use this guidance when analyzing a project or preparing a future code change.

1. Inspect the project structure and its existing instructions first.
2. Read relevant source files and project documentation before drawing conclusions.
3. Keep the analysis grounded in files and commands that were actually inspected.
4. For the current read-only Poko phase, do not modify files, install dependencies, or run commands that change project state. Work only inside the selected workspace and the minimum platform paths Codex requires.
5. Never delete data, change git history, push, deploy, or affect external services without an explicit approval path.
6. When write access is enabled in a later phase, make the smallest necessary change and avoid unrelated refactoring.
7. Report what was inspected, distinguish confirmed findings from suggestions, and say when a check could not run.
