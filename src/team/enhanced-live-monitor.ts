/**
 * @fileoverview 增强版车队实时监控
 *
 * 集成数据同步桥接器和聚合器，提供完整的车队实时监控功能，
 * 包括本地数据同步、智能建议生成、实时数据聚合等。
 */

import type { TeamAggregator } from './team-aggregator.ts';
import type { TeamSyncBridge } from './team-sync-bridge.ts';
import { Result } from '@praha/byethrow';
import pc from 'picocolors';
import { getClaudePaths } from '../data-loader.ts';
import { logger } from '../logger.ts';
import { startTeamLiveMonitoring } from './_team-live-rendering.ts';
import { testSupabaseConnection } from './supabase-client.ts';
import { systemConfig } from './system-config.ts';
import { createTeamAggregator } from './team-aggregator.ts';
import { teamService } from './team-service.ts';
import { autoCreateSyncBridge } from './team-sync-bridge.ts';

/**
 * 增强版实时监控配置
 */
export type EnhancedLiveMonitorConfig = {
	teamName?: string;
	userName: string;
	refreshInterval: number;
	enableSync: boolean; // 是否启用数据同步
	syncInterval: number; // 同步间隔（毫秒）
	tokenLimit?: number; // Token 限制
};

/**
 * 增强版车队实时监控管理器
 */
export class EnhancedTeamLiveMonitor implements Disposable {
	private config: EnhancedLiveMonitorConfig;
	private syncBridge: TeamSyncBridge | null = null;
	private aggregator: TeamAggregator;
	private isRunning = false;

	constructor(config: EnhancedLiveMonitorConfig) {
		this.config = config;
		this.aggregator = createTeamAggregator({
			tokenLimit: config.tokenLimit,
			timeWindowHours: 24,
		});
	}

	/**
	 * 实现 Disposable 接口
	 */
	[Symbol.dispose](): void {
		this.stop();
	}

	/**
	 * 启动增强版实时监控
	 */
	async start(): Promise<Result.Result<void, string>> {
		if (this.isRunning) {
			return Result.succeed(undefined);
		}

		console.log(pc.cyan('🚀 正在初始化增强版车队监控...'));

		// 1. 测试数据库连接
		const connectionResult = await testSupabaseConnection();
		if (Result.isFailure(connectionResult)) {
			return Result.fail(`数据库连接失败: ${connectionResult.error}`);
		}
		console.log(pc.green('✅ 数据库连接正常'));

		// 2. 获取用户车队信息
		const teamsResult = await teamService.getUserTeams(this.config.userName);
		if (Result.isFailure(teamsResult)) {
			return Result.fail(teamsResult.error);
		}

		const teams = teamsResult.value;
		if (teams.length === 0) {
			return Result.fail('用户未加入任何车队');
		}

		// 3. 选择车队
		let selectedTeam = teams[0];
		if (this.config.teamName) {
			const found = teams.find((t: any) => t.team.name === this.config.teamName);
			if (!found) {
				return Result.fail(`找不到车队: ${this.config.teamName}`);
			}
			selectedTeam = found;
		}

		if (!selectedTeam) {
			return Result.fail('未能选择车队');
		}

		console.log(pc.green(`✅ 选择车队: ${selectedTeam.team.name}`));

		// 4. 启动数据同步（如果启用）
		if (this.config.enableSync) {
			console.log(pc.cyan('🔄 启动数据同步...'));

			const claudePaths = getClaudePaths();
			if (claudePaths.length === 0) {
				console.log(pc.yellow('⚠️  未找到 Claude 数据目录，同步功能将受限'));
			}
			else {
				const syncResult = await autoCreateSyncBridge(
					this.config.userName,
					selectedTeam.team.name,
					{
						claudePaths,
						syncInterval: this.config.syncInterval,
					},
				);

				if (Result.isSuccess(syncResult)) {
					this.syncBridge = syncResult.value;
					console.log(pc.green('✅ 数据同步已启动'));
				}
				else {
					console.log(pc.yellow(`⚠️  同步启动失败: ${syncResult.error}`));
					console.log(pc.gray('将仅显示数据库中的历史数据'));
				}
			}
		}

		// 5. 启动实时监控界面
		this.isRunning = true;
		console.log(pc.green(`🚗 开始监控车队: ${selectedTeam.team.name}`));
		console.log(pc.gray('按 Ctrl+C 退出监控'));
		console.log('');

		// 使用增强的实时监控
		await this.startEnhancedLiveMonitoring({
			teamId: selectedTeam.team.id,
			teamName: selectedTeam.team.name,
			refreshInterval: this.config.refreshInterval,
			currentUserId: selectedTeam.member.user_id, // 传入当前用户ID
		});

		return Result.succeed(undefined);
	}

	/**
	 * 停止监控
	 */
	stop(): void {
		if (!this.isRunning) { return; }

		this.isRunning = false;

		if (this.syncBridge) {
			this.syncBridge[Symbol.dispose]();
			this.syncBridge = null;
		}

		logger.info('增强版车队监控已停止');
	}

