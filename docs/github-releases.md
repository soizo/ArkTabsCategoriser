# GitHub 手动发布

手动运行后，`Build and release` 工作流会安装依赖、运行测试并构建 Chrome 和 Firefox ZIP，随后创建 GitHub Release，附上两个浏览器的包及 `SHA256SUMS`。测试或构建失败时不发布。

普通提交和推送不会触发构建发布。在 GitHub Actions 中选择 `Build and release` → `Run workflow`，选择默认分支运行。其他分支不发布。

每次运行使用 `build-<run_id>-<run_attempt>` 标签，指向本次构建的完整提交；标题包含扩展版本与构建编号。未修改扩展版本号也会创建独立 Release，重新运行也不会覆盖旧包。扩展清单版本保持原值；浏览器商店更新仍需递增版本。

流程使用 GitHub 自带的 `GITHUB_TOKEN`，需允许工作流使用 `contents: write`；不需要额外密钥。仓库或组织策略禁止写入时，发布步骤会失败。

Firefox ZIP 未签名，正式版 Firefox 的永久安装仍需 Mozilla 签名。此流程只发布 GitHub Release，不向浏览器商店提交。

## 手动修改版本号

在 GitHub Actions 中选择 **Set extension version** → **Run workflow**，选择目标分支并输入版本号，例如 `0.1.2`。版本必须为三段整数，每段 0–65535，无前导零，且不能是 `0.0.0`。

工作流同步更新 `package.json` 和 `package-lock.json` 的根包版本，仅运行无需安装依赖的版本更新专项测试，通过后提交并推送到所选分支；不安装浏览器、不执行完整测试或构建。WXT 从 `package.json` 读取版本，两种浏览器使用相同版本。相同版本不产生新提交；依赖版本不变。

目标分支须允许机器人推送；分支在运行期间发生更新时不会强制覆盖。这个操作不自动发布，发布时另行在默认分支手动运行 **Build and release**。

本地可运行 `node scripts/set-version.cjs 0.1.2` 修改版本。
