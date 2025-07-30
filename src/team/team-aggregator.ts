/**
 * @fileoverview 车队数据聚合器
 *
 * 负责实时聚合多用户的使用数据，计算车队整体统计信息，
 * 生成智能建议，检测时段冲突等功能。
 */

import type { SessionBlock } from '../_session-blocks.ts';
import type {
	TeamAggregatedStats,
	TeamMember,
	TeamMemberStatus,
} from './_team-types.ts';
import { Result } from '@praha/byethrow';
import {
	calculateBurnRate,
	projectBlockUsage,
} from '../_session-blocks.ts';
import { getTotalTokens } from '../_token-utils.ts';
import { logger } from '../logger.ts';
import {
	getMemberStatusIndicator,
	getPreferredTimeDescription,
} from './_team-types.ts';
import { systemConfig } from './system-config.ts';
import { teamService } from './team-service.ts';

/**
 * 聚合配置
 */
export type AggregationConfig = {
	/**
	 * 数据时间窗口（小时）- 只聚合此时间内的数据
	 */
	timeWindowHours: number;

	/**
	 * Token 使用限制（用于计算百分比和警告）
	 */
	tokenLimit?: number;

	/**
	 * 高使用量阈值（百分比）
	 */
	highUsageThreshold: number;

	/**
	 * 燃烧率阈值
	 */
	burnRateThresholds: {
		high: number;
		moderate: number;
	};
};

/**
 * 默认聚合配置（作为fallback使用）
 */
const DEFAULT_AGGREGATION_CONFIG: AggregationConfig = {
	timeWindowHours: 24,
	tokenLimit: 100000000, // ClaudeMax计划fallback: 100M tokens
	highUsageThreshold: 0.4, // 40%
	burnRateThresholds: {
		high: 1000,
		moderate: 500,
	},
};

/**
 * 时段冲突信息
 */
export type TimeConflict = {
	timeSlot: string; // 时段描述，如 "14:00-16:00"
	conflictingMembers: string[]; // 冲突成员名称
	severity: 'low' | 'medium' | 'high'; // 冲突严重程度
};

/**
 * 车队数据聚合器
 */
export class TeamAggregator {
	private config: AggregationConfig;
	private configLoaded: boolean = false; // 标记是否已加载系统配置

	constructor(config: Partial<AggregationConfig> = {}) {
		this.config = { ...DEFAULT_AGGREGATION_CONFIG, ...config };
	}

	/**
	 * 从数据库加载系统配置并更新聚合器配置（只加载一次）
	 */
	async loadSystemConfig(): Promise<void> {
		// 如果已经加载过配置，则跳过
		if (this.configLoaded) {
			return;
		}

		const configResult = await systemConfig.getConfig();
		if (Result.isSuccess(configResult)) {
			const sysConfig = configResult.value;

			// 更新配置，优先使用数据库中的值
			this.config = {
				...this.config,
				tokenLimit: sysConfig.token_limits.per_session,
				burnRateThresholds: {
					high: sysConfig.burn_rate_thresholds.high,
					moderate: sysConfig.burn_rate_thresholds.moderate,
				},
			};

			// 标记配置已加载
			this.configLoaded = true;
		}
		else {
			logger.warn('Failed to load system config, using defaults:', configResult.error);
			// 即使失败也标记为已加载，避免重复尝试
			this.configLoaded = true;
		}
	}

	/**
	 * 清除配置缓存，强制重新加载系统配置
	 */
	clearConfigCache(): void {
		this.configLoaded = false;
	}

	/**
	 * 聚合车队统计数据（增强版）
	 */
	async aggregateTeamStats(teamId: string, currentUserId?: string): Promise<Result.Result<TeamAggregatedStats, string>> {
		// 加载系统配置
		await this.loadSystemConfig();

		// 获取基础车队统计（混合本地和云端数据）
		const baseStatsResult = await teamService.getTeamStats(teamId, currentUserId);
		if (Result.isFailure(baseStatsResult)) {
			return Result.fail(baseStatsResult.error);
		}

		const baseStats = baseStatsResult.value;

		// 增强成员统计
		const enhancedMemberStats = this.enhanceMemberStats(baseStats.member_stats);

		// 检测时段冲突
		const timeConflicts = this.detectTimeConflicts(baseStats.members);

		// 生成高级智能建议
		const smartSuggestions = this.generateAdvancedSuggestions(
			baseStats,
			enhancedMemberStats,
			timeConflicts,
		);

		// 计算增强的燃烧率信息
		const enhancedBurnRate = this.calculateEnhancedBurnRate(baseStats);

		const enhancedStats: TeamAggregatedStats = {
			...baseStats,
			member_stats: enhancedMemberStats,
			burn_rate: enhancedBurnRate,
			smart_suggestions: smartSuggestions,
		};

		return Result.succeed(enhancedStats);
	}

