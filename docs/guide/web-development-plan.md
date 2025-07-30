# CCUsage 管理员后台 Web 开发规划

**项目名称**: ccusage-admin-web  
**项目类型**: 管理员后台系统  
**技术栈**: Next.js 15 + Tailwind CSS + shadcn/ui + Supabase  
**部署目标**: Vercel  
**开发时间**: 4-6小时（快速MVP）

## 🎯 项目目标

### 核心目标（管理员视角）
- 🏢 **全局概览**: 查看所有车队的整体使用情况
- 🚗 **车队管理**: 创建、删除、编辑所有车队
- 👥 **成员监控**: 查看所有成员的跨车队使用情况
- ⚙️ **系统配置**: 设置全局警告阈值和限制

### 非功能需求
- ✅ **快速开发**: 使用现成组件库，4-6小时完成MVP
- 🎨 **UI简洁**: shadcn/ui提供统一设计语言
- 📱 **响应式**: 支持桌面和移动端
- ⚡ **性能优化**: Vercel边缘部署，CDN加速

## 🏗️ 技术架构

### 前端技术栈
```typescript
// 核心框架
Next.js 15 (App Router)
TypeScript
Tailwind CSS

// UI组件库
shadcn/ui (基于Radix UI)
Lucide React (图标库)
recharts (图表库)

// 数据层
@supabase/supabase-js
TanStack Query (数据缓存)

// 工具库
date-fns (日期处理)
clsx (样式合并)
zod (类型验证)
```

### 部署和基础设施
```yaml
部署平台: Vercel
域名: ccusage-web.vercel.app
环境变量: 
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY
  - SUPABASE_SERVICE_ROLE_KEY (服务端)
```

## 📱 页面结构设计

### 管理员后台路由规划
```
/                          # 管理员登录页
├── /admin                 # 管理员主仪表盘
│   ├── /overview         # 全局概览
│   ├── /teams            # 车队管理
│   │   ├── /             # 所有车队列表
│   │   ├── /[teamId]     # 车队详情管理
│   │   ├── /create       # 创建新车队
│   │   └── /settings     # 车队批量设置
│   ├── /members          # 成员管理
│   │   ├── /             # 所有成员列表
│   │   ├── /[userId]     # 成员详情
│   │   └── /analytics    # 成员使用分析
│   ├── /settings         # 系统设置
│   │   ├── /thresholds   # 警告阈值设置
│   │   ├── /limits       # 限制配置
│   │   └── /notifications # 通知配置
│   └── /analytics        # 全局数据分析
└── /api                  # API路由
```

### 核心页面设计

#### 1. 🔐 管理员登录页 (`/`)
```typescript
// 功能: 管理员身份验证
- 管理员密码登录
- 访问权限验证
- 安全性保护
- 简洁的管理员界面风格
```

#### 2. 📊 全局概览仪表盘 (`/admin/overview`)
```typescript
// 功能: 系统整体状态监控
Components:
├── GlobalStatsCards     # 全局统计卡片
│   ├── TotalTeamsCard   # 总车队数量
│   ├── ActiveUsersCard  # 活跃用户数量
│   ├── TotalUsageCard   # 总使用量统计
│   └── TotalCostCard    # 总成本统计
├── RealtimeActivityFeed # 实时活动流
├── AlertsPanel          # 警告面板
├── TopTeamsByUsage      # 使用量TOP车队
└── SystemHealthStatus   # 系统健康状态

Layout: 管理员仪表盘布局，数据密集显示
Updates: 15秒自动刷新（比用户端更频繁）
```

