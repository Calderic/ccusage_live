/**
 * @fileoverview 车队相关类型定义
 *
 * 定义车队管理所需的所有数据类型和 Zod schemas，
 * 基于现有的 SessionBlock 和 LoadedUsageEntry 结构扩展。
 */

import type { SessionBlock } from '../_session-blocks.ts';
import { z } from 'zod';

/**
 * 车队基本信息
 */
export const teamSchema = z.object({
	id: z.string().uuid(),
	name: z.string().min(1, '车队名称不能为空').max(50, '车队名称不能超过50个字符'),
	code: z.string().length(6, '邀请码必须是6位字符'),
	created_at: z.string().datetime(),
	settings: z.record(z.unknown()).default({}),
});

export type Team = z.infer<typeof teamSchema>;

/**
 * 车队成员信息
 */
export const teamMemberSchema = z.object({
	id: z.string().uuid(),
	team_id: z.string().uuid(),
	user_name: z.string().min(1, '用户名不能为空').max(30, '用户名不能超过30个字符'),
	user_id: z.string().min(1, '用户ID不能为空'),
	joined_at: z.string().datetime(),
	is_active: z.boolean().default(true),
	settings: z.object({
		timezone: z.string().optional(),
		preferred_hours: z.array(z.number().min(0).max(23)).optional(), // 偏好使用时段 (0-23)
		peak_hours: z.array(z.number().min(0).max(23)).optional(), // 高峰使用时段 (0-23)
	}).default({}),
});

export type TeamMember = z.infer<typeof teamMemberSchema>;

/**
 * 使用会话数据（基于 SessionBlock）
 */
export const usageSessionSchema = z.object({
	id: z.string().uuid(),
	team_id: z.string().uuid(),
	user_id: z.string(),
	session_id: z.string(), // 对应 SessionBlock.id
	start_time: z.string().datetime(),
	end_time: z.string().datetime(),
	is_active: z.boolean().default(false),
	token_counts: z.object({
		inputTokens: z.number().min(0),
		outputTokens: z.number().min(0),
		cacheCreationInputTokens: z.number().min(0),
		cacheReadInputTokens: z.number().min(0),
	}),
	cost_usd: z.number().min(0),
	models: z.array(z.string()),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
});

export type UsageSession = z.infer<typeof usageSessionSchema>;

/**
 * 车队实时状态
 */
export const teamLiveStatusSchema = z.object({
	team_id: z.string().uuid(),
	active_session_id: z.string().nullable(),
	active_members: z.array(z.object({
		user_id: z.string(),
		user_name: z.string(),
		is_active: z.boolean(),
		current_tokens: z.number(),
		last_activity: z.string().datetime(),
	})),
	total_tokens: z.number().min(0),
	total_cost: z.number().min(0),
	burn_rate: z.object({
		tokens_per_minute: z.number().min(0),
		cost_per_hour: z.number().min(0),
		indicator: z.enum(['HIGH', 'MODERATE', 'NORMAL']),
	}).nullable(),
	updated_at: z.string().datetime(),
});

export type TeamLiveStatus = z.infer<typeof teamLiveStatusSchema>;

/**
 * 车队成员状态（用于实时显示）
 */
export type TeamMemberStatus = {
	user_id: string;
	user_name: string;
	is_active: boolean;
	current_tokens: number;
	current_cost: number;
	last_activity?: Date;
	preferred_time: string; // 描述偏好时段，如"上午"、"下午"、"晚上"
	status_indicator: '🟢' | '🟡' | '⚫'; // 活跃/空闲/离线
};

/**
 * 车队聚合统计
 */
export type TeamAggregatedStats = {
	team: Team;
	members: TeamMember[];
	current_session: SessionBlock | null;
	member_stats: TeamMemberStatus[];
	total_tokens: number;
	total_cost: number;
	active_members_count: number;
	burn_rate: {
		tokens_per_minute: number;
		cost_per_hour: number;
		indicator: 'HIGH' | 'MODERATE' | 'NORMAL';
	} | null;
	smart_suggestions: string[]; // 智能建议列表
};

/**
 * 创建车队请求
 */
export const createTeamRequestSchema = z.object({
	name: z.string().min(1, '车队名称不能为空').max(50, '车队名称不能超过50个字符'),
	user_name: z.string().min(1, '用户名不能为空').max(30, '用户名不能超过30个字符'),
});

export type CreateTeamRequest = z.infer<typeof createTeamRequestSchema>;

/**
 * 加入车队请求
 */
export const joinTeamRequestSchema = z.object({
	code: z.string().length(6, '邀请码必须是6位字符'),
	user_name: z.string().min(1, '用户名不能为空').max(30, '用户名不能超过30个字符'),
});

export type JoinTeamRequest = z.infer<typeof joinTeamRequestSchema>;

