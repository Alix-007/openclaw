# OpenClaw 架构图

## 系统总览

```mermaid
flowchart TB
    subgraph Clients["客户端层"]
        direction LR
        CLI["CLI\nopenclaw 命令行\nsrc/cli/"]
        macOSApp["macOS App\n菜单栏应用\napps/macos/"]
        iOSApp["iOS App\napps/ios/"]
        AndroidApp["Android App\napps/android/"]
        ControlUI["Control UI\n管理面板"]
        WebChat["WebChat\n网页聊天\nui/"]
    end

    subgraph GW["网关层 · Gateway（src/gateway/）"]
        direction TB
        WS["WebSocket 服务器\n:18789\nserver.impl.ts"]
        AuthPair["认证 & 设备配对\nauth.ts"]
        MsgRouter["消息路由器\nsrc/routing/"]
        SessionMgr["会话管理\nsession-utils.ts"]
        PluginSys["插件系统\nsrc/plugins/"]
        HookEngine["Hook 引擎\nsrc/hooks/"]
        CronSched["定时任务\nserver-cron.ts"]
        HTTPSrv["HTTP 服务器\nControl UI / Canvas\nserver-http.ts"]
    end

    subgraph Channels["消息频道层（20+ 集成）"]
        direction LR
        subgraph BuiltIn["内置频道 src/"]
            WA["WhatsApp\n(Baileys)"]
            TG["Telegram\n(grammY)"]
            DC["Discord\n(discord.js)"]
            SL["Slack\n(Bolt)"]
            SG["Signal"]
            IM["iMessage\n(BlueBubbles)"]
        end
        subgraph ExtCh["扩展频道 extensions/"]
            MT["Matrix"]
            MST["MS Teams"]
            FL["Feishu / LINE"]
            ZL["Zalo / Nostr"]
            IRC["IRC / Mattermost\n/ Twitch / ..."]
        end
    end

    subgraph AgentRT["Agent 运行时（src/agents/）"]
        direction TB
        PiAgent["Pi Agent\nRPC 模式"]
        ToolEngine["工具引擎\n(src/tools/)"]
        Canvas["Canvas\nA2UI 可视化渲染"]
        BrowserAuto["浏览器自动化\nsrc/browser/"]
        MemMod["记忆模块\nextensions/memory-*"]
    end

    subgraph LLMLayer["LLM 提供商（src/providers/）"]
        direction LR
        Anthropic["Anthropic\nClaude"]
        OpenAI["OpenAI"]
        Gemini["Google Gemini"]
        OtherLLM["Qwen · Minimax\nAWS Bedrock\nGitHub Copilot"]
    end

    subgraph InfraLayer["基础设施（src/infra/）"]
        direction LR
        ConfigSys["YAML 配置\n~/.openclaw/config.yaml\nsrc/config/"]
        SQLiteDB["SQLite\n会话 & 消息历史"]
        FileSys["文件系统\n媒体缓存 / 日志"]
        Bonjour["Bonjour / mDNS\n本地网络发现"]
        UpdateChk["版本自动检查"]
    end

    %% 客户端 → 网关
    CLI        -->|WebSocket| WS
    macOSApp   -->|WebSocket| WS
    iOSApp     -->|WebSocket| WS
    AndroidApp -->|WebSocket| WS
    ControlUI  -->|HTTP / WS| HTTPSrv
    WebChat    -->|HTTP / WS| HTTPSrv

    %% 网关内部流转
    WS --> AuthPair --> MsgRouter
    MsgRouter --> SessionMgr
    PluginSys  --> HookEngine
    CronSched  --> HookEngine
    HTTPSrv    --> PluginSys

    %% 频道 ↔ 路由（双向：收消息 + 发回复）
    BuiltIn <-->|"归一化 Message\n(收 / 发)"| MsgRouter
    ExtCh   <-->|"归一化 Message\n(收 / 发)"| MsgRouter

    %% 路由 → Agent
    MsgRouter -->|"派发\n(resolve-route.ts)"| PiAgent
    SessionMgr -->|"会话上下文"| PiAgent
    HookEngine -->|"消息 / LLM Hooks"| PiAgent

    %% Agent 工具
    PiAgent --> ToolEngine
    ToolEngine --> Canvas
    ToolEngine --> BrowserAuto
    ToolEngine --> MemMod

    %% Agent → LLM
    PiAgent -->|"API 调用"| Anthropic
    PiAgent -->|"API 调用"| OpenAI
    PiAgent -->|"API 调用"| Gemini
    PiAgent -->|"API 调用"| OtherLLM

    %% 基础设施
    SessionMgr --> SQLiteDB
    MsgRouter  --> ConfigSys
    GW         --> FileSys
    GW         --> Bonjour
    GW         --> UpdateChk
```

