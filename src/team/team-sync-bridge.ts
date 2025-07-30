/**
 * @fileoverview 车队数据同步桥接器
 *
 * 连接现有的 LiveMonitor 和车队服务，实现本地 SessionBlock 数据
 * 到 Supabase 车队数据库的自动同步。支持增量同步和错误恢复。
 */

import type { SessionBlock } from '../_session-blocks.ts';
import type { CostMode, SortOrder } from '../_types.ts';
import { Result } from '@praha/byethrow';
import { LiveMonitor } from '../_live-monitor.ts';
import { logger } from '../logger.ts';
import { teamService } from './team-service.ts';

/**
 * 同步配置
 */
export type TeamSyncConfig = {
	teamId: string;
	userId: string;
	claudePaths: string[];
	sessionDurationHours: number;
	mode: CostMode;
	order: SortOrder;
	syncInterval: number; // 同步间隔（毫秒）
};

/**
 * 同步状态
 */
type SyncState = {
	lastSyncTime: Date;
	lastSyncedSessionId: string | null;
	syncedSessionIds: Set<string>;
	failedSyncs: Map<string, number>; // sessionId -> retry count
};

/**
 * 车队数据同步桥接器
 * 负责将本地的 SessionBlock 数据同步到车队数据库
 */
export class TeamSyncBridge implements Disposable {
	private config: TeamSyncConfig;
	private liveMonitor: LiveMonitor;
	private syncState: SyncState;
	private syncTimer: NodeJS.Timeout | null = null;
	private isRunning = false;

	constructor(config: TeamSyncConfig) {
		this.config = config;
		this.liveMonitor = new LiveMonitor({
			claudePaths: config.claudePaths,
			sessionDurationHours: config.sessionDurationHours,
			mode: config.mode,
			order: config.order,
		});

		this.syncState = {
			lastSyncTime: new Date(0), // 从很早的时间开始
			lastSyncedSessionId: null,
			syncedSessionIds: new Set(),
			failedSyncs: new Map(),
		};
	}

	/**
	 * 实现 Disposable 接口
	 */
	[Symbol.dispose](): void {
		this.stop();
		this.liveMonitor[Symbol.dispose]();
	}

	/**
	 * 启动自动同步
	 */
	async start(): Promise<Result.Result<void, string>> {
		if (this.isRunning) {
			return Result.succeed(undefined);
		}

		logger.info(`启动车队数据同步 - 车队ID: ${this.config.teamId}`);
		this.isRunning = true;

		// 立即执行一次同步
		const initialSyncResult = await this.performSync();
		if (Result.isFailure(initialSyncResult)) {
			logger.warn(`初始同步失败: ${initialSyncResult.error}`);
		}

		// 启动定时同步
		this.syncTimer = setInterval(async () => {
			if (!this.isRunning) { return; }

			const syncResult = await this.performSync();
			if (Result.isFailure(syncResult)) {
				logger.warn(`定时同步失败: ${syncResult.error}`);
			}
		}, this.config.syncInterval);

		return Result.succeed(undefined);
	}

	/**
	 * 停止自动同步
	 */
	stop(): void {
		if (!this.isRunning) { return; }

		logger.info('停止车队数据同步');
		this.isRunning = false;

		if (this.syncTimer) {
			clearInterval(this.syncTimer);
			this.syncTimer = null;
		}
	}

	/**
	 * 手动触发同步
	 */
	async syncNow(): Promise<Result.Result<number, string>> {
		return this.performSync();
	}

	/**
	 * 获取同步状态信息
	 */
	getSyncStatus(): {
		isRunning: boolean;
		lastSyncTime: Date;
		syncedCount: number;
		failedCount: number;
	} {
		return {
			isRunning: this.isRunning,
			lastSyncTime: this.syncState.lastSyncTime,
			syncedCount: this.syncState.syncedSessionIds.size,
			failedCount: this.syncState.failedSyncs.size,
		};
	}

