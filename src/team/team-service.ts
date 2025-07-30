/**
 * @fileoverview 车队业务逻辑服务
 *
 * 提供车队管理的核心业务逻辑，包括创建车队、加入车队、
 * 成员管理、数据同步等功能。
 */

import type { SessionBlock } from '../_session-blocks.ts';
import type {
	CreateTeamRequest,
	JoinTeamRequest,
	Team,
	TeamAggregatedStats,
	TeamMember,
	UsageSession,
} from './_team-types.ts';
import crypto from 'node:crypto';
import os from 'node:os';
import { Result } from '@praha/byethrow';
import { nanoid } from 'nanoid';
import { getTotalTokens } from '../_token-utils.ts';
import { UnifiedSessionSelector } from '../_unified-session-selector.ts';
import { logger } from '../logger.ts';
import {
	createTeamRequestSchema,
	getMemberStatusIndicator,
	getPreferredTimeDescription,
	joinTeamRequestSchema,
} from './_team-types.ts';
import {
	formatSupabaseError,
	getSupabaseClient,
	withRetry,
} from './supabase-client.ts';

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

	const normalizedName = userName.toLowerCase()
		.replace(/\s+/g, '') // Remove spaces
		.replace(/\W/g, '') // Remove non-word characters but keep Chinese
		|| crypto.createHash('sha256').update(userName).digest('hex').substring(0, 8);

	return `${machineId}-${normalizedName}`;
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
 * 缓存条目
 */
type CacheEntry<T> = {
	data: T;
	timestamp: number;
	expiresAt: number;
};

/**
 * 车队服务类
 */
export class TeamService {
	private sessionSelector: UnifiedSessionSelector;
	// 缓存存储
	private teamInfoCache = new Map<string, CacheEntry<{ team: any; members: any[] }>>();
	private teammateSessionsCache = new Map<string, CacheEntry<any[]>>();

	// 缓存配置（毫秒）
	private readonly TEAM_INFO_CACHE_TTL = 5 * 60 * 1000; // 5分钟
	private readonly TEAMMATE_DATA_CACHE_TTL = 30 * 1000; // 30秒

	constructor() {
		// 初始化统一会话选择器，确保与原版使用相同的逻辑
		this.sessionSelector = new UnifiedSessionSelector();
	}

	/**
	 * 检查缓存是否有效
	 */
	private isCacheValid<T>(entry: CacheEntry<T> | undefined): boolean {
		if (!entry) { return false; }
		return Date.now() < entry.expiresAt;
	}

	/**
	 * 创建缓存条目
	 */
	private createCacheEntry<T>(data: T, ttl: number): CacheEntry<T> {
		const now = Date.now();
		return {
			data,
			timestamp: now,
			expiresAt: now + ttl,
		};
	}

	/**
	 * 清理过期缓存
	 */
	private cleanupExpiredCache(): void {
		const now = Date.now();

		// 清理团队信息缓存
		for (const [key, entry] of this.teamInfoCache.entries()) {
			if (now >= entry.expiresAt) {
				this.teamInfoCache.delete(key);
			}
		}

		// 清理队友会话缓存
		for (const [key, entry] of this.teammateSessionsCache.entries()) {
			if (now >= entry.expiresAt) {
				this.teammateSessionsCache.delete(key);
			}
		}
	}