#### 3. 🚗 车队管理页面 (`/admin/teams`)
```typescript
// 功能: 所有车队的综合管理
Components:
├── TeamsTable           # 车队列表表格
│   ├── TeamBasicInfo    # 基本信息（名称、创建时间、成员数）
│   ├── UsageMetrics     # 使用指标（tokens、费用、活跃度）
│   ├── StatusIndicators # 状态指示器（正常/警告/超限）
│   └── QuickActions     # 快速操作（查看/编辑/删除）
├── BulkOperations       # 批量操作工具
├── CreateTeamButton     # 创建新车队
├── FilterAndSearch      # 筛选和搜索
└── ExportTools          # 数据导出工具

Features:
- 分页显示（支持大量车队）
- 排序功能（按使用量、费用、创建时间等）
- 批量删除和编辑
- 实时状态更新
```

#### 4. 👥 成员管理页面 (`/admin/members`)
```typescript
// 功能: 跨车队成员监控和管理
Components:
├── MembersTable         # 成员列表表格
│   ├── UserProfile      # 用户基本信息
│   ├── TeamsAffiliation # 所属车队信息
│   ├── UsageAcrossTeams # 跨车队使用统计
│   ├── ActivityStatus   # 活动状态
│   └── RiskIndicators   # 风险指标
├── CrossTeamAnalytics   # 跨车队分析
├── UserSearchTools      # 用户搜索工具
└── BehaviorAlerts       # 行为异常警告

Features:
- 用户跨车队使用情况
- 异常行为检测
- 使用模式分析
```

#### 5. ⚙️ 系统设置页面 (`/admin/settings`)
```typescript
// 功能: 全局系统配置管理
Sections:
├── ThresholdSettings    # 警告阈值设置
│   ├── CostWarningLevels    # 费用警告线
│   │   ├── Level1Warning    # 一级警告（如80%）
│   │   ├── Level2Warning    # 二级警告（如90%）
│   │   └── CriticalLimit    # 严重限制（如100%）
│   ├── TokenLimits          # Token限制设置
│   │   ├── PerSessionLimit  # 单窗口期限制
│   │   ├── DailyLimit       # 日限制
│   │   └── MonthlyLimit     # 月限制
│   └── BurnRateThresholds   # 燃烧率阈值
├── NotificationSettings # 通知配置
│   ├── EmailAlerts      # 邮件警告
│   ├── SlackIntegration # Slack集成
│   └── WebhookSettings  # Webhook配置
├── SystemLimits         # 系统限制
│   ├── MaxTeamsPerUser  # 用户最大车队数
│   ├── MaxMembersPerTeam # 车队最大成员数
│   └── SessionDuration  # 会话持续时间
└── DatabaseMaintenance  # 数据库维护
    ├── DataRetention    # 数据保留政策
    ├── BackupSettings   # 备份设置
    └── CleanupTools     # 清理工具

Interface:
- 实时预览设置效果
- 批量导入/导出配置
- 设置版本管理
```

#### 6. 📈 全局数据分析页面 (`/admin/analytics`)
```typescript
// 功能: 深度数据分析和洞察
Charts:
├── SystemOverviewCharts # 系统概览图表
│   ├── UsageTrendChart  # 整体使用趋势
│   ├── CostGrowthChart  # 成本增长图
│   └── UserGrowthChart  # 用户增长图
├── TeamComparisons      # 车队对比分析
│   ├── UsageComparison  # 使用量对比
│   ├── EfficiencyRanking # 效率排名
│   └── CostEffectiveness # 成本效益分析
├── PredictiveAnalytics  # 预测分析
│   ├── UsagePrediction  # 使用量预测
│   ├── CostProjection   # 成本预测
│   └── CapacityPlanning # 容量规划
└── CustomReports        # 自定义报告
    ├── ReportBuilder    # 报告构建器
    ├── ScheduledReports # 定时报告
    └── DataExport       # 数据导出

Features:
- 交互式图表
- 自定义时间范围
- 数据钻取功能
- 报告订阅功能
```

## 🎨 UI/UX 设计方案

