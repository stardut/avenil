# Agent Instructions

## Git Metadata Language

All human-readable Git, GitHub, and GitLab metadata must be written in English. This includes commit messages, branch names, annotated tag names and messages, Release names and notes, PR/MR titles and descriptions, comments, checklists, issue relationship text, labels, and status labels. This rule applies to every local Git operation and remote review or release action; application copy and other user-facing product text follow the language requirements of the task.

## Pull Request Delivery

Use the `my-git-mr` workflow whenever the user asks to open, submit, deliver, publish, release, or update a GitHub pull request or GitLab merge request.

### Route and target

1. Inspect the worktree with `git status --porcelain`.
2. If there are uncommitted changes, run `my-git-commit` in the same workflow. Confirm that its Change Brief is present and its Self-Check is complete before pushing.
3. Check the source branch. Use a feature branch for delivery; do not push directly from `master`, `main`, `dev`, or `release/backend`.
4. Select the remote in this order: `up` if configured, otherwise `origin`. Stop if neither exists.
5. Identify GitHub or GitLab from the selected remote URL only. Use `gh` for GitHub and `glab` for GitLab, and verify authentication and repository access. If automatic repository detection fails, pass the repository explicitly.
6. Fetch and inspect refs through the selected remote only.
7. Resolve the target branch as follows:
   - A production request (`publish`, `release`, `go live`, or an equivalent request) targets `main` when the selected remote has `main`; otherwise it targets `master`.
   - An explicit request for `dev` targets `dev`.
   - A normal test or review request targets this repository's default test branch, `dev`.
8. List every open PR/MR from the source branch before creating anything. Update an existing review that targets the requested branch. If another open review from the same source branch targets a different branch, stop and ask the user to resolve it first. Create a new review only when no open review exists.

### Quality gate

- Calculate the review diff against the selected remote target branch; the review page diff is the source of truth.
- Run the repository's applicable lint, build, compile, and validation commands described in `CONTRIBUTING.md`. Also run `git diff --check` when code changes are present.
- Inspect the diff for unhandled critical paths, accidental debug code, `TODO`/`FIXME` markers, unjustified magic values, and unnecessarily deep nesting.
- Stop and report critical correctness or safety problems before pushing. Record minor issues in the final report.

### PR/MR metadata format

Use the following PR/MR-specific title, description, checklist, and issue-link conventions in addition to the repository-wide Git metadata language rule.

- With a task from the PMS, use `[{Task ID}] {title}`; add `[Production]` for a production review.
- With a local task, use `{type}: {title}`; add `[Production]` for a production review.
- Without a task, use `{type}({scope}): {description}`; add `[Production]` for a production review.
- Keep the description limited to the current review diff. Use these headings on separate lines: `## Summary`, `## Changes`, `## Test Plan`, and `## Related`.
- Submit the description as real LF-separated Markdown. After creating or updating the review, read the actual remote description and verify that it contains no literal `\n`, all required headings, and only changes supported by the current diff.
- For test targets, use `Related to` for applicable issues and never use `Closes`, `Fixes`, or `Resolves`.
- For production targets, use `Related to` for the PRD issue and use `Closes` only for explicitly listed `closeIssues`. Never close the PRD issue. If work issues exist but `closeIssues` is empty, stop and ask which work issues should be closed. Never invent issue numbers.

### Push and task metadata

- Push only after the worktree, branch, remote, target, quality gate, Change Brief, and Self-Check requirements pass.
- After a successful create or update, update task frontmatter only when there is a safe, unique matching task file. Change frontmatter fields only; do not edit the task body, progress history, business sections, or checkboxes. If no safe unique task exists, report that the update was skipped and why.
- Verify the final review URL, source-to-target branches, actual diff, English title and description, and issue-closing semantics before reporting success.
- This workflow creates or updates a PR/MR; it does not merge the review or archive the task.

## Automated Tests

- 新增或修改业务逻辑时必须同时补充或更新单元测试；修复缺陷时先写能够复现问题的回归测试，再修改实现。
- Rust 核心逻辑使用模块内 `#[cfg(test)]` 单元测试，验证配置、进程状态、日志、CLI、控制协议和导入解析等公开行为；不要只用验收脚本代替单元测试。
- React/TypeScript 逻辑和交互使用 Vitest、jsdom 和 Testing Library；测试用户可观察的结果，不测试私有实现细节或内部调用次数。
- 本地提交前至少运行 `npm test`、`npm run build` 和 `cargo test --locked --manifest-path src-tauri/Cargo.toml`。涉及核心服务生命周期、日志或持久化时，再运行 `npm run test:acceptance`。
- 不能自动化的 native 窗口、托盘、真实 Tauri IPC 等场景必须保留手工验收记录，并在变更说明中写清未覆盖原因；不得把构建通过当作测试通过。
- 测试应覆盖成功路径、输入校验、错误路径和边界条件。若确有合理原因无法补测试，必须在变更说明中明确说明风险和替代验证方式。
