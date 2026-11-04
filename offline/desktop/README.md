# 猫猫棋局 · 桌面安装包（开发预览）

复用 `offline/dist` 离线版游戏资源，不使用 `file://` 打开模块，而由 Electron 主进程为本地文件提供受限的 `gomoku://app` 安全源，确保 Web Worker、WASM 与 ONNX 加载路径正常。无在线账号/PVP/网络服务。

## 本地构建

在 `offline/desktop` 执行：

```bash
npm install
cd ..
GOMOKU_ICON_RENDERER=resvg node build.mjs
cd desktop
npm run start
npm run pack:mac:arm64  # Apple Silicon .dmg
npm run pack:mac:intel  # Intel x86_64 .dmg
npm run pack:win   # Windows .exe / NSIS
npm run pack:linux # Linux .AppImage
```

必须在目标 OS 上构建对应安装包。输出路径 `offline/desktop/dist-installers/`。

离线运行仅使用打包资源；应用未签名/公证，因此 macOS Gatekeeper、Windows SmartScreen 可能拦截测试包。正式公开发布前必须补充代码签名与平台测试。请勿将此预览当作正式 Release。

## DMG 质量门槛

macOS 打包现在运行 `scripts/after-sign.cjs`，对 ad-hoc 测试包完整封装资源签名。CI 使用 `scripts/verify-dmg.sh` 挂载 DMG、核查 `CodeResources`、`codesign --verify --deep --strict` 和 `lipo` 架构，不符合预期将直接失败。

**结构合法的 ad-hoc 签名不等于 Apple Developer ID 公证**。如需无需额外操作即可在其他用户的 Mac 上打开，请按 `../.github/workflows/offline-macos-notarized.yml` 配置 Developer ID 证书和 Apple Notarization Secrets，并严格执行 `spctl --assess` + `stapler validate`。
