/**
 * @fileoverview 预配置的服务器设置
 * 
 * 这个文件包含了预配置的Supabase服务器连接信息，
 * 让用户可以直接使用而不需要设置环境变量。
 */

export type DefaultConfig = {
	supabase: {
		url: string;
		anonKey: string;
	};
	features: {
		teamMode: boolean;
		webInterface: boolean;
		mcpServer: boolean;
	};
};

/**
 * 预配置的服务器设置
 * 注意：这些是公开的配置，不包含敏感信息
 */
export const DEFAULT_CONFIG: DefaultConfig = {
	supabase: {
		// 替换为你的Supabase项目URL和匿名密钥
		url: 'https://yntuxhlltxjliudmeegt.supabase.co',
		anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InludHV4aGxsdHhqbGl1ZG1lZWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM3NzI2NzQsImV4cCI6MjA2OTM0ODY3NH0.Fmy8Mt5esvv-S8-yga8Pi88IoQCO3L3xJlJ8wzeRZqs',
	},
	features: {
		teamMode: true,
		webInterface: true,
		mcpServer: true,
	},
};

/**
 * 获取配置，优先使用环境变量，fallback到默认配置
 */
export function getConfig(): DefaultConfig {
	return {
		supabase: {
			url: process.env.SUPABASE_URL || DEFAULT_CONFIG.supabase.url,
			anonKey: process.env.SUPABASE_ANON_KEY || DEFAULT_CONFIG.supabase.anonKey,
		},
		features: {
			teamMode: process.env.CCUSAGE_TEAM_MODE !== 'false',
			webInterface: process.env.CCUSAGE_WEB_INTERFACE !== 'false',
			mcpServer: process.env.CCUSAGE_MCP_SERVER !== 'false',
		},
	};
}

/**
 * 验证配置是否有效
 */
export function validateConfig(config: DefaultConfig): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	if (!config.supabase.url || config.supabase.url === 'https://your-project-id.supabase.co') {
		errors.push('Supabase URL not configured properly');
	}

	if (!config.supabase.anonKey || config.supabase.anonKey === 'your-anon-key-here') {
		errors.push('Supabase anonymous key not configured properly');
	}

	if (!config.supabase.url.startsWith('https://')) {
		errors.push('Supabase URL must start with https://');
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}