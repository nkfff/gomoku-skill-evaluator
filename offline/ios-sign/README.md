# iPhone 真机版签名与安装

本目录的 CI 可以构建原生 **iOS Device (arm64)** 工程，且预留了 Apple Developer **Ad Hoc** 签名导出真实 `.ipa` 的路径。这个 IPA 只允许安装到 Ad Hoc 描述文件中已注册 UDID 的 iPhone。要开放给不特定的 iPhone 用户，请通过 TestFlight 或 App Store 发布，不能用公开 GitHub IPA 绕过设备授权。

## 维护者需要配置的 GitHub Actions Secrets

请到仓库 `Settings → Secrets and variables → Actions` 设置：

- `APPLE_TEAM_ID`：Apple Developer Team ID。
- `IOS_DISTRIBUTION_P12_BASE64`：Apple Distribution 证书与私钥的 .p12 文件，Base64 内容。
- `IOS_DISTRIBUTION_P12_PASSWORD`：该 .p12 的加密密码。
- `IOS_ADHOC_MOBILEPROVISION_BASE64`：对应 `io.github.nkfff.gomoku.offline`、且已包含目标 iPhone UDID 的 Ad Hoc 描述文件，Base64 内容。

**不要将证书、私钥、密码或描述文件直接发送到聊天、Issue 或 PR。** 用户自行配置密钥后，进入 `Actions → Offline iPhone device & Ad Hoc IPA → Run workflow`，填写版本编号并运行。CI 先编译 iPhone arm64 原生工程，再检查证书/Profile 的 Team ID、Bundle ID 和设备名单，临时导入钥匙串，签名并验证 IPA。

成功后在该 Actions 运行下获取 `gomoku-offline-signed-iphone-adhoc` 附件；使用 Xcode、Apple Configurator 等支持的方式将其安装到已登记 iPhone。签名 IPA 不会自动上传到公开 GitHub Release（其中嵌有面向特定设备的描述文件），避免将受限版本误当成人人可安装的软件。

如果尚未配置四项 Secrets，Workflow 仍可验证未签名的 iPhone arm64 设备构建，**但不能生成可安装的签名 IPA**。正常公开发行建议后续通过 TestFlight。
