# onchain-redpacket

**链上红包 Agent** — 通过 OKX Agentic Wallet，在 XLayer 和 Solana 链上发送加密红包，生成可分享链接，接收者无需安装钱包插件即可一键领取。

> For English: see below the Chinese section.

---

## 这是什么

一个 Claude Code 插件，让你通过对话或网页界面创建链上红包（Hongbao）。创建者将代币转入 Agent 钱包后，系统自动分配并向每位领取者发送链上转账。

**核心特性：**
- 支持 XLayer（零 Gas）和 Solana 两条链
- 等额 / 随机两种分配模式
- 领取页面无需安装钱包插件，输入地址即可领
- 基于 OKX Agentic Wallet CLI，无需管理私钥
- 领取记录实时展示（谁抢了多少）

---

## 安装

### 前置依赖

```
/plugin marketplace add mastersamasama/master-plugin-repository
/plugin install onchain-redpacket@master-plugin-repository
/reload-plugins
```

### 配置 OKX Agentic Wallet（一次性）

```bash
npx skills add okx/onchainos-skills
onchainos wallet login   # 邮箱验证码登录
onchainos wallet status  # 确认登录成功
```

### 启动后端服务

```bash
git clone <your-repo-url>
cd onchain-redpacket
npm install --prefix server
cd server && npm run dev
```

服务启动于 `http://localhost:3000`。

---

## 使用方式

### 方式一：Claude 对话

```
/redpacket:redpacket
```

然后直接告诉 Claude：

```
帮我发一个红包，0.1 USDC，5个，随机分配，XLayer链
```

Claude 会创建红包并返回：
- 代理钱包地址（转账到这里激活红包）
- 领取链接（分享给好友）

### 方式二：网页 UI

打开 `http://localhost:3000/create`，填写表单后点击「发红包」。

---

## 支持的链和代币

| 链 | Chain ID | 支持代币 |
|----|----------|----------|
| XLayer | 196 | USDC, USDT, OKB |
| XLayer Testnet | 195 | USDC, OKB |
| Solana | 501 | USDC, USDT, SOL |
| Solana Devnet | 503 | USDC, SOL |

---

## 完整流程

```
1. 创建红包  →  POST /api/packets
              ↓
           返回代理钱包地址 + 领取链接

2. 打款激活  →  向代理钱包转入对应金额
              ↓
           余额到账后自动激活（status: active）

3. 分享领取  →  接收者打开 /claim/:id
              ↓
           输入钱包地址 → 链上转账 → 显示金额和 TxHash
```

---

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/packets` | 创建红包 |
| GET  | `/api/packets/:id` | 查看红包状态 + 领取记录 |
| POST | `/api/packets/:id/activate` | 手动检查是否到账 |
| POST | `/api/packets/:id/claim` | 领取红包 |
| GET  | `/api/wallet` | 查看 Agent 钱包余额 |

---

## 项目结构

```
onchain-redpacket/
├── .claude-plugin/
│   └── plugin.json          # Claude Code 插件元数据
├── skills/
│   └── redpacket.md         # 对话技能定义
├── server/
│   ├── src/
│   │   ├── index.ts         # 入口
│   │   ├── server.ts        # Express 路由
│   │   ├── redpacket.ts     # 业务逻辑
│   │   ├── onchainos.ts     # OKX Agentic Wallet CLI 封装
│   │   ├── store.ts         # SQLite 持久化
│   │   └── types.ts         # TypeScript 类型
│   └── package.json
├── public/
│   ├── create.html          # 发红包网页
│   └── claim.html           # 领红包网页
└── README.md
```

---

## Onchain OS 集成

所有链上转账通过 **OKX Agentic Wallet** (`onchainos` CLI) 执行，私钥由 TEE 安全托管：

```bash
# 查询余额
onchainos wallet balance --chain 196

# 转账（自动处理 confirming 二次确认）
onchainos wallet send --chain 196 \
  --contract-token 0xa8ce8aee21bc2a48a5ef670afcc9274c7bbbc035 \
  --readable-amount 0.1 \
  --recipient 0xABCD...
```

---

## English Summary

**onchain-redpacket** is a Claude Code plugin for creating and distributing on-chain crypto red packets (Hongbao) on XLayer and Solana. Powered by OKX Agentic Wallet — no private key management required.

**Quick start:**
1. Login: `onchainos wallet login`
2. Start server: `cd server && npm run dev`
3. Chat: `/redpacket:redpacket` → "Send a red packet, 0.1 USDC, 5 envelopes, random split, XLayer"
4. Fund the agent wallet → share the claim link

Recipients visit `/claim/:id`, enter their wallet address, and receive tokens on-chain instantly.
