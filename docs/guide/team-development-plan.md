# 车队拼车功能开发计划

## 项目概述

基于现有 ccusage 项目扩展车队拼车功能，支持多用户共享 Claude Max 账号的使用监控和协调。利用现有的 `blocks --live` 功能作为基础，添加多用户协作和智能调度功能。

## 功能需求

### 核心功能
- 🚗 **车队管理**：创建车队、生成邀请码、成员加入/退出
- 📊 **实时监控**：显示车队成员使用情况和5小时计费窗口状态
- 💡 **智能建议**：基于使用模式的时段协调建议
- 📱 **Web管理**：后台管理界面，支持 Vercel 部署

### 用户体验
- 完全中文友好的界面
- 隐私保护优先的设计
- 无缝集成现有 CLI 工作流程

## 技术架构

### 数据库设计 (Supabase)

```sql
-- 车队表
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL, -- 6位邀请码
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  settings JSONB DEFAULT '{}'::jsonb
);

-- 车队成员表
CREATE TABLE team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  user_id TEXT NOT NULL, -- 本地生成的用户标识
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}'::jsonb, -- 存储时区、偏好时段等
  UNIQUE(team_id, user_id)
);

-- 使用数据聚合表（基于现有SessionBlock结构）
CREATE TABLE usage_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL, -- 对应SessionBlock.id
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  is_active BOOLEAN DEFAULT false,
  token_counts JSONB NOT NULL, -- {inputTokens, outputTokens, etc}
  cost_usd DECIMAL(10,4) DEFAULT 0,
  models TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 实时状态表（车队当前活跃状态）
CREATE TABLE team_live_status (
  team_id UUID PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  active_session_id TEXT,
  active_members JSONB DEFAULT '[]'::jsonb, -- 当前活跃成员列表
  total_tokens INTEGER DEFAULT 0,
  total_cost DECIMAL(10,4) DEFAULT 0,
  burn_rate JSONB DEFAULT '{}'::jsonb, -- 燃烧率信息
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 技术栈

**CLI 扩展 (基于现有项目)**
- TypeScript + Bun 运行时
- Supabase 数据持久化
- 复用现有的终端 UI 组件

**Web 后台管理**
- Next.js 14 (App Router)
- Supabase (数据库 + 认证)
- shadcn/ui + Tailwind CSS
- Vercel 部署

**新增依赖**
```json
{
  "devDependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "nanoid": "^5.0.4"
  }
}
```

## 开发计划 (3-4天)

### 第1天：核心扩展 (6-8小时)

#### 上午 (3-4小时)：基础设施
1. **Supabase 项目设置** (30分钟)
   - 创建 Supabase 项目
   - 运行数据库迁移脚本
   - 配置 RLS 策略

2. **新增数据层** (2小时)
   ```typescript
   // src/team/supabase-client.ts - Supabase客户端
   // src/team/_team-types.ts - 车队相关类型定义
   // src/team/team-service.ts - 车队业务逻辑
   ```

3. **扩展现有命令系统** (1小时)
   ```typescript
   // src/commands/team.ts - 新增team命令
   ```

#### 下午 (3-4小时)：团队基础功能
1. **团队管理命令** (2小时)
   ```bash
   ccusage team create "开发车队"     # 创建车队，返回邀请码
   ccusage team join ABC123          # 加入车队
   ccusage team list                 # 查看我的车队
   ccusage team members              # 查看车队成员
   ```

2. **数据同步机制** (2小时)
   - 基于现有 `LiveMonitor` 扩展
   - 添加车队数据上传功能
   - 实现本地→Supabase数据同步

### 第2天：实时监控界面 (6-8小时)

#### 上午 (3-4小时)：车队实时监控
1. **扩展现有live渲染** (2小时)
   ```typescript
   // src/team/_team-live-rendering.ts - 车队实时渲染逻辑
   ```

2. **车队状态聚合** (2小时)
   ```typescript
   // src/team/team-aggregator.ts - 聚合多用户数据
   ```

#### 下午 (3-4小时)：界面优化
1. **中文界面** (2小时)
   - 复用现有渲染组件，替换文案
   - 添加成员状态显示

2. **智能建议系统** (2小时)
   - 基于燃烧率的使用建议
   - 时段冲突检测

**预期界面效果**：
```
┌─────────────────────────────────────────────────────────┐
│              🚗 CLAUDE 拼车实时监控                      │
├─────────────────────────────────────────────────────────┤
│ 车队: 我的开发团队  |  成员: 5/5  |  活跃: 3            │
│ 当前窗口: 14:30-19:30  |  剩余: 2h 15m                  │
├─────────────────────────────────────────────────────────┤
│ 🔥 使用情况                                             │
│ TOKEN  [████████░░░░] 67.5% (135k/200k)                │
│ 费用: $12.50 / 燃烧率: 850 token/min ⚡ MODERATE       │
├─────────────────────────────────────────────────────────┤
│ 👥 成员状态                                             │
│ 🟢 张三    [活跃] 45k tokens  上午使用偏好             │
│ 🟡 李四    [空闲] 23k tokens  下午使用偏好             │
│ 🟢 王五    [活跃] 67k tokens  全天使用                 │
│ ⚫ 赵六    [离线] 0 tokens    晚上使用偏好              │
│ ⚫ 钱七    [离线] 0 tokens    周末使用偏好              │
├─────────────────────────────────────────────────────────┤
│ 💡 智能建议                                             │
│ • 王五使用量较高，建议适当控制                          │
│ • 下午3-5点为团队高峰期，注意协调                       │
│ • 预计19:00窗口结束，建议提前规划                       │
└─────────────────────────────────────────────────────────┘
```

### 第3天：后台管理端 (6-8小时)

#### 上午 (3-4小时)：Next.js 后台搭建
1. **项目初始化** (1小时)
   ```bash
   npx create-next-app@latest team-dashboard --typescript --tailwind --app
   cd team-dashboard && npm install @supabase/supabase-js @supabase/auth-helpers-nextjs
   ```

2. **基础页面** (2-3小时)
   - 车队列表页面
   - 车队详情页面  
   - 成员管理页面

#### 下午 (3-4小时)：数据分析功能
1. **使用统计图表** (2小时)
   - 集成 recharts 或 chart.js
   - 显示使用趋势、成员活跃度

2. **智能调度建议** (2小时)
   - 分析使用模式
   - 生成时段建议

### 第4天：测试和部署 (4-6小时)

#### 上午 (2-3小时)：测试和修复
1. **功能测试** (1小时)
2. **修复问题** (1-2小时)

#### 下午 (2-3小时)：部署
1. **Vercel 部署** (1小时)
2. **文档和使用说明** (1-2小时)

## 文件结构

```
src/
├── team/                      # 新增车队功能模块
│   ├── _team-types.ts         # 车队相关类型
│   ├── supabase-client.ts     # Supabase客户端
│   ├── team-service.ts        # 车队业务逻辑
│   ├── team-aggregator.ts     # 多用户数据聚合
│   └── _team-live-rendering.ts # 车队实时渲染
├── commands/
│   ├── team.ts               # 新增team命令
│   └── index.ts              # 更新命令注册
└── _live-rendering.ts        # 扩展现有渲染逻辑