## 消息处理流程

```mermaid
sequenceDiagram
    participant U  as 用户
    participant CH as 消息频道<br/>(WhatsApp / Telegram / ...)
    participant CA as 频道适配器<br/>(ChannelAdapter)
    participant RT as 消息路由器<br/>(routing/)
    participant SS as 会话管理器<br/>(SessionMgr)
    participant AG as Pi Agent<br/>(RPC)
    participant LM as LLM 提供商<br/>(Claude / GPT / ...)
    participant TL as 工具引擎<br/>(Tools)

    U  ->> CH : 发送消息
    CH ->> CA : 原始消息事件
    CA ->> RT : 归一化 Message 对象
    RT ->> SS : 查找 / 创建会话
    SS ->> AG : 派发消息 + 历史上下文
    AG ->> LM : 调用 LLM API（流式）
    LM -->> AG : 流式返回 token
    AG ->> TL : 调用工具（浏览器 / Canvas / 记忆 ...）
    TL -->> AG : 工具结果
    AG ->> SS : 保存对话历史
    AG -->> RT : 最终回复文本
    RT ->> CA : 格式化 + 分块
    CA ->> CH : 发送回复
    CH ->> U  : 用户收到回复
```

## 频道适配器接口

每个频道插件通过实现以下适配器接口与核心解耦：

| 适配器 | 职责 |
|--------|------|
| `ChannelMessagingAdapter` | 发 / 收消息，输入提示 |
| `ChannelAuthAdapter` | 登录（QR / Email）、退出、Token 刷新 |
| `ChannelOutboundAdapter` | 格式化并发送回复 |
| `ChannelGroupAdapter` | 群组消息处理 |
| `ChannelThreadingAdapter` | 线程 / 回复处理 |
| `ChannelSecurityAdapter` | DM 策略、白名单执行 |
| `ChannelStatusAdapter` | 健康检查、连接状态 |
| `ChannelPairingAdapter` | 设备 / 账号配对 UI |
| `ChannelCommandAdapter` | 频道特定命令 |

## 插件 & Hook 系统

```
插件发现
└── node_modules/@openclaw/*   (npm 插件)
└── extensions/*               (工作区插件)
└── ~/.openclaw/plugins/       (用户自定义插件)

Hook 阶段
├── gateway.*    网关启动 / 关闭
├── message.*    消息预处理
├── llm.*        LLM 调用（模型覆盖 / 提示变换）
├── session.*    会话生命周期
├── tool.*       工具调用
└── subagent.*   子 Agent 生成
```

## 目录结构速查

```
openclaw/
├── src/
│   ├── cli/          CLI 入口 & 解析器
│   ├── commands/     命令实现 (gateway, agent, send, onboard ...)
│   ├── gateway/      WebSocket 控制平面（核心）
│   ├── channels/     频道抽象层 & 适配器接口
│   ├── routing/      消息路由逻辑
│   ├── agents/       Agent 运行时 & 工作区
│   ├── plugins/      插件发现 & 注册
│   ├── hooks/        内置 Hook（Gmail、消息拦截 ...）
│   ├── providers/    LLM 提供商认证
│   ├── config/       配置加载 & 校验（Zod）
│   ├── infra/        基础设施工具
│   ├── media/        媒体处理（图片 / 音视频）
│   ├── sessions/     会话持久化
│   └── web/          WebChat 后端
├── extensions/       频道 & 功能插件（42 个）
├── apps/
│   ├── ios/          Swift / SwiftUI
│   ├── android/      Kotlin / Gradle
│   └── macos/        Swift / SwiftUI 菜单栏
├── ui/               Control UI & WebChat 前端
└── docs/             文档（Mintlify）
```
