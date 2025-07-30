# 车队拼车功能数据库设置

## 快速开始

### 1. 创建 Supabase 项目

1. 访问 [Supabase](https://supabase.com) 并创建新项目
2. 等待项目初始化完成
3. 获取项目的 URL 和 API Key

### 2. 运行数据库迁移

在 Supabase Dashboard 中:

1. 进入 **SQL Editor**
2. 创建新查询
3. 复制 `schema.sql` 文件内容并执行
4. 确认所有表和索引创建成功

### 3. 配置环境变量

在您的 shell 配置文件中添加（或创建 `.env` 文件）:

```bash
export SUPABASE_URL="https://your-project-id.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key"
```

### 4. 测试连接

```bash
# 测试数据库连接
ccusage team list

# 如果看到错误信息，说明需要配置环境变量
```

## 数据库结构

### 核心表

#### `teams` - 车队表

- `id`: 车队唯一标识
- `name`: 车队名称 (1-50字符)
- `code`: 6位邀请码 (大写字母和数字)
- `created_at`: 创建时间
- `settings`: 车队设置 (JSON)

#### `team_members` - 车队成员表

- `id`: 成员记录唯一标识
- `team_id`: 所属车队ID
- `user_name`: 用户显示名称 (1-30字符)
- `user_id`: 用户唯一标识（基于机器+用户名生成）
- `joined_at`: 加入时间
- `is_active`: 是否活跃
- `settings`: 个人设置 (时区、偏好时段等)

#### `usage_sessions` - 使用会话表

- `id`: 会话记录唯一标识
- `team_id`: 所属车队ID
- `user_id`: 用户标识
- `session_id`: 对应 SessionBlock.id
- `start_time`: 会话开始时间
- `end_time`: 会话结束时间
- `is_active`: 是否为活跃会话
- `token_counts`: Token 使用统计 (JSON)
- `cost_usd`: 费用（美元）
- `models`: 使用的模型列表
- `created_at/updated_at`: 创建/更新时间

#### `team_live_status` - 车队实时状态表

- `team_id`: 车队ID（主键）
- `active_session_id`: 当前活跃会话ID
- `active_members`: 活跃成员列表 (JSON)
- `total_tokens`: 总 Token 数
- `total_cost`: 总费用
- `burn_rate`: 燃烧率信息 (JSON)
- `updated_at`: 最后更新时间

### 视图

#### `team_stats` - 车队统计视图

提供车队的聚合统计信息，包括成员数量、Token使用量、总费用等。

#### `member_activity` - 成员活跃度视图

显示每个成员的活跃度统计，包括会话数量、Token使用量、最后活动时间等。

## 安全设置

### 行级安全 (RLS)

当前设置为开发友好的宽松策略。在生产环境中，建议实施更严格的安全策略：

```sql
-- 示例：更严格的 RLS 策略
-- 用户只能访问自己参与的车队数据

DROP POLICY IF EXISTS "Allow all operations on teams" ON teams;
CREATE POLICY "Users can only access their teams" ON teams
    FOR ALL USING (
        id IN (
            SELECT team_id FROM team_members
            WHERE user_id = current_setting('request.jwt.claims', true)::json->>'user_id'
        )
    );
```

### 数据验证

数据库层面已添加多种约束：

- 车队名称长度限制 (1-50字符)
- 邀请码格式验证 (6位大写字母数字)
- Token数量非负验证
- 时间顺序验证 (开始时间 <= 结束时间)
- JSON结构验证

## 性能优化

### 索引策略

已创建以下索引以优化常用查询：

- `teams.code` - 快速邀请码查找
- `team_members.team_id` - 车队成员查询
- `team_members.user_id` - 用户车队查询
- `usage_sessions.team_id` - 车队使用数据查询
- `usage_sessions.start_time` - 时间范围查询

### 查询优化建议

1. **分页查询**: 对大量数据使用 `LIMIT` 和 `OFFSET`
2. **时间范围**: 在查询使用数据时限制时间范围
3. **索引覆盖**: 尽量使用已建立的索引字段进行查询

## 数据维护

### 定期清理

建议定期清理旧数据：

```sql
-- 清理30天前的非活跃使用会话
DELETE FROM usage_sessions
WHERE is_active = false
  AND updated_at < NOW() - INTERVAL '30 days';

-- 清理已离开车队的成员记录（保留90天）
DELETE FROM team_members
WHERE is_active = false
  AND joined_at < NOW() - INTERVAL '90 days';
```

### 备份策略

1. **自动备份**: Supabase 提供自动每日备份
2. **手动备份**: 在重要更新前手动创建备份点
3. **数据导出**: 定期导出重要统计数据

## 故障排除

### 常见问题

1. **连接失败**

   - 检查 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY` 环境变量
   - 确认 Supabase 项目状态正常

2. **权限错误**

   - 检查 RLS 策略设置
   - 确认 API Key 权限

3. **数据不一致**
   - 检查约束条件
   - 验证 JSON 数据格式

### 调试命令

```bash
# 测试数据库连接
ccusage team list

# 查看详细错误信息
export DEBUG=1
ccusage team create "测试车队"
```

## 版本管理

当前 Schema 版本: `1.0.0`

升级步骤：

1. 备份现有数据
2. 运行新版本迁移脚本
3. 验证数据完整性
4. 更新应用程序
