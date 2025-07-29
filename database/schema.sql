-- 车队拼车功能数据库 Schema
-- 创建日期: 2025-07-29
-- 说明: 用于 Claude 拼车功能的数据库表结构和相关设置

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 车队表
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL CHECK (char_length(name) >= 1 AND char_length(name) <= 50),
    code TEXT UNIQUE NOT NULL CHECK (char_length(code) = 6),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    settings JSONB DEFAULT '{}'::jsonb,
    
    -- 索引
    CONSTRAINT teams_name_not_empty CHECK (trim(name) != ''),
    CONSTRAINT teams_code_format CHECK (code ~ '^[A-Z0-9]{6}$')
);

-- 车队成员表
CREATE TABLE team_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_name TEXT NOT NULL CHECK (char_length(user_name) >= 1 AND char_length(user_name) <= 30),
    user_id TEXT NOT NULL CHECK (char_length(user_id) >= 1),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,
    settings JSONB DEFAULT '{}'::jsonb,
    
    -- 约束
    UNIQUE(team_id, user_id),
    CONSTRAINT team_members_user_name_not_empty CHECK (trim(user_name) != '')
);

-- 使用会话表（基于 SessionBlock 结构）
CREATE TABLE usage_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL, -- 对应 SessionBlock.id
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN DEFAULT false,
    token_counts JSONB NOT NULL DEFAULT '{
        "inputTokens": 0,
        "outputTokens": 0,
        "cacheCreationInputTokens": 0,
        "cacheReadInputTokens": 0
    }'::jsonb,
    cost_usd DECIMAL(10,4) DEFAULT 0 CHECK (cost_usd >= 0),
    models TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- 约束
    UNIQUE(team_id, user_id, session_id),
    CONSTRAINT usage_sessions_time_order CHECK (start_time <= end_time),
    CONSTRAINT usage_sessions_token_counts_structure CHECK (
        jsonb_typeof(token_counts) = 'object' AND
        token_counts ? 'inputTokens' AND
        token_counts ? 'outputTokens' AND
        token_counts ? 'cacheCreationInputTokens' AND
        token_counts ? 'cacheReadInputTokens'
    )
);

-- 车队实时状态表
CREATE TABLE team_live_status (
    team_id UUID PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
    active_session_id TEXT,
    active_members JSONB DEFAULT '[]'::jsonb,
    total_tokens INTEGER DEFAULT 0 CHECK (total_tokens >= 0),
    total_cost DECIMAL(10,4) DEFAULT 0 CHECK (total_cost >= 0),
    burn_rate JSONB DEFAULT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- 约束
    CONSTRAINT team_live_status_active_members_is_array CHECK (
        jsonb_typeof(active_members) = 'array'
    ),
    CONSTRAINT team_live_status_burn_rate_structure CHECK (
        burn_rate IS NULL OR (
            jsonb_typeof(burn_rate) = 'object' AND
            burn_rate ? 'tokens_per_minute' AND
            burn_rate ? 'cost_per_hour' AND
            burn_rate ? 'indicator'
        )
    )
);

-- 创建索引以提高查询性能
CREATE INDEX idx_teams_code ON teams(code);
CREATE INDEX idx_team_members_team_id ON team_members(team_id);
CREATE INDEX idx_team_members_user_id ON team_members(user_id);
CREATE INDEX idx_team_members_active ON team_members(team_id, is_active);
CREATE INDEX idx_usage_sessions_team_id ON usage_sessions(team_id);
CREATE INDEX idx_usage_sessions_user_id ON usage_sessions(user_id);
CREATE INDEX idx_usage_sessions_active ON usage_sessions(team_id, is_active);
CREATE INDEX idx_usage_sessions_time ON usage_sessions(start_time DESC);
CREATE INDEX idx_team_live_status_updated ON team_live_status(updated_at);

-- 创建更新时间戳的函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 为需要的表添加自动更新时间戳触发器
CREATE TRIGGER update_usage_sessions_updated_at 
    BEFORE UPDATE ON usage_sessions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_team_live_status_updated_at 
    BEFORE UPDATE ON team_live_status 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 行级安全策略 (RLS) 设置