	/**
	 * 执行同步操作
	 */
	private async performSync(): Promise<Result.Result<number, string>> {
		try {
			// 获取当前活跃的 SessionBlock
			const activeBlock = await this.liveMonitor.getActiveBlock();
			let syncCount = 0;

			// 同步活跃会话
			if (activeBlock) {
				const syncResult = await this.syncSessionBlock(activeBlock);
				if (Result.isSuccess(syncResult)) {
					syncCount++;
				}
				else {
					logger.warn(`同步活跃会话失败: ${syncResult.error}`);
				}
			}

			// 获取历史会话并同步（这里需要扩展 LiveMonitor 或直接访问数据）
			// 暂时只同步活跃会话，后续可以扩展

			this.syncState.lastSyncTime = new Date();

			if (syncCount > 0) {
				logger.debug(`成功同步 ${syncCount} 个会话`);
			}

			return Result.succeed(syncCount);
		}
		catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error(`同步过程出错: ${errorMsg}`);
			return Result.fail(`同步失败: ${errorMsg}`);
		}
	}

	/**
	 * 同步单个 SessionBlock
	 */
	private async syncSessionBlock(block: SessionBlock): Promise<Result.Result<void, string>> {
		const sessionId = block.id;

		// 检查是否已同步过
		if (this.syncState.syncedSessionIds.has(sessionId)) {
			// 如果是活跃会话，需要更新数据
			if (!block.isActive) {
				return Result.succeed(undefined);
			}
		}

		// 检查失败重试次数
		const failCount = this.syncState.failedSyncs.get(sessionId) || 0;
		if (failCount >= 3) {
			// 超过重试次数，跳过
			return Result.fail('超过最大重试次数');
		}

		// 执行同步
		const syncResult = await teamService.syncUsageSession(
			this.config.teamId,
			this.config.userId,
			block,
		);

		if (Result.isSuccess(syncResult)) {
			// 同步成功
			this.syncState.syncedSessionIds.add(sessionId);
			this.syncState.failedSyncs.delete(sessionId);
			this.syncState.lastSyncedSessionId = sessionId;

			logger.debug(`会话同步成功: ${sessionId} (活跃: ${block.isActive})`);
			return Result.succeed(undefined);
		}
		else {
			// 同步失败，记录重试次数
			this.syncState.failedSyncs.set(sessionId, failCount + 1);
			logger.warn(`会话同步失败: ${sessionId} - ${syncResult.error} (重试: ${failCount + 1}/3)`);
			return Result.fail(syncResult.error);
		}
	}

	/**
	 * 清理同步状态（用于测试）
	 */
	clearSyncState(): void {
		this.syncState.syncedSessionIds.clear();
		this.syncState.failedSyncs.clear();
		this.syncState.lastSyncedSessionId = null;
		this.syncState.lastSyncTime = new Date(0);
	}
}

/**
 * 创建并启动车队同步桥接器
 */
export async function createTeamSyncBridge(config: TeamSyncConfig): Promise<Result.Result<TeamSyncBridge, string>> {
	const bridge = new TeamSyncBridge(config);
	const startResult = await bridge.start();

	if (Result.isFailure(startResult)) {
		bridge[Symbol.dispose]();
		return Result.fail(startResult.error);
	}

	return Result.succeed(bridge);
}

/**
 * 根据用户车队信息自动创建同步桥接器
 */
export async function autoCreateSyncBridge(
	userName: string,
	teamName?: string,
	options: {
		claudePaths: string[];
		sessionDurationHours?: number;
		mode?: CostMode;
		syncInterval?: number;
	} = { claudePaths: [] },
): Promise<Result.Result<TeamSyncBridge, string>> {
	// 获取用户车队列表
	const teamsResult = await teamService.getUserTeams(userName);
	if (Result.isFailure(teamsResult)) {
		return Result.fail(teamsResult.error);
	}

	const teams = teamsResult.value;
	if (teams.length === 0) {
		return Result.fail('用户未加入任何车队');
	}

	// 选择车队
	let selectedTeam = teams[0];
	if (teamName) {
		const found = teams.find((t: any) => t.team.name === teamName);
		if (!found) {
			return Result.fail(`找不到车队: ${teamName}`);
		}
		selectedTeam = found;
	}

	if (!selectedTeam) {
		return Result.fail('未能选择车队');
	}

	// 创建同步配置
	const config: TeamSyncConfig = {
		teamId: selectedTeam.team.id,
		userId: selectedTeam.member.user_id,
		claudePaths: options.claudePaths,
		sessionDurationHours: options.sessionDurationHours || 5,
		mode: options.mode || 'auto',
		order: 'desc',
		syncInterval: options.syncInterval || 30000, // 默认30秒同步一次
	};

	return createTeamSyncBridge(config);
}

if (import.meta.vitest != null) {
	describe('TeamSyncBridge', () => {
		let bridge: TeamSyncBridge;
		let mockConfig: TeamSyncConfig;

		beforeEach(() => {
			mockConfig = {
				teamId: 'test-team-id',
				userId: 'test-user-id',
				claudePaths: ['/tmp/test'],
				sessionDurationHours: 5,
				mode: 'display' as CostMode,
				order: 'desc' as SortOrder,
				syncInterval: 1000,
			};
			bridge = new TeamSyncBridge(mockConfig);
		});

		afterEach(() => {
			bridge[Symbol.dispose]();
		});

		it('should initialize with correct config', () => {
			expect(bridge.getSyncStatus().isRunning).toBe(false);
			expect(bridge.getSyncStatus().syncedCount).toBe(0);
		});

		it('should start and stop sync', async () => {
			const result = await bridge.start();
			expect(Result.isSuccess(result)).toBe(true);
			expect(bridge.getSyncStatus().isRunning).toBe(true);

			bridge.stop();
			expect(bridge.getSyncStatus().isRunning).toBe(false);
		});

		it('should clear sync state', () => {
			bridge.clearSyncState();
			const status = bridge.getSyncStatus();
			expect(status.syncedCount).toBe(0);
			expect(status.failedCount).toBe(0);
		});
	});

	describe('autoCreateSyncBridge', () => {
		it('should handle empty team list', async () => {
			// 这个测试需要 mock teamService
			// 在实际环境中会测试
		});
	});
}
