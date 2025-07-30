-- 添加系统配置表用于存储阈值和限制
-- 创建日期: 2025-07-29
-- 说明: 添加系统全局配置，包括token阈值、费用警告线等

-- 系统配置表
CREATE TABLE system_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_key TEXT UNIQUE NOT NULL,
    config_value JSONB NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- 约束
    CONSTRAINT system_config_key_not_empty CHECK (trim(config_key) != ''),
    CONSTRAINT system_config_value_not_null CHECK (config_value IS NOT NULL)
);

-- 创建索引
CREATE INDEX idx_system_config_key ON system_config(config_key);

-- 添加自动更新时间戳触发器
CREATE TRIGGER update_system_config_updated_at 
    BEFORE UPDATE ON system_config 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 启用 RLS
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- RLS 策略 - 允许所有操作（开发阶段）
CREATE POLICY "Allow all operations on system_config" ON system_config
    FOR ALL USING (true);

-- 插入默认配置
-- ClaudeMax计划：fallback为100M tokens，实际需要从LiteLLM价格表计算$40等值
INSERT INTO system_config (config_key, config_value, description) VALUES 
    ('token_limits', '{"per_session": 100000000, "daily": 500000000, "monthly": 15000000000}', 'Token限制配置（ClaudeMax计划）'),
    ('cost_warning_levels', '{"level1": 0.8, "level2": 0.9, "critical": 1.0}', '费用警告阈值（百分比）'),
    ('burn_rate_thresholds', '{"high": 1000, "moderate": 500, "normal": 100}', '燃烧率阈值（tokens/minute）'),
    ('notification_settings', '{"email_enabled": true, "slack_enabled": false}', '通知设置'),
    ('system_limits', '{"max_teams_per_user": 10, "max_members_per_team": 50}', '系统限制'),
    ('default_token_threshold', '{"tokens": 100000000, "usd_equivalent": 40.0, "pricing_method": "litellm_dynamic", "calculation_note": "ClaudeMax plan fallback, should calculate from LiteLLM pricing"}', '默认Token阈值（等价$40，动态计算）'),
    ('pricing_config', '{"use_litellm": true, "target_usd_amount": 40.0, "fallback_tokens": 100000000, "claude_max_plan": true}', '价格计算配置')
ON CONFLICT (config_key) DO NOTHING;

-- 创建获取配置的便利函数
CREATE OR REPLACE FUNCTION get_system_config(key_name TEXT)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT config_value INTO result
    FROM system_config
    WHERE config_key = key_name;
    
    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- 创建设置配置的便利函数
CREATE OR REPLACE FUNCTION set_system_config(key_name TEXT, value JSONB, description_text TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
    INSERT INTO system_config (config_key, config_value, description)
    VALUES (key_name, value, description_text)
    ON CONFLICT (config_key) 
    DO UPDATE SET 
        config_value = EXCLUDED.config_value,
        description = COALESCE(EXCLUDED.description, system_config.description),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- 更新 schema_version
INSERT INTO schema_version (version, description) VALUES 
    ('1.1.0', 'Added system_config table for thresholds and limits')
ON CONFLICT (version) DO NOTHING;