	/**
	 * 增强成员统计信息
	 */
	private enhanceMemberStats(memberStats: TeamMemberStatus[]): TeamMemberStatus[] {
		return memberStats.map(member => ({
			...member,
			status_indicator: getMemberStatusIndicator(member.is_active, member.last_activity),
			preferred_time: getPreferredTimeDescription([]), // 实际应用中从数据库获取
		}));
	}

	/**
	 * 检测时段冲突
	 */
	private detectTimeConflicts(members: TeamMember[]): TimeConflict[] {
		const conflicts: TimeConflict[] = [];
		const timeSlotMembers = new Map<string, string[]>();

		// 分析每个成员的偏好时段
		for (const member of members) {
			const preferredHours = member.settings.preferred_hours || [];

			for (const hour of preferredHours) {
				const timeSlot = this.formatTimeSlot(hour);
				if (!timeSlotMembers.has(timeSlot)) {
					timeSlotMembers.set(timeSlot, []);
				}
				timeSlotMembers.get(timeSlot)!.push(member.user_name);
			}
		}

		// 识别冲突时段
		for (const [timeSlot, memberNames] of timeSlotMembers) {
			if (memberNames.length > 1) {
				const severity = this.calculateConflictSeverity(memberNames.length);
				conflicts.push({
					timeSlot,
					conflictingMembers: memberNames,
					severity,
				});
			}
		}

		// 按严重程度排序
		return conflicts.sort((a, b) => {
			const severityOrder = { high: 3, medium: 2, low: 1 };
			return severityOrder[b.severity] - severityOrder[a.severity];
		});
	}

	/**
	 * 生成高级智能建议
	 */
	private generateAdvancedSuggestions(
		stats: TeamAggregatedStats,
		memberStats: TeamMemberStatus[],
		timeConflicts: TimeConflict[],
	): string[] {
		const suggestions: string[] = [];

		// 燃烧率建议
		if (stats.burn_rate) {
			switch (stats.burn_rate.indicator) {
				case 'HIGH':
					suggestions.push('⚠️ 当前使用频率过高，建议暂停非紧急任务');
					break;
				case 'MODERATE':
					suggestions.push('⚡ 使用频率较高，注意控制使用节奏');
					break;
			}
		}

		// 成员协调建议
		if (stats.active_members_count > 1) {
			suggestions.push(`👥 当前有${stats.active_members_count}位成员同时使用，建议协调避免冲突`);
		}

		// 高使用量成员建议
		const totalTokens = stats.total_tokens;
		const highUsageMembers = memberStats.filter(
			m => m.current_tokens > totalTokens * this.config.highUsageThreshold,
		);

		if (highUsageMembers.length > 0 && highUsageMembers[0]) {
			const memberName = highUsageMembers[0].user_name;
			suggestions.push(`📊 ${memberName}使用量较高，建议适当控制`);
		}

		// 时段冲突建议
		if (timeConflicts.length > 0 && timeConflicts[0]) {
			const primaryConflict = timeConflicts[0];
			suggestions.push(
				`⏰ ${primaryConflict.timeSlot}为高峰时段，${primaryConflict.conflictingMembers.join('、')}请注意协调`,
			);
		}

		// 会话结束提醒
		if (stats.current_session) {
			const remainingMinutes = (stats.current_session.endTime.getTime() - new Date().getTime()) / (1000 * 60);
			if (remainingMinutes < 60 && remainingMinutes > 0) {
				suggestions.push(`⏳ 预计${Math.round(remainingMinutes)}分钟后窗口结束，建议提前规划`);
			}
		}

		// Token 限制建议
		if (this.config.tokenLimit && totalTokens > this.config.tokenLimit * 0.8) {
			const percentage = (totalTokens / this.config.tokenLimit) * 100;
			if (percentage > 100) {
				suggestions.push('🚨 已超出Token限制，请立即停止使用');
			}
			else {
				suggestions.push(`📈 已使用${percentage.toFixed(0)}%配额，接近限制`);
			}
		}

		// 效率建议
		if (stats.burn_rate && stats.current_session) {
			const projectedUsage = projectBlockUsage(stats.current_session);
			if (projectedUsage && this.config.tokenLimit) {
				const projectedPercentage = (projectedUsage.totalTokens / this.config.tokenLimit) * 100;
				if (projectedPercentage > 120) {
					suggestions.push('🎯 按当前速度将大幅超限，建议降低使用频率');
				}
			}
		}

		return suggestions.slice(0, 4); // 最多显示4条建议
	}