### 设计系统
```typescript
// 颜色主题 (基于团队监控CLI的配色)
Primary: Blue-600      # 主色调
Success: Green-500     # 成功状态
Warning: Yellow-500    # 警告状态  
Error: Red-500         # 错误状态
Neutral: Gray-500      # 中性色

// 字体
Font: Inter (系统字体备选)
Sizes: text-sm, text-base, text-lg, text-xl, text-2xl

// 间距系统
Spacing: 4, 8, 12, 16, 24, 32, 48, 64 (px)
```

### 管理员后台组件规划
```typescript
// 管理员专用组件
├── Layout/
│   ├── AdminLayout.tsx      # 管理员主布局
│   ├── AdminSidebar.tsx     # 管理员侧边栏
│   ├── AdminHeader.tsx      # 管理员顶部栏
│   └── Breadcrumb.tsx       # 面包屑导航
├── Dashboard/
│   ├── GlobalStatsCard.tsx  # 全局统计卡片
│   ├── ActivityFeed.tsx     # 实时活动流
│   ├── AlertsPanel.tsx      # 警告面板
│   ├── SystemHealth.tsx     # 系统健康状态
│   └── TopTeamsWidget.tsx   # TOP车队组件
├── Teams/
│   ├── TeamsTable.tsx       # 车队管理表格
│   ├── TeamDetailsModal.tsx # 车队详情弹窗
│   ├── BulkActions.tsx      # 批量操作工具
│   ├── TeamFilters.tsx      # 筛选组件
│   └── CreateTeamForm.tsx   # 创建车队表单
├── Members/
│   ├── MembersTable.tsx     # 成员管理表格
│   ├── UserProfile.tsx      # 用户详情
│   ├── CrossTeamAnalytics.tsx # 跨车队分析
│   └── BehaviorAlerts.tsx   # 行为警告
├── Settings/
│   ├── ThresholdSettings.tsx # 阈值设置
│   ├── NotificationSettings.tsx # 通知设置
│   ├── SystemLimits.tsx     # 系统限制
│   └── ConfigImportExport.tsx # 配置导入导出
├── Analytics/
│   ├── OverviewCharts.tsx   # 概览图表
│   ├── TeamComparison.tsx   # 车队对比
│   ├── PredictiveCharts.tsx # 预测图表
│   └── ReportBuilder.tsx    # 报告构建器
└── Common/
    ├── DataTable.tsx        # 通用数据表格
    ├── ConfirmDialog.tsx    # 确认对话框
    ├── LoadingSpinner.tsx   # 加载动画
    ├── ErrorBoundary.tsx    # 错误边界
    ├── Toast.tsx           # 消息提示
    └── PermissionGuard.tsx  # 权限保护
```

## 🔄 数据流设计

### 管理员API路由设计
```typescript
// Next.js API Routes for Admin
├── /api/admin/auth         # 管理员认证
│   ├── /login             # 管理员登录
│   └── /verify            # 权限验证
├── /api/admin/overview     # 全局概览数据
│   ├── /stats             # 全局统计
│   ├── /activity          # 实时活动
│   └── /alerts            # 系统警告
├── /api/admin/teams        # 车队管理
│   ├── /                  # 获取所有车队
│   ├── /[id]             # 特定车队CRUD
│   ├── /[id]/members     # 车队成员管理
│   ├── /[id]/usage       # 车队使用数据
│   ├── /bulk-operations  # 批量操作
│   └── /stats            # 车队统计对比
├── /api/admin/members      # 成员管理
│   ├── /                  # 获取所有成员
│   ├── /[userId]         # 特定成员详情
│   ├── /cross-team       # 跨车队分析
│   └── /behavior-alerts  # 行为异常
├── /api/admin/settings     # 系统设置
│   ├── /thresholds       # 阈值配置
│   ├── /limits           # 限制配置
│   ├── /notifications    # 通知配置
│   ├── /export           # 导出配置
│   └── /import           # 导入配置
├── /api/admin/analytics    # 数据分析
│   ├── /overview         # 系统概览图表
│   ├── /teams            # 车队对比分析
│   ├── /predictions      # 预测分析
│   └── /reports          # 自定义报告
└── /api/admin/system       # 系统管理
    ├── /health           # 系统健康检查
    ├── /maintenance      # 维护操作
    └── /backup           # 备份操作
```