-- 注意: 在实际部署时需要根据认证方案调整这些策略

-- 启用 RLS
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_live_status ENABLE ROW LEVEL SECURITY;

-- 基本的 RLS 策略（允许所有操作，实际部署时需要更严格的策略）
-- 这里先设置为宽松策略，便于开发测试

CREATE POLICY "Allow all operations on teams" ON teams
    FOR ALL USING (true);

CREATE POLICY "Allow all operations on team_members" ON team_members
    FOR ALL USING (true);

CREATE POLICY "Allow all operations on usage_sessions" ON usage_sessions
    FOR ALL USING (true);

CREATE POLICY "Allow all operations on team_live_status" ON team_live_status
    FOR ALL USING (true);

-- 创建一些实用的视图
-- 车队统计视图
CREATE VIEW team_stats AS
SELECT 
    t.id,
    t.name,
    t.code,
    t.created_at,
    COUNT(tm.id) as member_count,
    COUNT(CASE WHEN tm.is_active THEN 1 END) as active_member_count,
    COALESCE(SUM((us.token_counts->>'inputTokens')::int + 
                 (us.token_counts->>'outputTokens')::int +
                 (us.token_counts->>'cacheCreationInputTokens')::int +
                 (us.token_counts->>'cacheReadInputTokens')::int), 0) as total_tokens,
    COALESCE(SUM(us.cost_usd), 0) as total_cost
FROM teams t
LEFT JOIN team_members tm ON t.id = tm.team_id
LEFT JOIN usage_sessions us ON t.id = us.team_id 
    AND us.start_time >= CURRENT_DATE - INTERVAL '7 days' -- 最近7天的数据
GROUP BY t.id, t.name, t.code, t.created_at;

-- 成员活跃度视图
CREATE VIEW member_activity AS
SELECT 
    tm.team_id,
    tm.user_id,
    tm.user_name,
    tm.is_active,
    COUNT(us.id) as session_count,
    COALESCE(SUM((us.token_counts->>'inputTokens')::int + 
                 (us.token_counts->>'outputTokens')::int +
                 (us.token_counts->>'cacheCreationInputTokens')::int +
                 (us.token_counts->>'cacheReadInputTokens')::int), 0) as total_tokens,
    COALESCE(SUM(us.cost_usd), 0) as total_cost,
    MAX(us.updated_at) as last_activity
FROM team_members tm
LEFT JOIN usage_sessions us ON tm.team_id = us.team_id 
    AND tm.user_id = us.user_id
    AND us.start_time >= CURRENT_DATE - INTERVAL '24 hours' -- 最近24小时
GROUP BY tm.team_id, tm.user_id, tm.user_name, tm.is_active;

-- 插入一些示例数据（可选，用于测试）
-- 注意: 在生产环境中应该删除这些示例数据

/*
-- 示例车队
INSERT INTO teams (name, code) VALUES 
    ('开发团队', 'DEV001'),
    ('测试车队', 'TEST01');

-- 示例成员
INSERT INTO team_members (team_id, user_name, user_id, settings) VALUES 
    ((SELECT id FROM teams WHERE code = 'DEV001'), '张三', 'user001', '{"timezone": "Asia/Shanghai", "preferred_hours": [9,10,11,14,15,16]}'),
    ((SELECT id FROM teams WHERE code = 'DEV001'), '李四', 'user002', '{"timezone": "Asia/Shanghai", "preferred_hours": [13,14,15,16,17]}'),
    ((SELECT id FROM teams WHERE code = 'TEST01'), '王五', 'user003', '{"timezone": "Asia/Shanghai", "preferred_hours": [19,20,21,22]}');
*/

-- 数据库版本信息
CREATE TABLE IF NOT EXISTS schema_version (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    description TEXT
);

INSERT INTO schema_version (version, description) VALUES 
    ('1.0.0', 'Initial schema for Claude team carpooling feature')
ON CONFLICT (version) DO NOTHING;