team-dashboard/               # 独立的 Next.js 项目
├── app/
│   ├── teams/
│   ├── dashboard/
│   └── layout.tsx
├── components/
└── lib/
    └── supabase.ts
```

## 隐私保护措施

### 数据最小化原则
- 仅收集必要的聚合数据（token数量、时间段）
- 不存储具体对话内容
- 支持数据本地化存储

### 安全措施
- E2E 加密团队通信
- 匿名化用户标识
- 支持自托管部署
- Supabase RLS 策略保护数据访问

## 开发优势

1. **复用现有架构**：90%的代码逻辑可以复用
2. **渐进式开发**：每天都有可用的功能增量
3. **类型安全**：基于现有的 Zod 验证和 TypeScript 类型
4. **测试覆盖**：复用现有的测试框架和模式

## 功能优先级

### 必需功能（第1-2天）
- ✅ 车队创建/加入
- ✅ 实时监控界面
- ✅ 数据同步机制

### 增强功能（第3天）
- ✅ Web后台管理
- ✅ 使用统计分析

### 可选功能（第4天+）
- 📈 高级智能建议
- 🔔 使用提醒功能
- 📱 移动端适配

## 使用示例

### CLI 命令
```bash
# 创建车队
ccusage team create "我的开发团队"
# 输出: 车队创建成功！邀请码: ABC123

# 加入车队
ccusage team join ABC123
# 输出: 成功加入车队"我的开发团队"

# 启动车队实时监控
ccusage team live
# 显示中文友好的车队实时监控界面
```

### Web 管理界面
- 访问部署在 Vercel 的管理后台
- 查看详细的使用统计和趋势分析
- 管理车队成员和设置
- 获得智能调度建议

---

*本开发计划充分利用现有项目的稳定基础，预计在3-4天内完成核心功能开发。*