	/**
	 * 创建新车队
	 */
	async createTeam(request: CreateTeamRequest): Promise<Result.Result<{ team: Team; member: TeamMember; code: string }, string>> {
		// 验证请求数据
		const validationResult = createTeamRequestSchema.safeParse(request);
		if (!validationResult.success) {
			return Result.fail(`请求数据验证失败: ${validationResult.error.errors.map((e: any) => e.message).join(', ')}`);
		}

		const clientResult = getSupabaseClient();
		if (Result.isFailure(clientResult)) {
			return Result.fail(clientResult.error);
		}

		const supabase = clientResult.value;
		const userId = generateUserId(request.user_name);
		const teamCode = generateTeamCode();

		return withRetry(async () => {
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
	async joinTeam(request: JoinTeamRequest): Promise<Result.Result<{ team: Team; member: TeamMember }, string>> {
		// 验证请求数据
		const validationResult = joinTeamRequestSchema.safeParse(request);
		if (!validationResult.success) {
			return Result.fail(`请求数据验证失败: ${validationResult.error.errors.map((e: any) => e.message).join(', ')}`);
		}

		const clientResult = getSupabaseClient();
		if (Result.isFailure(clientResult)) {
			return Result.fail(clientResult.error);
		}

		const supabase = clientResult.value;
		const userId = generateUserId(request.user_name);

		return withRetry(async () => {
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
	async getUserTeams(userName: string): Promise<Result.Result<Array<{ team: Team; member: TeamMember }>, string>> {
		const clientResult = getSupabaseClient();
		if (Result.isFailure(clientResult)) {
			return Result.fail(clientResult.error);
		}

		const supabase = clientResult.value;
		const userId = generateUserId(userName);

		return withRetry(async () => {
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

			return data.map((item: any) => ({
				team: item.teams as Team,
				member: item as TeamMember,
			}));
		});
	}

	/**
	 * 获取车队成员列表
	 */
	async getTeamMembers(teamId: string): Promise<Result.Result<TeamMember[], string>> {
		const clientResult = getSupabaseClient();
		if (Result.isFailure(clientResult)) {
			return Result.fail(clientResult.error);
		}

		const supabase = clientResult.value;

		return withRetry(async () => {
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
	): Promise<Result.Result<UsageSession, string>> {
		const clientResult = getSupabaseClient();
		if (Result.isFailure(clientResult)) {
			return Result.fail(clientResult.error);
		}

		const supabase = clientResult.value;

		return withRetry(async () => {
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
	 * 获取车队聚合统计数据（使用分层缓存优化）
	 */
	async getTeamStats(teamId: string, currentUserId?: string): Promise<Result.Result<TeamAggregatedStats, string>> {
		// 清理过期缓存
		this.cleanupExpiredCache();

		const clientResult = getSupabaseClient();
		if (Result.isFailure(clientResult)) {
			return Result.fail(clientResult.error);
		}

		const supabase = clientResult.value;

		return withRetry(async () => {
			// 1. 获取团队基础信息（5分钟缓存）
			const teamInfoCacheKey = `team-${teamId}`;
			const teamInfoCache = this.teamInfoCache.get(teamInfoCacheKey);

			let team: any, members: any[];
			if (this.isCacheValid(teamInfoCache)) {
				// 使用缓存数据
				({ team, members } = teamInfoCache!.data);
				logger.debug(`使用团队信息缓存: ${teamId}`);
			}
			else {
				// 从数据库获取
				const { data: teamData, error: teamError } = await supabase
					.from('teams')
					.select('*')
					.eq('id', teamId)
					.single();

				if (teamError) {
					throw new Error(formatSupabaseError(teamError));
				}

				const { data: membersData, error: membersError } = await supabase
					.from('team_members')
					.select('*')
					.eq('team_id', teamId)
					.eq('is_active', true);

				if (membersError) {
					throw new Error(formatSupabaseError(membersError));
				}

				team = teamData;
				members = membersData;

				// 更新缓存
				this.teamInfoCache.set(teamInfoCacheKey, this.createCacheEntry(
					{ team, members },
					this.TEAM_INFO_CACHE_TTL,
				));
				logger.debug(`更新团队信息缓存: ${teamId}`);
			}

			// 2. 当前会话完全基于本地数据计算（无缓存，实时数据）
			const currentSession = await this.sessionSelector.getCurrentSession(currentUserId, true);

			// 3. 获取队友会话数据（30秒缓存，匹配上传频率）
			const teammatesCacheKey = `teammates-${teamId}-${currentUserId || 'none'}`;
			const teammatesCache = this.teammateSessionsCache.get(teammatesCacheKey);

			let teammatesSessions: any[];
			if (this.isCacheValid(teammatesCache)) {
				// 使用缓存数据
				teammatesSessions = teammatesCache!.data;
				logger.debug(`使用队友数据缓存: ${teamId}`);
			}
			else {
				// 从数据库获取
				const { data: sessionsData, error: sessionsError } = await supabase
					.from('usage_sessions')
					.select('*')
					.eq('team_id', teamId)
					.neq('user_id', currentUserId || 'none') // 排除当前用户
					.order('start_time', { ascending: false });

				if (sessionsError) {
					throw new Error(formatSupabaseError(sessionsError));
				}

				teammatesSessions = sessionsData;

				// 更新缓存
				this.teammateSessionsCache.set(teammatesCacheKey, this.createCacheEntry(
					teammatesSessions,
					this.TEAMMATE_DATA_CACHE_TTL,
				));
				logger.debug(`更新队友数据缓存: ${teamId}`);
			}

			// 4. 计算个人和队友统计数据（混合本地和缓存数据）
			const memberStats = members.map((member: any) => {
				if (member.user_id === currentUserId) {
					// 当前用户：使用本地实时数据
					const personalStats = currentSession
						? {
								current_tokens: getTotalTokens(currentSession.tokenCounts),
								current_cost: currentSession.costUSD,
								is_active: currentSession.isActive,
								last_activity: currentSession.actualEndTime || currentSession.startTime,
							}
						: {
								current_tokens: 0,
								current_cost: 0,
								is_active: false,
								last_activity: undefined,
							};

					return {
						user_id: member.user_id,
						user_name: member.user_name,
						is_active: personalStats.is_active,
						current_tokens: personalStats.current_tokens,
						current_cost: personalStats.current_cost,
						last_activity: personalStats.last_activity,
						preferred_time: getPreferredTimeDescription(member.settings.preferred_hours),
						status_indicator: getMemberStatusIndicator(personalStats.is_active, personalStats.last_activity),
					};
				}
				else {
					// 队友：使用缓存的数据库同步数据
					const memberSessions = teammatesSessions.filter((s: any) => s.user_id === member.user_id);
					const totalTokens = memberSessions.reduce((sum: number, s: any) =>
						sum + (s.token_counts.inputTokens || 0) + (s.token_counts.outputTokens || 0)
						+ (s.token_counts.cacheCreationInputTokens || 0) + (s.token_counts.cacheReadInputTokens || 0), 0);
					const totalCost = memberSessions.reduce((sum: number, s: any) => sum + (s.cost_usd || 0), 0);
					const isActive = memberSessions.some((s: any) => s.is_active);
					const lastActivity = memberSessions.length > 0
						? new Date(Math.max(...memberSessions.map((s: any) => new Date(s.updated_at || s.start_time).getTime())))
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
				}
			});

			// 5. 计算总计（混合本地和缓存数据）
			const totalTokens = memberStats.reduce((sum: number, m: any) => sum + m.current_tokens, 0);
			const totalCost = memberStats.reduce((sum: number, m: any) => sum + m.current_cost, 0);
			const activeMembersCount = memberStats.filter((m: any) => m.is_active).length;

			// 6. 计算燃烧率（基于当前会话）
			let burnRate: TeamAggregatedStats['burn_rate'] = null;
			if (currentSession && currentSession.isActive) {
				const durationMinutes = (new Date().getTime() - currentSession.startTime.getTime()) / (1000 * 60);
				if (durationMinutes > 0) {
					const tokensPerMinute = totalTokens / durationMinutes;
					const costPerHour = (totalCost / durationMinutes) * 60;

					let indicator: 'HIGH' | 'MODERATE' | 'NORMAL' = 'NORMAL';
					if (tokensPerMinute > 1000) { indicator = 'HIGH'; }
					else if (tokensPerMinute > 500) { indicator = 'MODERATE'; }

					burnRate = {
						tokens_per_minute: tokensPerMinute,
						cost_per_hour: costPerHour,
						indicator,
					};
				}
			}

			// 7. 生成智能建议（基于混合数据）
			const smartSuggestions: string[] = [];

			if (burnRate?.indicator === 'HIGH') {
				smartSuggestions.push('当前使用频率较高，建议适当控制');
			}

			if (activeMembersCount > 1) {
				smartSuggestions.push(`当前有${activeMembersCount}位成员同时使用，注意协调`);
			}

			const highUsageMembers = memberStats.filter((m: any) => m.current_tokens > totalTokens * 0.4);
			if (highUsageMembers.length > 0 && highUsageMembers[0]) {
				smartSuggestions.push(`${highUsageMembers[0].user_name}使用量较高，建议适当控制`);
			}

			if (currentSession && currentSession.isActive) {
				const remainingTime = (currentSession.endTime.getTime() - new Date().getTime()) / (1000 * 60);
				if (remainingTime < 60 && remainingTime > 0) {
					smartSuggestions.push(`预计${Math.round(remainingTime)}分钟后窗口结束，建议提前规划`);
				}
			}

			return {
				team,
				members,
				current_session: currentSession, // 基于本地数据的实时会话
				member_stats: memberStats, // 本地实时+队友缓存混合数据
				total_tokens: totalTokens,
				total_cost: totalCost,
				active_members_count: activeMembersCount,
				burn_rate: burnRate,
				smart_suggestions: smartSuggestions,
			};
		});
	}

	/**
	 * 手动清除指定团队的缓存
	 */
	clearTeamCache(teamId: string, currentUserId?: string): void {
		const teamInfoCacheKey = `team-${teamId}`;
		const teammatesCacheKey = `teammates-${teamId}-${currentUserId || 'none'}`;

		this.teamInfoCache.delete(teamInfoCacheKey);
		this.teammateSessionsCache.delete(teammatesCacheKey);

		logger.debug(`清除团队缓存: ${teamId}`);
	}

	/**
	 * 获取缓存统计信息
	 */
	getCacheStats(): {
		teamInfoCache: { size: number; entries: Array<{ key: string; expiresAt: Date }> };
		teammateSessionsCache: { size: number; entries: Array<{ key: string; expiresAt: Date }> };
	} {
		return {
			teamInfoCache: {
				size: this.teamInfoCache.size,
				entries: Array.from(this.teamInfoCache.entries()).map(([key, entry]) => ({
					key,
					expiresAt: new Date(entry.expiresAt),
				})),
			},
			teammateSessionsCache: {
				size: this.teammateSessionsCache.size,
				entries: Array.from(this.teammateSessionsCache.entries()).map(([key, entry]) => ({
					key,
					expiresAt: new Date(entry.expiresAt),
				})),
			},
		};
	}

	/**
	 * 离开车队
	 */
	async leaveTeam(teamId: string, userName: string): Promise<Result.Result<boolean, string>> {
		const clientResult = getSupabaseClient();
		if (Result.isFailure(clientResult)) {
			return Result.fail(clientResult.error);
		}

		const supabase = clientResult.value;
		const userId = generateUserId(userName);

		return withRetry(async () => {
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
		beforeEach(() => {
			// Test setup
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
			expect(code1).toMatch(/^[A-HJ-NP-Z2-9]+$/); // 只包含允许的字符
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