### 数据管理策略
```typescript
// TanStack Query配置
const queryConfig = {
  staleTime: 30 * 1000,      // 30秒数据新鲜时间
  cacheTime: 5 * 60 * 1000,  // 5分钟缓存时间
  refetchInterval: 30 * 1000, // 30秒自动刷新
  retry: 3,                   // 失败重试3次
};

// 关键查询
- useTeamStats()    # 团队统计数据
- useTeamMembers()  # 团队成员列表  
- useUsageHistory() # 使用历史记录
- useUserTeams()    # 用户团队列表
```

### 实时数据更新
```typescript
// Supabase Realtime订阅
useEffect(() => {
  const subscription = supabase
    .from('usage_sessions')
    .on('INSERT', payload => {
      queryClient.invalidateQueries(['teamStats', teamId]);
    })
    .on('UPDATE', payload => {
      queryClient.invalidateQueries(['teamStats', teamId]);
    })
    .subscribe();
    
  return () => subscription.unsubscribe();
}, [teamId]);
```

## 📦 开发阶段规划

### 第一阶段：基础搭建（1小时）
```bash
# 项目初始化
npx create-next-app@latest ccusage-web --typescript --tailwind --eslint --app
cd ccusage-web

# 依赖安装
npm install @supabase/supabase-js @tanstack/react-query
npm install @radix-ui/react-* lucide-react recharts date-fns clsx
npm install -D @types/node

# shadcn/ui初始化
npx shadcn-ui@latest init
npx shadcn-ui@latest add button card input label toast tabs
```

### 第二阶段：核心功能（2-3小时）
1. **Supabase集成**（30分钟）
   - 客户端配置
   - 认证系统
   - 数据查询函数

2. **主仪表盘**（90分钟）
   - 布局组件
   - 统计卡片
   - 实时数据显示
   - 响应式适配

3. **团队管理**（60分钟）
   - 团队列表
   - 成员管理
   - 邀请功能

### 第三阶段：数据可视化（1-2小时）
1. **图表集成**（60分钟）
   - recharts配置
   - 使用趋势图
   - 成本分析图

2. **高级功能**（60分钟）
   - 数据导出
   - 设置管理
   - 错误处理

### 第四阶段：部署优化（30分钟）
1. **环境配置**
   - Vercel部署配置
   - 环境变量设置
   - 域名配置

2. **性能优化**
   - 图片优化
   - 代码分割
   - SEO优化

## 🚀 部署方案

### Vercel部署配置
```json
// vercel.json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "devCommand": "npm run dev",
  "installCommand": "npm install",
  "env": {
    "NEXT_PUBLIC_SUPABASE_URL": "@supabase-url",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": "@supabase-anon-key"
  }
}
```

### 环境变量清单
```bash
# Supabase配置
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... # 服务端使用

# 应用配置  
NEXT_PUBLIC_APP_URL=https://ccusage-web.vercel.app
NEXT_PUBLIC_APP_NAME=CCUsage Team Monitor
```

## 📊 管理员后台功能特性清单

### MVP功能（必须实现）
- [ ] 🔐 **管理员认证** - 密码登录 + 权限验证
- [ ] 📊 **全局概览仪表盘** - 系统整体状态监控
- [ ] 🚗 **车队管理** - 查看/创建/删除所有车队
- [ ] 👥 **成员监控** - 跨车队成员使用情况
- [ ] ⚙️ **阈值设置** - 费用警告线和Token限制配置
- [ ] 📈 **基础分析** - 使用趋势和成本图表
- [ ] 📱 **响应式设计** - 桌面和平板适配
- [ ] 🚀 **Vercel部署** - 生产环境部署