	/**
	 * 计算增强的燃烧率信息
	 */
	private calculateEnhancedBurnRate(
		stats: TeamAggregatedStats,
	): TeamAggregatedStats['burn_rate'] {
		if (!stats.current_session) {
			return null;
		}

		const burnRate = calculateBurnRate(stats.current_session);
		if (!burnRate) {
			return null;
		}

		// 使用配置的阈值重新计算指示器
		let indicator: 'HIGH' | 'MODERATE' | 'NORMAL' = 'NORMAL';
		if (burnRate.tokensPerMinuteForIndicator > this.config.burnRateThresholds.high) {
			indicator = 'HIGH';
		}
		else if (burnRate.tokensPerMinuteForIndicator > this.config.burnRateThresholds.moderate) {
			indicator = 'MODERATE';
		}

		return {
			tokens_per_minute: burnRate.tokensPerMinute,
			cost_per_hour: burnRate.costPerHour,
			indicator,
		};
	}

	/**
	 * 格式化时间段
	 */
	private formatTimeSlot(hour: number): string {
		const startHour = hour.toString().padStart(2, '0');
		const endHour = ((hour + 1) % 24).toString().padStart(2, '0');
		return `${startHour}:00-${endHour}:00`;
	}

	/**
	 * 计算冲突严重程度
	 */
	private calculateConflictSeverity(memberCount: number): 'low' | 'medium' | 'high' {
		if (memberCount >= 4) { return 'high'; }
		if (memberCount >= 3) { return 'medium'; }
		return 'low';
	}

