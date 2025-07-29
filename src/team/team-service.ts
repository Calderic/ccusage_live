/**
 * @fileoverview 车队业务逻辑服务
 *
 * 提供车队管理的核心业务逻辑，包括创建车队、加入车队、
 * 成员管理、数据同步等功能。
 */

import { nanoid } from 'nanoid';
import { Result } from '@praha/byethrow';
import os from 'node:os';
import crypto from 'node:crypto';
import type {
	CreateTeamRequest,
	JoinTeamRequest,
	Team,
	TeamMember,
	TeamAggregatedStats,
	UsageSession,
} from './_team-types.ts';
import {
	createTeamRequestSchema,
	joinTeamRequestSchema,
	getMemberStatusIndicator,
	getPreferredTimeDescription,
} from './_team-types.ts';
import {
	getSupabaseClient,
	withRetry,
	formatSupabaseError,
} from './supabase-client.ts';
import type { SessionBlock } from '../_session-blocks.ts';
import { logger } from '../logger.ts';

/**
 * 生成用户ID（基于机器标识和用户名）
 */
function generateUserId(userName: string): string {
	const hostname = os.hostname();
	const platform = os.platform();
	const arch = os.arch();
	const machineId = crypto
		.createHash('sha256')
		.update(`${hostname}-${platform}-${arch}`)
		.digest('hex')
		.substring(0, 8);

	return `${machineId}-${userName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

/**
 * 生成6位车队邀请码
 */
function generateTeamCode(): string {
	// 使用数字和大写字母，避免容易混淆的字符
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	return nanoid(6).split('').map(char => chars[char.charCodeAt(0) % chars.length]).join('');
}

/**
 * 车队服务类
 */
export class TeamService {
	/**
	 * 创建新车队
	 */
	async createTeam(request: CreateTeamRequest): Promise<Result<{ team: Team; member: TeamMember; code: string }, string>> {
		// 验证请求数据
		const validationResult = createTeamRequestSchema.safeParse(request);
		if (!validationResult.success) {
			return Result.failure(`请求数据验证失败: ${validationResult.error.errors.map(e => e.message).join(', ')}`);
		}

		const clientResult = getSupabaseClient();
		if (Result.isFailure(clientResult)) {
			return Result.failure(clientResult.error);
		}

		const supabase = clientResult.data;
		const userId = generateUserId(request.user_name);
		const teamCode = generateTeamCode();

		return await withRetry(async () => {
			// 使用事务创建车队和初始成员
			const { data: team, error: teamError } = await supabase
				.from('teams')
				.insert({
					name: request.name,
					code: teamCode,
					settings: {},
				})
				.select()
				.single();

			if (teamError) {
				throw new Error(formatSupabaseError(teamError));
			}

			// 添加创建者为车队成员
			const { data: member, error: memberError } = await supabase
				.from('team_members')
				.insert({
					team_id: team.id,
					user_name: request.user_name,
					user_id: userId,
					is_active: true,
					settings: {
						timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					},
				})
				.select()
				.single();

			if (memberError) {
				// 如果添加成员失败，删除已创建的车队
				await supabase.from('teams').delete().eq('id', team.id);
				throw new Error(formatSupabaseError(memberError));
			}

			logger.info(`车队创建成功: ${team.name} (${team.code})`);
			return { team, member, code: teamCode };
		});
	}

	/**
	 * 加入车队
	 */
	async joinTeam(request: JoinTeamRequest): Promise<Result<{ team: Team; member: TeamMember }, string>> {
		// 验证请求数据
		const validationResult = joinTeamRequestSchema.safeParse(request);
		if (!validationResult.success) {
			return Result.failure(`请求数据验证失败: ${validationResult.error.errors.map(e => e.message).join(', ')}`);
		}

		const clientResult = getSupabaseClient();
		if (Result.isFailure(clientResult)) {
			return Result.failure(clientResult.error);
		}

		const supabase = clientResult.data;
		const userId = generateUserId(request.user_name);

		return await withRetry(async () => {
			// 查找车队
			const { data: team, error: teamError } = await supabase
				.from('teams')
				.select('*')
				.eq('code', request.code)
				.single();

			if (teamError) {
				if (teamError.code === 'PGRST116') {
					throw new Error('车队邀请码无效');
				}
				throw new Error(formatSupabaseError(teamError));
			}

			// 检查是否已经是成员
			const { data: existingMember } = await supabase
				.from('team_members')
				.select('*')
				.eq('team_id', team.id)
				.eq('user_id', userId)
				.single();

			if (existingMember) {
				return { team, member: existingMember };
			}

			// 添加为车队成员
			const { data: member, error: memberError } = await supabase
				.from('team_members')
				.insert({
					team_id: team.id,
					user_name: request.user_name,
					user_id: userId,
					is_active: true,
					settings: {
						timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					},
				})
				.select()
				.single();

			if (memberError) {
				throw new Error(formatSupabaseError(memberError));
			}

			logger.info(`加入车队成功: ${request.user_name} -> ${team.name}`);
			return { team, member };
		});
	}

	/**
	 * 获取用户的车队列表
	 */
	async getUserTeams(userName: string): Promise<Result<Array<{ team: Team; member: TeamMember }>, string>> {
		const clientResult = getSupabaseClient();
		if (Result.isFailure(clientResult)) {
			return Result.failure(clientResult.error);
		}

		const supabase = clientResult.data;
		const userId = generateUserId(userName);

		return await withRetry(async () => {
			const { data, error } = await supabase
				.from('team_members')
				.select(`
					*,
					teams (*)
				`)
				.eq('user_id', userId)
				.eq('is_active', true);

			if (error) {
				throw new Error(formatSupabaseError(error));
			}

			return data.map(item => ({
				team: item.teams as Team,
				member: item as TeamMember,
			}));
		});
	}

	/**
	 * 获取车队成员列表
	 */
	async getTeamMembers(teamId: string): Promise<Result<TeamMember[], string>> {
		const clientResult = getSupabaseClient();
		if (Result.isFailure(clientResult)) {
			return Result.failure(clientResult.error);
		}

		const supabase = clientResult.data;

		return await withRetry(async () => {
			const { data, error } = await supabase
				.from('team_members')
				.select('*')
				.eq('team_id', teamId)
				.eq('is_active', true)
				.order('joined_at', { ascending: true });

			if (error) {
				throw new Error(formatSupabaseError(error));
			}

			return data;
		});
	}

	/**
	 * 同步使用会话数据到车队
	 */
	async syncUsageSession(
		teamId: string,
		userId: string,
		sessionBlock: SessionBlock,
	): Promise<Result<UsageSession, string>> {
		const clientResult = getSupabaseClient();
		if (Result.isFailure(clientResult)) {
			return Result.failure(clientResult.error);
		}

		const supabase = clientResult.data;

		return await withRetry(async () => {
			const usageSession: Omit<UsageSession, 'id' | 'created_at' | 'updated_at'> = {
				team_id: teamId,
				user_id: userId,
				session_id: sessionBlock.id,
				start_time: sessionBlock.startTime.toISOString(),
				end_time: sessionBlock.endTime.toISOString(),
				is_active: sessionBlock.isActive,
				token_counts: sessionBlock.tokenCounts,
				cost_usd: sessionBlock.costUSD,
				models: sessionBlock.models,
			};

			// 使用 upsert 避免重复数据
			const { data, error } = await supabase
				.from('usage_sessions')
				.upsert(usageSession, {
					onConflict: 'team_id,user_id,session_id',
				})
				.select()
				.single();

			if (error) {
				throw new Error(formatSupabaseError(error));
			}

			return data;
		});
	}

	/**
	 * 获取车队聚合统计数据
	 */
	async getTeamStats(teamId: string): Promise<Result<TeamAggregatedStats, string>> {
		const clientResult = getSupabaseClient();
		if (Result.isFailure(clientResult)) {
			return Result.failure(clientResult.error);
		}

		const supabase = clientResult.data;

		return await withRetry(async () => {
			// 获取车队信息
			const { data: team, error: teamError } = await supabase
				.from('teams')
				.select('*')
				.eq('id', teamId)
				.single();

			if (teamError) {
				throw new Error(formatSupabaseError(teamError));
			}

			// 获取成员列表
			const { data: members, error: membersError } = await supabase
				.from('team_members')
				.select('*')
				.eq('team_id', teamId)
				.eq('is_active', true);

			if (membersError) {
				throw new Error(formatSupabaseError(membersError));
			}

			// 获取最近的使用会话
			const { data: sessions, error: sessionsError } = await supabase
				.from('usage_sessions')
				.select('*')
				.eq('team_id', teamId)
				.gte('start_time', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // 最近24小时
				.order('start_time', { ascending: false });

			if (sessionsError) {
				throw new Error(formatSupabaseError(sessionsError));
			}

			// 查找当前活跃会话
			const activeSession = sessions.find(s => s.is_active);
			let currentSession: SessionBlock | null = null;

			if (activeSession) {
				currentSession = {
					id: activeSession.session_id,
					startTime: new Date(activeSession.start_time),
					endTime: new Date(activeSession.end_time),
					actualEndTime: new Date(activeSession.end_time),
					isActive: activeSession.is_active,
					entries: [], // 实际应用中需要从本地加载
					tokenCounts: activeSession.token_counts,
					costUSD: activeSession.cost_usd,
					models: activeSession.models,
				};
			}

			// 计算成员统计
			const memberStats = members.map(member => {
				const memberSessions = sessions.filter(s => s.user_id === member.user_id);
				const totalTokens = memberSessions.reduce((sum, s) => 
					sum + s.token_counts.inputTokens + s.token_counts.outputTokens + 
					s.token_counts.cacheCreationInputTokens + s.token_counts.cacheReadInputTokens, 0);
				const totalCost = memberSessions.reduce((sum, s) => sum + s.cost_usd, 0);
				const isActive = memberSessions.some(s => s.is_active);
				const lastActivity = memberSessions.length > 0 
					? new Date(Math.max(...memberSessions.map(s => new Date(s.updated_at).getTime())))
					: undefined;

				return {
					user_id: member.user_id,
					user_name: member.user_name,
					is_active: isActive,
					current_tokens: totalTokens,
					current_cost: totalCost,
					last_activity: lastActivity,
					preferred_time: getPreferredTimeDescription(member.settings.preferred_hours),
					status_indicator: getMemberStatusIndicator(isActive, lastActivity),
				};
			});

			// 计算总计
			const totalTokens = sessions.reduce((sum, s) => 
				sum + s.token_counts.inputTokens + s.token_counts.outputTokens + 
				s.token_counts.cacheCreationInputTokens + s.token_counts.cacheReadInputTokens, 0);
			const totalCost = sessions.reduce((sum, s) => sum + s.cost_usd, 0);
			const activeMembersCount = memberStats.filter(m => m.is_active).length;

			// 计算燃烧率（基于活跃会话）
			let burnRate: TeamAggregatedStats['burn_rate'] = null;
			if (activeSession && currentSession) {
				const durationMinutes = (new Date().getTime() - new Date(activeSession.start_time).getTime()) / (1000 * 60);
				if (durationMinutes > 0) {
					const tokensPerMinute = totalTokens / durationMinutes;
					const costPerHour = (totalCost / durationMinutes) * 60;
					
					let indicator: 'HIGH' | 'MODERATE' | 'NORMAL' = 'NORMAL';
					if (tokensPerMinute > 1000) indicator = 'HIGH';
					else if (tokensPerMinute > 500) indicator = 'MODERATE';

					burnRate = {
						tokens_per_minute: tokensPerMinute,
						cost_per_hour: costPerHour,
						indicator,
					};
				}
			}

			// 生成智能建议
			const smartSuggestions: string[] = [];
			
			if (burnRate?.indicator === 'HIGH') {
				smartSuggestions.push('当前使用频率较高，建议适当控制');
			}
			
			if (activeMembersCount > 1) {
				smartSuggestions.push(`当前有${activeMembersCount}位成员同时使用，注意协调`);
			}
			
			const highUsageMembers = memberStats.filter(m => m.current_tokens > totalTokens * 0.4);
			if (highUsageMembers.length > 0) {
				smartSuggestions.push(`${highUsageMembers[0].user_name}使用量较高，建议适当控制`);
			}

			if (currentSession) {
				const remainingTime = (currentSession.endTime.getTime() - new Date().getTime()) / (1000 * 60);
				if (remainingTime < 60) {
					smartSuggestions.push(`预计${Math.round(remainingTime)}分钟后窗口结束，建议提前规划`);
				}
			}

			return {
				team,
				members,
				current_session: currentSession,
				member_stats: memberStats,
				total_tokens: totalTokens,
				total_cost: totalCost,
				active_members_count: activeMembersCount,
				burn_rate: burnRate,
				smart_suggestions: smartSuggestions,
			};
		});
	}

	/**
	 * 离开车队
	 */
	async leaveTeam(teamId: string, userName: string): Promise<Result<boolean, string>> {
		const clientResult = getSupabaseClient();
		if (Result.isFailure(clientResult)) {
			return Result.failure(clientResult.error);
		}

		const supabase = clientResult.data;
		const userId = generateUserId(userName);

		return await withRetry(async () => {
			const { error } = await supabase
				.from('team_members')
				.update({ is_active: false })
				.eq('team_id', teamId)
				.eq('user_id', userId);

			if (error) {
				throw new Error(formatSupabaseError(error));
			}

			logger.info(`用户 ${userName} 离开车队 ${teamId}`);
			return true;
		});
	}
}

/**
 * 车队服务单例
 */
export const teamService = new TeamService();

if (import.meta.vitest != null) {
	describe('车队服务', () => {
		let service: TeamService;

		beforeEach(() => {
			service = new TeamService();
		});

		it('应该生成有效的用户ID', () => {
			const userId1 = generateUserId('张三');
			const userId2 = generateUserId('张三');
			const userId3 = generateUserId('李四');

			expect(userId1).toBe(userId2); // 同一用户名应该生成相同ID
			expect(userId1).not.toBe(userId3); // 不同用户名应该生成不同ID
			expect(userId1).toMatch(/^[a-f0-9]{8}-[a-z0-9]+$/); // 格式检查
		});

		it('应该生成有效的车队邀请码', () => {
			const code1 = generateTeamCode();
			const code2 = generateTeamCode();

			expect(code1).toHaveLength(6);
			expect(code2).toHaveLength(6);
			expect(code1).not.toBe(code2); // 应该生成不同的码
			expect(code1).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/); // 只包含允许的字符
		});

		it('应该验证创建车队请求', async () => {
			const validRequest = {
				name: '测试车队',
				user_name: '测试用户',
			};

			const invalidRequest = {
				name: '',
				user_name: 'a'.repeat(50), // 超长用户名
			};

			expect(() => createTeamRequestSchema.parse(validRequest)).not.toThrow();
			expect(() => createTeamRequestSchema.parse(invalidRequest)).toThrow();
		});

		it('应该验证加入车队请求', async () => {
			const validRequest = {
				code: 'ABC123',
				user_name: '测试用户',
			};

			const invalidRequest = {
				code: 'INVALID', // 长度不对
				user_name: '',
			};

			expect(() => joinTeamRequestSchema.parse(validRequest)).not.toThrow();
			expect(() => joinTeamRequestSchema.parse(invalidRequest)).toThrow();
		});
	});
}