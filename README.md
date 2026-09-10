# infini-license

InfiniSynapse 授权服务。为私有化部署的 `infini-proxy`（管理后台）与 `infiniSynapse`（应用端）提供授权签发、到期管控与试用期用量追踪。

设计文档在 [`docs/`](./docs/README.md)，实现前请先读 `docs/README.md` 里的关键决策表。

## 两种授权模式

| | 正式授权 | 试用授权 |
| --- | --- | --- |
| 凭证来源 | 我方签发 `license.key`，客户运维放进部署目录 | 无 `license.key` 时自动进入，向 license 服务匿名注册 |
| 有效期 | 合同期，签发时确定 | 30 天（可配置） |
| 联网 | **完全离线**，无心跳、无上报 | 心跳 + 任务数/用户数/Token 上报 |
| 到期行为 | 登录硬阻断，需替换 `license.key` | 登录硬阻断，需联系我方转正 |

正式授权完全离线是这套设计的核心约束，它决定了很多看起来奇怪的取舍：没有远程吊销、没有「已激活」状态、单次签发有效期有上限、签名密钥轮换要看客户端版本。

## 目录结构

```
infini-license/
├── docs/                    设计文档
├── mysql_init/              建表与初始数据 SQL，容器首次启动自动执行
├── packages/
│   ├── server/              NestJS 后端
│   ├── sdk/                 客户端 SDK（纯函数判定核心）
│   └── web/                 管理后台前端（P6）
└── docker-compose.yml
```

## 本地起步

```powershell
pnpm install

# 1. 生成主密钥与 JWT 密钥
node -e "console.log('LICENSE_MASTER_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('base64'))"

# 2. 准备环境变量
Copy-Item packages/server/.env.example packages/server/.env.development
#    填入上面两个值，并设置 BOOTSTRAP_ADMIN_PASSWORD

# 3. 起数据库。两种方式选一种：
docker compose up -d mysql redis          # a) 独立实例，容器会自动执行 mysql_init
pnpm run -C packages/server db:init       # b) 复用已有 MySQL（与 infini-proxy 同一套），手动建表

# 4. 起服务
pnpm dev:server
```

服务默认监听 `3010`，Swagger 在 `http://localhost:3010/api/docs`（仅 development）。

首次启动会自动创建 owner 账号和第一把签名密钥，日志里有提示。**登录后请立刻改密并清空 `BOOTSTRAP_ADMIN_PASSWORD`。**

数据库变量名（`MYSQL_USER` 等）与 `infini-proxy`、`infiniSynapse` 保持一致，三个项目可以共用一套本地 MySQL。库名用下划线的 `infini_license` 而非连字符——MySQL 里带连字符的库名每次引用都得加反引号，不少运维工具还会解析失败。

### 联调脚本

```powershell
pnpm run -C packages/server db:init      # 应用 mysql_init 下的建表 SQL
pnpm run -C packages/server smoke        # 签发链路冒烟（需服务已启动）
pnpm run -C packages/server smoke:trial  # 试用上报通道冒烟
pnpm run -C packages/server db:inspect   # 打印授权、密钥与审计现状
node scripts/sync-sdk.js                 # 把 SDK 源码同步到已接入的宿主项目
node scripts/sync-sdk.js --check         # 只报告差异，不写入（给 CI 用）
```

宿主侧的接入冒烟在宿主仓库里跑（需要本 服务已启动，它会走真实签发接口取凭证）：

```powershell
pnpm --filter backend license:schema     # 给存量库补上 018 的四张表
pnpm --filter backend license:smoke      # infini-proxy 接入冒烟，6 个场景 29 项断言
```

`smoke` 打通「登录 → 建客户 → 签发 → 下载 license.key → SDK 验签 → 续期」，还会验证篡改凭证被拒、并发签发编号不重复、关键操作留下审计。

`smoke:trial` 打通「注册 → HMAC 心跳 → 用量上报」，客户端一侧全部走 SDK 的真实实现，因此同时验证了 SDK 与服务端两份签名实现是否逐字节一致。还覆盖重复注册不重置试用期、清库重装被识别、重放与篡改被拒、上报幂等、隐私字段白名单。两个脚本都可重复运行。

`license:smoke`（在 infini-proxy 里）打通六个场景：无凭证转 30 天试用、过期凭证阻断全员含超管、`LICENSE_ENFORCE=false` 只观察不阻断、换文件热加载解除阻断、正式模式零上报、`LICENSE_ENABLED=false` 完全旁路。它自建独立库并从 `mysql_init` 全量重建，不碰开发库。

**改动签发、上报或接入链路后务必跑对应脚本。** 单测用的是 mock 仓储，跑不到真实 SQL、事务、并发与中间件执行顺序。已经靠这几个脚本抓到七个缺陷：序列号分配死锁、隐私字段白名单被全局管道静默失效、列 `DEFAULT` 被 transformer 冲掉、请求体过大误报成 500、**指纹含容器 hostname 导致重建容器即锁死客户**、**`/license/reload` 要求登录而阻断态下无人能登录**、**公开的 `/license/status` 把客户用量一起吐了出去**。后三个是设计缺陷，看文档看不出来。

## 几条不要踩的线

**`LICENSE_MASTER_KEY` 一旦签发过凭证就不能再改。** 它加密着库里所有签名私钥，换掉等于把私钥全部丢弃。已发出去的凭证仍然有效（客户端只验公钥），但你再也无法用原来的 kid 续签，只能生成新密钥并等客户端版本铺开。这个值要单独备份，且不要和数据库备份放在一起。

**`license.key` 信封头部不参与签名。** `Customer:`、`Valid-Until:` 那几行纯粹给人看，改一行文本就能伪造。任何代码路径都不许读它们，展示信息一律来自验签后的 payload。

**签名密钥轮换要看客户端版本。** 客户端内置的公钥列表随产品版本发布，离线客户装的是老版本。用新 kid 给老客户端签凭证，结果是验签直接失败、客户被锁在门外。`lc_signing_key.client_since` 就是为这件事存在的。

**「作废授权」只是后台账面状态。** 正式授权没有下发通道，作废不会影响客户环境。它的用途是把误签、重复签的记录从有效列表里清出去。

**SDK 的运行时依赖必须保持为空。** 它以源码形式内嵌进两个下游工程（见 `docs/05-client-integration.md` §1.3），加一个第三方依赖就变成三处工程的负担。只用 Node 内置 `crypto`。

**SDK 只能单向同步，宿主里的副本改了会被覆盖。** 改动流程是：在 `packages/sdk` 改 → 跑 `pnpm test` → `node scripts/sync-sdk.js` → 在宿主项目跑一遍单测。单测是跟着一起同步的，所以宿主项目那一遍能验证这次复制是完好的。

**指纹不许再掺入主机或数据库信号。** 它只由 `installId` 决定。看起来更严格的绑定（hostname、CPU 核数、数据库实例）在私有化环境里全都是会变的东西，一变就把客户全员锁在门外，而我们在客户内网里没有远程解锁手段。详见 `docs/README.md` 的「指纹为什么只绑 install_id」。

## 测试

```powershell
pnpm test
```

服务端 34 个、SDK 96 个。签名往返、密文篡改、信封解析、状态求值、时钟回拨这几组是回归底线，改动加密或凭证结构后必须全绿。

SDK 的覆盖率门槛写在 `packages/sdk/jest.config.js` 里（statements/functions/lines 90%，branches 85%）。这不是形式主义：`evaluateLicense` 决定客户能不能登录，覆盖率不达标就是在赌客户不会被误锁。