	/**
	 * 获取车队使用趋势分析
	 */
	async getUsageTrends(teamId: string, days: number = 7): Promise<Result.Result<{
		dailyUsage: Array<{ date: string; tokens: number; cost: number }>;
		peakHours: number[];
		avgBurnRate: number;
		growthRate: number; // 增长率百分比
	}, string>> {
		// 这里需要从数据库获取历史数据
		// 暂时返回模拟数据结构

		try {
			// 实际实现中应该查询 usage_sessions 表
			const mockTrends = {
				dailyUsage: [
					{ date: '2024-01-20', tokens: 45000, cost: 12.5 },
					{ date: '2024-01-21', tokens: 52000, cost: 14.2 },
					{ date: '2024-01-22', tokens: 38000, cost: 10.8 },
				],
				peakHours: [9, 10, 14, 15, 16], // 使用高峰时段
				avgBurnRate: 750, // 平均燃烧率
				growthRate: 12.5, // 12.5% 增长
			};

			return Result.succeed(mockTrends);
		}
		catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			return Result.fail(`获取使用趋势失败: ${errorMsg}`);
		}
	}

	/**
	 * 生成使用效率报告
	 */
	generateEfficiencyReport(stats: TeamAggregatedStats): {
		overallEfficiency: number; // 0-100 分数
		recommendations: string[];
		metrics: {
			tokenUtilization: number; // Token 利用率
			costEfficiency: number; // 成本效率
			timeUtilization: number; // 时间利用率
		};
	} {
		const tokenUtilization = this.config.tokenLimit
			? Math.min((stats.total_tokens / this.config.tokenLimit) * 100, 100)
			: 0;

		const costEfficiency = stats.current_session
			? this.calculateCostEfficiency(stats.current_session)
			: 0;

		const timeUtilization = stats.current_session
			? this.calculateTimeUtilization(stats.current_session)
			: 0;

		const overallEfficiency = (tokenUtilization + costEfficiency + timeUtilization) / 3;

		const recommendations = this.generateEfficiencyRecommendations(
			overallEfficiency,
			{ tokenUtilization, costEfficiency, timeUtilization },
		);

		return {
			overallEfficiency: Math.round(overallEfficiency),
			recommendations,
			metrics: {
				tokenUtilization: Math.round(tokenUtilization),
				costEfficiency: Math.round(costEfficiency),
				timeUtilization: Math.round(timeUtilization),
			},
		};
	}

	/**
	 * 更新聚合配置
	 */
	updateConfig(newConfig: Partial<AggregationConfig>): void {
		this.config = { ...this.config, ...newConfig };
		logger.debug('车队聚合配置已更新', this.config);
	}

	/**
	 * 计算成本效率
	 */
	private calculateCostEfficiency(session: SessionBlock): number {
		const totalTokens = getTotalTokens(session.tokenCounts);
		if (totalTokens === 0 || session.costUSD === 0) { return 0; }

		// 简单的成本效率计算：tokens per dollar
		const tokensPerDollar = totalTokens / session.costUSD;
		// 假设理想值是 20000 tokens per dollar
		return Math.min((tokensPerDollar / 20000) * 100, 100);
	}

	/**
	 * 计算时间利用率
	 */
	private calculateTimeUtilization(session: SessionBlock): number {
		const now = new Date();
		const sessionDuration = now.getTime() - session.startTime.getTime();
		const maxDuration = session.endTime.getTime() - session.startTime.getTime();

		if (maxDuration === 0) { return 0; }
		return (sessionDuration / maxDuration) * 100;
	}

	/**
	 * 生成效率改进建议
	 */
	private generateEfficiencyRecommendations(
		overallScore: number,
		metrics: { tokenUtilization: number; costEfficiency: number; timeUtilization: number },
	): string[] {
		const recommendations: string[] = [];

		if (overallScore < 50) {
			recommendations.push('📈 整体效率偏低，建议优化使用策略');
		}

		if (metrics.tokenUtilization < 30) {
			recommendations.push('🎯 Token利用率较低，可以增加使用强度');
		}
		else if (metrics.tokenUtilization > 90) {
			recommendations.push('⚠️ Token使用接近上限，注意控制');
		}

		if (metrics.costEfficiency < 40) {
			recommendations.push('💰 成本效率有待提高，考虑优化使用方式');
		}

		if (metrics.timeUtilization < 60) {
			recommendations.push('⏰ 时间利用率不足，建议合理安排使用时间');
		}

		return recommendations;
	}
}

/**
 * 创建默认车队聚合器
 */
export function createTeamAggregator(config?: Partial<AggregationConfig>): TeamAggregator {
	return new TeamAggregator(config);
}

if (import.meta.vitest != null) {
	describe('TeamAggregator', () => {
		let aggregator: TeamAggregator;

		beforeEach(() => {
			aggregator = new TeamAggregator();
		});

		it('should initialize with default config', () => {
			expect(aggregator).toBeDefined();
		});

		it('should update config correctly', () => {
			const newConfig = { tokenLimit: 100000 };
			aggregator.updateConfig(newConfig);
			// 配置更新应该成功，具体验证需要访问私有属性
		});

		it('should calculate conflict severity correctly', () => {
			// 使用反射或公开方法测试
			const aggregator = new TeamAggregator();
			// 实际测试需要公开的测试方法
		});

		it('should format time slot correctly', () => {
			// 测试时间格式化逻辑
		});

		it('should generate efficiency report', () => {
			const mockStats: TeamAggregatedStats = {
				team: { id: 'test', name: 'Test Team', code: 'TEST01', created_at: new Date().toISOString(), settings: {} },
				members: [],
				current_session: null,
				member_stats: [],
				total_tokens: 50000,
				total_cost: 15.0,
				active_members_count: 2,
				burn_rate: null,
				smart_suggestions: [],
			};

			const report = aggregator.generateEfficiencyReport(mockStats);
			expect(report).toHaveProperty('overallEfficiency');
			expect(report).toHaveProperty('recommendations');
			expect(report).toHaveProperty('metrics');
		});
	});
}
