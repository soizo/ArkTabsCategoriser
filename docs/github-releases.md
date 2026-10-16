# GitHub 自动发布

每次推送到仓库默认分支后，`Build and release` 工作流会安装依赖、运行测试并构建 Chrome 和 Firefox ZIP，随后创建 GitHub Release，附上两个浏览器的包及 `SHA256SUMS`。测试或构建失败时不发布。

也可在 GitHub Actions 中选择 `Build and release` → `Run workflow`，选择默认分支运行。其他分支不发布。

每次运行使用 `build-<run_id>-<run_attempt>` 标签，指向本次构建的完整提交；标题包含扩展版本与构建编号。未修改扩展版本号也会创建独立 Release，重新运行也不会覆盖旧包。扩展清单版本保持原值；浏览器商店更新仍需递增版本。

流程使用 GitHub 自带的 `GITHUB_TOKEN`，需允许工作流使用 `contents: write`；不需要额外密钥。仓库或组织策略禁止写入时，发布步骤会失败。

Firefox ZIP 未签名，正式版 Firefox 的永久安装仍需 Mozilla 签名。此流程只发布 GitHub Release，不向浏览器商店提交。
