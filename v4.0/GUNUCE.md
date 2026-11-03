# Gunuce · V4.0.1

Gunuce在用户浏览器的专用Web Worker中运行冻结的策略价值网络、战术保护和128次PUCT搜索。没有推理API、GPU服务器地址、密钥或服务器降级路径。首次联网加载后，同源资源由Service Worker缓存；断网刷新后仍可继续游客AI对弈。账号、云端结算和真人PVP沿用原系统，仍需要联网。

界面保留原V4.0设计与三档本地AI，只增加名为`Gunuce`的选项，标题/页脚/导出版本为4.0.1。Gunuce暂不接入原积分验证：现有Worker的AI候选范围检查是为启发式引擎设计，不能直接用来认定神经网络棋谱合法。这个内部结算边界不作为难度后缀显示；原三档结算不变，数据库及云端Worker不需要迁移。

## 使用与离线准备

1. 从HTTPS站点或localhost静态预览打开`v4.0/`，选择Gunuce，点击开始。
2. 首次需下载模型与当前设备所需的本地运行库。准备和搜索进度显示在状态栏，页面仍可操作。
3. 出现“已就绪，可离线对弈”后，模型及所需运行库已缓存；断网刷新仍可下棋。浏览器清除站点存储后需重新联网准备。
4. 无法以双击`file://`代替HTTPS/localhost部署，因为模块Worker和Service Worker需要正常Web origin。

WebGPU可用时优先使用；不可用、仅有软件GPU或初始化失败时使用WASM。WASM单线程运行，不依赖GitHub Pages无法自定义的COOP/COEP响应头。旧浏览器缺少所需WebAssembly能力时会明确报错，可继续使用原有三个难度。

模型和运行库均同源提供，不从CDN加载。约4.3MiB ONNX模型公开随网页分发；只包含推理参数，没有训练集、优化器状态或原始checkpoint。运行库采用MIT许可，许可证与第三方声明在`vendor/ort/`。CPU路径首次资源约19MiB，WebGPU路径约32MiB（未计传输压缩，具体以实际HTTP为准）；不会向只玩原三档的访客预下载整套推理资源。仓库包含两种后端约47MiB资源，但访客只下载所需路径。

## 开发与发布

在仓库根目录运行静态服务器即可，不需要Python推理依赖：

```bash
python3 -m http.server 8043 --bind 127.0.0.1
# 浏览器打开 http://127.0.0.1:8043/v4.0/
```

在v4.0目录检查：

```bash
npm ci --omit=dev
npm run check
npm test
```

修改客户端资产后更新离线文件清单；该开发步骤使用锁定的onnxruntime-web构建资源：

```bash
npm ci
python3 tools/prepare_browser_assets.py
npm run check
```

首次构建或更新模型，另行在开发环境安装PyTorch、ONNX与ONNX Runtime，使用同构ResNet checkpoint：

```bash
python3 tools/export_model.py --checkpoint /path/to/frozen-checkpoint.pt
python3 tools/prepare_browser_assets.py
```

导出工具验证12个数值输入的PyTorch/ONNX CPU输出并生成模型SHA与数值测试向量；随机数值输入仅用于精度检查，不是合法棋局/训练集。默认模型为64通道、12残差块，float32、固定batch1。来源checkpoint SHA见`models/model.json`。

### 浏览器检查

```bash
cd browser-tests
npm ci
npx playwright install chromium
GUNUCE_BASE_URL=http://127.0.0.1:8043 npm test
```

`npm test`验证WASM数值、完整128搜索、断网刷新落子、双方执色、缓存损坏后的重试、取消旧任务及手机尺寸布局，确认没有推理API请求。结果写入`../.test-artifacts/`。`npm run test:webgpu`验证WebGPU数值（无适配器则检查WASM后备）；可用`GUNUCE_FULL_WEBGPU_SEARCH=1`追加完整搜索，但CI的软件适配器可能非常慢，不作为真实显卡性能指标。

默认游戏自动选择后端。调试时可在URL中加`?gunuceBackend=wasm`强制CPU；`?gunuceBackend=webgpu`可强制尝试包括软件适配器在内的WebGPU。不要把软件适配器测试当作普通用户GPU速度。

## 验证与边界

- PyTorch→ONNX CPU：12输入，策略最大绝对误差约2.9e-5，价值约4.2e-7。
- Chromium WASM：12输入，策略最大误差约2.5e-5，价值约3.9e-7；断网刷新与本地对弈通过。
- Chromium WebGPU：使用SwiftShader验证数值及完整128模拟，策略误差约1.9e-5、价值约1.2e-7。真实硬件WebGPU速度尚需浏览器/手机实测。
- JS搜索与独立Python参考在5个测试局面的访问次数一致；保护、价值回传符号、合法落子和取消有自动化测试。
- 无GPU的本机无头浏览器，128模拟约4–5秒，首次加载与初始化约6秒；这是特定机器/测试环境的观察，不是全球设备时延承诺。UI与搜索分离，状态会持续更新。
- 不量化、训练或在线更新模型。跨PyTorch/WASM/WebGPU浮点细节可能改变近似并列搜索路径，不保证棋谱完全一致。此前服务器批量评测的81.5%不能作为浏览器版本胜率宣传。
- 还需真实移动设备、Safari/Firefox和长局续航验收；全局最优/超人水平没有证明。

发布方式沿用原平台：合并本PR后由原作者的静态Pages流程发布v4.0，不更换账号/PVP服务。回滚时应整套回滚前端、模型manifest与离线清单；Service Worker更新默认等待旧页面关闭，避免在进行中的棋局替换资源。