### 核心管理功能（优先实现）
- [ ] 🔍 **实时监控** - 15秒自动刷新系统状态
- [ ] ⚠️ **警告系统** - 超限警告和风险提示
- [ ] 📋 **批量操作** - 车队批量管理和配置
- [ ] 🔧 **系统配置** - 全局设置和参数调整
- [ ] 📊 **数据导出** - CSV/JSON格式数据导出

### 增强功能（时间允许）
- [ ] 📈 **高级分析** - 预测分析和容量规划
- [ ] 🔔 **通知集成** - Email/Slack/Webhook通知
- [ ] 📝 **操作日志** - 管理员操作审计
- [ ] 🎨 **自定义仪表盘** - 可配置的监控面板
- [ ] 🌙 **深色模式** - 管理员界面主题切换
- [ ] 🔄 **定时任务** - 自动化维护和报告

## ⚡ 快速开发策略

### 1. 组件复用最大化
```typescript
// 使用shadcn/ui预制组件
import { Button, Card, Input, Badge } from "@/components/ui"

// 统一的数据展示模式
<Card className="p-6">
  <CardHeader>
    <CardTitle>{title}</CardTitle>
  </CardHeader>
  <CardContent>{children}</CardContent>
</Card>
```

### 2. 样式系统简化
```typescript
// Tailwind CSS实用类
const cardStyles = "bg-white rounded-lg shadow-sm border p-6"
const buttonStyles = "bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md"
const textStyles = "text-gray-900 text-sm font-medium"
```

### 3. 数据管理标准化
```typescript
// 统一的数据获取模式
export const useTeamData = (teamId: string) => {
  return useQuery({
    queryKey: ['team', teamId],
    queryFn: () => fetchTeamData(teamId),
    ...queryConfig
  });
};
```

## 🎯 成功指标

### 技术指标
- ✅ 首屏加载时间 < 2秒
- ✅ 移动端适配100%
- ✅ TypeScript覆盖率100%
- ✅ 零生产环境错误

### 功能指标  
- ✅ 实时数据刷新（30秒间隔）
- ✅ 团队创建和邀请流程完整
- ✅ 图表数据准确性100%
- ✅ 响应式设计完美适配

### 用户体验指标
- ✅ 界面简洁直观
- ✅ 操作流程顺畅
- ✅ 加载状态友好
- ✅ 错误提示清晰

## 🗄️ 数据库扩展需求

### 新增管理员配置表
```sql
-- 管理员配置表
CREATE TABLE admin_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    setting_key VARCHAR(100) NOT NULL UNIQUE,
    setting_value JSONB NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 系统阈值配置
INSERT INTO admin_settings (setting_key, setting_value, description) VALUES
('cost_warning_levels', '{"level1": 0.8, "level2": 0.9, "critical": 1.0}', '费用警告级别'),
('token_limits', '{"per_session": 200000, "daily": 1000000, "monthly": 30000000}', 'Token限制配置'),
('burn_rate_thresholds', '{"high": 1000, "moderate": 500, "normal": 100}', '燃烧率阈值'),
('notification_settings', '{"email_enabled": true, "slack_enabled": false}', '通知配置'),
('system_limits', '{"max_teams_per_user": 10, "max_members_per_team": 50}', '系统限制');

-- 管理员用户表（简单密码认证）
CREATE TABLE admin_users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 操作日志表
CREATE TABLE admin_operations_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    admin_id UUID REFERENCES admin_users(id),
    operation VARCHAR(100) NOT NULL,
    target_type VARCHAR(50), -- 'team', 'member', 'settings'
    target_id VARCHAR(100),
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 系统警告表
CREATE TABLE system_alerts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    alert_type VARCHAR(50) NOT NULL, -- 'cost_warning', 'token_limit', 'burn_rate'
    severity VARCHAR(20) NOT NULL, -- 'info', 'warning', 'critical'
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    team_id UUID REFERENCES teams(id),
    user_id VARCHAR(100),
    metadata JSONB,
    is_resolved BOOLEAN DEFAULT false,
    resolved_by UUID REFERENCES admin_users(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX idx_admin_settings_key ON admin_settings(setting_key);
CREATE INDEX idx_admin_operations_log_admin ON admin_operations_log(admin_id);
CREATE INDEX idx_admin_operations_log_created ON admin_operations_log(created_at DESC);
CREATE INDEX idx_system_alerts_type ON system_alerts(alert_type);
CREATE INDEX idx_system_alerts_severity ON system_alerts(severity);
CREATE INDEX idx_system_alerts_unresolved ON system_alerts(is_resolved) WHERE is_resolved = false;
```