	/**
	 * 获取监控状态
	 */
	getStatus(): {
		isRunning: boolean;
		syncEnabled: boolean;
		syncStatus?: {
			isRunning: boolean;
			lastSyncTime: Date;
			syncedCount: number;
			failedCount: number;
		};
	} {
		return {
			isRunning: this.isRunning,
			syncEnabled: this.config.enableSync,
			syncStatus: this.syncBridge?.getSyncStatus(),
		};
	}

	/**
	 * 启动增强的实时监控界面
	 */
	private async startEnhancedLiveMonitoring(config: {
		teamId: string;
		teamName: string;
		refreshInterval: number;
		currentUserId: string;
	}): Promise<void> {
		// 使用现有的实时监控，但数据来源已经通过同步增强
		await startTeamLiveMonitoring(config);
	}
}

/**
 * 启动增强版车队实时监控的便捷函数
 */
export async function startEnhancedTeamLiveMonitor(
	config: EnhancedLiveMonitorConfig,
): Promise<Result.Result<void, string>> {
	using monitor = new EnhancedTeamLiveMonitor(config);
	return await monitor.start();
}

/**
 * 显示监控状态信息
 */
export function displayMonitorStatus(monitor: EnhancedTeamLiveMonitor): void {
	const status = monitor.getStatus();

	console.log(pc.bold('📊 监控状态'));
	console.log(`运行状态: ${status.isRunning ? pc.green('运行中') : pc.gray('已停止')}`);
	console.log(`数据同步: ${status.syncEnabled ? pc.green('已启用') : pc.gray('已禁用')}`);

	if (status.syncStatus) {
		const sync = status.syncStatus;
		console.log(`同步状态: ${sync.isRunning ? pc.green('运行中') : pc.gray('已停止')}`);
		console.log(`最后同步: ${sync.lastSyncTime.toLocaleString('zh-CN')}`);
		console.log(`已同步: ${sync.syncedCount} 个会话`);
		if (sync.failedCount > 0) {
			console.log(`同步失败: ${pc.yellow(sync.failedCount.toString())} 个会话`);
		}
	}
}

/**
 * 创建推荐的监控配置
 */
export async function createRecommendedConfig(
	userName: string,
	teamName?: string,
): Promise<EnhancedLiveMonitorConfig> {
	// 尝试从数据库获取token限制，失败时使用默认值
	const tokenLimitResult = await systemConfig.getTokenLimit();
	if (Result.isFailure(tokenLimitResult)) {
		logger.warn('Failed to get token limit from system config:', tokenLimitResult.error);
	}
	const tokenLimit = Result.isSuccess(tokenLimitResult) ? tokenLimitResult.value : 100000000; // ClaudeMax fallback

	return {
		teamName,
		userName,
		refreshInterval: 5000, // 5秒刷新
		enableSync: true, // 启用同步
		syncInterval: 30000, // 30秒同步一次
		tokenLimit, // 从数据库获取的token限制，等价$40
	};
}

/**
 * 验证监控配置
 */
export function validateMonitorConfig(
	config: EnhancedLiveMonitorConfig,
): Result.Result<void, string> {
	if (!config.userName.trim()) {
		return Result.fail('用户名不能为空');
	}

	if (config.refreshInterval < 1000) {
		return Result.fail('刷新间隔不能小于1秒');
	}

	if (config.syncInterval < 5000) {
		return Result.fail('同步间隔不能小于5秒');
	}

	if (config.tokenLimit && config.tokenLimit <= 0) {
		return Result.fail('Token限制必须大于0');
	}

	return Result.succeed(undefined);
}

if (import.meta.vitest != null) {
	describe('EnhancedTeamLiveMonitor', () => {
		let monitor: EnhancedTeamLiveMonitor;
		let config: EnhancedLiveMonitorConfig;

		beforeEach(() => {
			config = {
				userName: 'test-user',
				refreshInterval: 5000,
				enableSync: true,
				syncInterval: 10000,
				tokenLimit: 100000,
			};
			monitor = new EnhancedTeamLiveMonitor(config);
		});

		afterEach(() => {
			monitor[Symbol.dispose]();
		});

		it('should initialize with correct config', () => {
			expect(monitor.getStatus().isRunning).toBe(false);
			expect(monitor.getStatus().syncEnabled).toBe(true);
		});

		it('should validate config correctly', () => {
			const validConfig = createRecommendedConfig('test-user');
			const result = validateMonitorConfig(validConfig);
			expect(Result.isSuccess(result)).toBe(true);
		});

		it('should reject invalid config', () => {
			const invalidConfig = { ...config, refreshInterval: 500 };
			const result = validateMonitorConfig(invalidConfig);
			expect(Result.isFailure(result)).toBe(true);
		});

		it('should create recommended config', () => {
			const config = createRecommendedConfig('test-user', 'test-team');
			expect(config.userName).toBe('test-user');
			expect(config.teamName).toBe('test-team');
			expect(config.enableSync).toBe(true);
		});
	});
}