/**
 * 生成偏好时段描述
 */
export function getPreferredTimeDescription(hours?: number[]): string {
	if (!hours || hours.length === 0) {
		return '未设置';
	}

	const morningHours = hours.filter(h => h >= 6 && h < 12);
	const afternoonHours = hours.filter(h => h >= 12 && h < 18);
	const eveningHours = hours.filter(h => h >= 18 && h < 24);
	const nightHours = hours.filter(h => h >= 0 && h < 6);

	const periods = [];
	if (morningHours.length > 0) { periods.push('上午'); }
	if (afternoonHours.length > 0) { periods.push('下午'); }
	if (eveningHours.length > 0) { periods.push('晚上'); }
	if (nightHours.length > 0) { periods.push('深夜'); }

	if (periods.length === 0) { return '未设置'; }
	if (periods.length === 4) { return '全天使用'; }

	return `${periods.join('、')}使用偏好`;
}

/**
 * 获取成员状态指示器
 */
export function getMemberStatusIndicator(isActive: boolean, lastActivity?: Date): '🟢' | '🟡' | '⚫' {
	if (isActive) {
		return '🟢'; // 活跃
	}

	if (!lastActivity) {
		return '⚫'; // 离线
	}

	const now = new Date();
	const timeSinceActivity = now.getTime() - lastActivity.getTime();
	const hoursInactive = timeSinceActivity / (1000 * 60 * 60);

	if (hoursInactive < 1) {
		return '🟡'; // 空闲
	}

	return '⚫'; // 离线
}

/**
 * Supabase 数据库表映射
 */
export type Database = {
	public: {
		Tables: {
			teams: {
				Row: Team;
				Insert: Omit<Team, 'id' | 'created_at'>;
				Update: Partial<Omit<Team, 'id' | 'created_at'>>;
			};
			team_members: {
				Row: TeamMember;
				Insert: Omit<TeamMember, 'id' | 'joined_at'>;
				Update: Partial<Omit<TeamMember, 'id' | 'team_id' | 'user_id' | 'joined_at'>>;
			};
			usage_sessions: {
				Row: UsageSession;
				Insert: Omit<UsageSession, 'id' | 'created_at' | 'updated_at'>;
				Update: Partial<Omit<UsageSession, 'id' | 'team_id' | 'user_id' | 'session_id' | 'created_at'>>;
			};
			team_live_status: {
				Row: TeamLiveStatus;
				Insert: Omit<TeamLiveStatus, 'updated_at'>;
				Update: Partial<Omit<TeamLiveStatus, 'team_id'>>;
			};
		};
	};
};

if (import.meta.vitest != null) {
	describe('车队类型定义', () => {
		it('应该验证有效的车队数据', () => {
			const validTeam = {
				id: '123e4567-e89b-12d3-a456-426614174000',
				name: '开发车队',
				code: 'ABC123',
				created_at: '2024-01-01T10:00:00.000Z',
				settings: {},
			};

			expect(() => teamSchema.parse(validTeam)).not.toThrow();
		});

		it('应该验证有效的车队成员数据', () => {
			const validMember = {
				id: '123e4567-e89b-12d3-a456-426614174001',
				team_id: '123e4567-e89b-12d3-a456-426614174000',
				user_name: '张三',
				user_id: 'user_001',
				joined_at: '2024-01-01T10:00:00.000Z',
				is_active: true,
				settings: {
					timezone: 'Asia/Shanghai',
					preferred_hours: [9, 10, 11, 14, 15, 16],
					peak_hours: [10, 15],
				},
			};

			expect(() => teamMemberSchema.parse(validMember)).not.toThrow();
		});

		it('应该正确生成偏好时段描述', () => {
			expect(getPreferredTimeDescription([9, 10, 11])).toBe('上午使用偏好');
			expect(getPreferredTimeDescription([14, 15, 16])).toBe('下午使用偏好');
			expect(getPreferredTimeDescription([19, 20, 21])).toBe('晚上使用偏好');
			expect(getPreferredTimeDescription([9, 14, 19])).toBe('上午、下午、晚上使用偏好');
			expect(getPreferredTimeDescription([6, 12, 18, 0])).toBe('全天使用');
			expect(getPreferredTimeDescription([])).toBe('未设置');
		});

		it('应该正确生成成员状态指示器', () => {
			expect(getMemberStatusIndicator(true)).toBe('🟢');
			expect(getMemberStatusIndicator(false)).toBe('⚫');

			const recentActivity = new Date(Date.now() - 30 * 60 * 1000); // 30分钟前
			expect(getMemberStatusIndicator(false, recentActivity)).toBe('🟡');

			const oldActivity = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2小时前
			expect(getMemberStatusIndicator(false, oldActivity)).toBe('⚫');
		});
	});
}