### 管理员权限配置
```typescript
// 环境变量配置
ADMIN_PASSWORD_HASH=bcrypt_hash_of_admin_password
ADMIN_SESSION_SECRET=random_secret_key_for_jwt
ADMIN_TOKEN_EXPIRY=24h

// 管理员权限中间件
export const adminAuth = async (req: NextRequest) => {
  const token = req.cookies.get('admin_token')?.value;
  if (!token) return false;
  
  try {
    const decoded = jwt.verify(token, process.env.ADMIN_SESSION_SECRET!);
    return decoded;
  } catch {
    return false;
  }
};
```

---

## 🤔 确认管理员后台开发方案

这个**管理员后台**规划涵盖了：

### 🎯 **核心定位**
- **管理员视角**: 超级用户权限，可管理所有车队和成员
- **系统监控**: 实时监控所有车队使用情况和系统健康状态
- **配置管理**: 设置全局阈值、限制和警告规则
- **数据分析**: 跨车队数据分析和趋势预测

### 🏗️ **技术架构**
1. **前端**: Next.js 15 + shadcn/ui + Tailwind CSS（管理员友好的UI）
2. **后端**: Next.js API + Supabase（RLS权限控制）
3. **数据库**: 扩展现有schema，添加管理员配置表
4. **部署**: Vercel（生产级部署）
5. **认证**: 简单密码登录 + JWT会话管理

### 📋 **关键功能**
- 🏢 **全局车队管理**: 查看/创建/删除所有车队
- 👥 **跨车队成员监控**: 成员使用情况和异常行为检测
- ⚙️ **系统配置**: 费用警告线、Token限制、燃烧率阈值
- 📊 **实时监控**: 15秒刷新的系统状态仪表盘
- 📈 **数据分析**: 使用趋势、成本分析、预测报告

### ⏱️ **开发计划**
- **总时间**: 4-6小时完成MVP
- **第一优先级**: 管理员认证 + 全局概览
- **第二优先级**: 车队管理 + 成员监控
- **第三优先级**: 系统配置 + 阈值设置
- **第四优先级**: 数据分析 + 部署优化

### 🔧 **特色功能**
- **批量操作**: 一键管理多个车队
- **智能警告**: 自动检测超限和异常使用
- **实时刷新**: 比用户端更频繁的数据更新
- **操作审计**: 记录所有管理员操作
- **数据导出**: CSV/JSON格式批量导出

---

## 🚀 **准备开始开发？**

这个管理员后台将提供：
- ✅ **完整的系统控制权**
- ✅ **实时监控所有车队**  
- ✅ **灵活的配置管理**
- ✅ **强大的数据分析**
- ✅ **简洁的管理界面**

**如果你同意这个管理员后台方案，我将立即开始：**

1. 🏗️ 创建 Next.js 管理员项目
2. 🔐 实现管理员认证系统
3. 🗄️ 扩展数据库schema（添加管理员配置表）
4. 📊 构建全局监控仪表盘
5. 🚗 实现车队管理功能
6. ⚙️ 开发系统配置界面
7. 🚀 部署到Vercel

**确认开始开发吗？还是需要调整什么功能？**