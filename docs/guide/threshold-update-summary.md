# 阈值配置更新总结

## 更新内容

本次更新修正了系统的阈值配置，从硬编码的200K tokens更新为动态配置系统，支持ClaudeMax计划的正确计费标准。

## 主要改动

### 1. 数据库结构更新

**需要执行**: `database/add-system-config.sql`

- 新增 `system_config` 表用于存储全局配置
- 支持动态价格计算和静态配置两种模式
- ClaudeMax计划的正确fallback值：100M tokens

### 2. CLI代码更新

- 更新所有hardcoded的200K token限制为从数据库动态获取
- 集成LiteLLM价格API，支持$40美元等值的动态token计算
- 支持ClaudeMax计划的正确计费标准
- Fallback值更新为100M tokens

### 3. Web界面更新

- 系统设置页面支持从数据库读取和保存配置
- 双模式设置：按token数量或按等值美元
- 动态价格计算集成（基于LiteLLM）
- ClaudeMax计划UI适配

## 核心特性

### 动态价格计算

```typescript
// 从LiteLLM获取Claude 4 Sonnet实际价格
const pricingData = await fetchModelPricing();
const claude4Price = pricingData.find(p => p.model === 'claude-sonnet-4-20250514');
const avgPricePerToken = (claude4Price.inputCostPer1kTokens + claude4Price.outputCostPer1kTokens) / 2 / 1000;

// 计算$40对应的token数量
const targetTokens = Math.round(40.0 / avgPricePerToken);
```

### 配置层级

1. **动态计算** (推荐): 基于LiteLLM实时价格计算$40等值token数量
2. **数据库配置**: 管理员在web界面设置的固定值
3. **Fallback**: ClaudeMax计划默认值 (100M tokens)

### ClaudeMax计划参数

- **单次会话**: 100M tokens (fallback)
- **每日限制**: 500M tokens  
- **每月限制**: 15B tokens
- **动态计算**: $40 ÷ LiteLLM实时价格

## 使用指南

### 数据库迁移

1. 在 Supabase Dashboard 中执行 `database/add-system-config.sql`
2. 确认 `system_config` 表创建成功
3. 验证默认配置已插入

### CLI使用

```bash
# 使用动态计算的token限制（从LiteLLM获取价格）
ccusage team live

# 使用自定义token限制覆盖动态计算
ccusage team live --token-limit 200000000
```

### Web配置

1. 访问 `/admin/settings`
2. 在"Token限制"部分选择设置方式：
   - **按Token数量**: 直接输入token数值
   - **按等值美元**: 输入美元金额，自动计算token数量
3. 保存配置到数据库

## 技术细节

### 文件修改列表

**CLI核心文件**:
- `src/team/system-config.ts` - 系统配置管理器（新增）
- `src/team/team-aggregator.ts` - 集成系统配置
- `src/team/enhanced-live-monitor.ts` - 动态获取token限制  
- `src/team/_team-live-rendering.ts` - 支持配置参数
- `src/commands/team.ts` - 动态默认值
- `src/commands/interactive.ts` - 动态默认值

**Web界面文件**:
- `src/app/api/admin/system-config/route.ts` - 配置API（新增）
- `src/app/admin/settings/page.tsx` - 双模式设置界面

**数据库文件**:
- `database/add-system-config.sql` - 数据库迁移（新增）

### 配置示例

```json
{
  "token_limits": {
    "per_session": 100000000,
    "daily": 500000000,
    "monthly": 15000000000
  },
  "pricing_config": {
    "use_litellm": true,
    "target_usd_amount": 40.0,
    "fallback_tokens": 100000000,
    "claude_max_plan": true
  }
}
```

## 后续改进

1. **LiteLLM API集成**: Web界面直接调用LiteLLM获取实时价格
2. **模型选择**: 支持不同Claude模型的价格计算
3. **缓存优化**: 缓存价格数据减少API调用
4. **监控告警**: 价格波动或API故障时的通知机制

## 注意事项

- 首次运行需要执行数据库迁移
- 动态价格计算需要网络连接访问LiteLLM
- 网络故障时会自动fallback到100M tokens
- Web界面的美元换算为近似值，实际以动态计算为准