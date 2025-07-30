/**
 * @fileoverview 统一会话选择器
 *
 * 解决拼车实时监控窗口期不稳定问题的核心模块。
 * 提供一致的会话选择逻辑，确保原版和拼车版使用相同的算法。
 *
 * 设计原则：
 * - 完全基于本地JSONL文件计算当前会话
 * - Supabase仅用于数据同步，不影响会话选择
 * - 实现缓存机制避免频繁重复计算
 * - 使用分级选择策略确保稳定性
 */

import type { SessionBlock } from './_session-blocks.ts';
import type { CostMode, SortOrder } from './_types.ts';
import { Result } from '@praha/byethrow';
import { getClaudePaths, loadSessionBlockData } from './data-loader.ts';
import { logger } from './logger.ts';

/**
 * 会话选择器配置
 */
export type SessionSelectorConfig = {
	claudePaths?: string[];
	sessionDurationHours?: number;
	mode?: CostMode;
	order?: SortOrder;
};

/**
 * 统一会话选择器
 *
 * 为原版和拼车版监控提供一致的会话选择逻辑，
 * 完全基于本地数据计算，确保窗口期显示稳定。
 */
export class UnifiedSessionSelector implements Disposable {
	private cachedSession: SessionBlock | null = null;
	private cacheTimestamp: number = 0;
	private readonly CACHE_DURATION = 30000; // 30秒缓存
	private config: Required<SessionSelectorConfig>;

	constructor(config: SessionSelectorConfig = {}) {
		this.config = {
			claudePaths: config.claudePaths || getClaudePaths(),
			sessionDurationHours: config.sessionDurationHours || 5,
			mode: config.mode || 'auto',
			order: config.order || 'desc',
		};

		if (this.config.claudePaths.length === 0) {
			logger.warn('UnifiedSessionSelector: 未找到有效的Claude数据目录');
		}
	}

	/**
	 * 实现 Disposable 接口
	 */
	[Symbol.dispose](): void {
		this.clearCache();
	}

	/**
	 * 获取当前活跃会话（带缓存）
	 *
	 * @param userId - 用户ID（用于日志标识，不影响选择逻辑）
	 * @param teamContext - 是否在团队上下文中使用（用于日志标识）
	 * @returns 当前活跃的会话块，如果没有则返回null
	 */
	async getCurrentSession(
		userId?: string,
		teamContext?: boolean,
	): Promise<SessionBlock | null> {
		const now = Date.now();

		// 如果缓存有效，直接返回
		if (this.cachedSession != null && (now - this.cacheTimestamp) < this.CACHE_DURATION) {
			if (teamContext === true) {
				logger.debug(`UnifiedSessionSelector: 使用缓存会话 ${this.cachedSession.id} (用户: ${userId ?? '未知'})`);
			}
			return this.cachedSession;
		}

		// 重新计算当前会话
		const sessionResult = await this.calculateCurrentSession(userId, teamContext);

		if (Result.isSuccess(sessionResult)) {
			// 更新缓存
			this.cachedSession = sessionResult.value;
			this.cacheTimestamp = now;

			if (teamContext === true && sessionResult.value != null) {
				logger.debug(`UnifiedSessionSelector: 计算新会话 ${sessionResult.value.id} (用户: ${userId ?? '未知'})`);
			}

			return sessionResult.value;
		}
		else {
			logger.error(`UnifiedSessionSelector: 计算会话失败 - ${sessionResult.error}`);
			return null;
		}
	}

	/**
	 * 清除缓存，强制重新计算
	 */
	clearCache(): void {
		this.cachedSession = null;
		this.cacheTimestamp = 0;
	}

	/**
	 * 获取选择器状态信息
	 */
	getStatus(): {
		hasCachedSession: boolean;
		cacheAge: number;
		claudePathsCount: number;
		config: Required<SessionSelectorConfig>;
	} {
		return {
			hasCachedSession: this.cachedSession != null,
			cacheAge: Date.now() - this.cacheTimestamp,
			claudePathsCount: this.config.claudePaths.length,
			config: { ...this.config },
		};
	}

	/**
	 * 计算当前会话（核心算法）
	 *
	 * 完全基于本地JSONL文件进行计算，不依赖任何数据库状态
	 */
	private async calculateCurrentSession(
		_userId?: string,
		_teamContext?: boolean,
	): Promise<Result.Result<SessionBlock | null, string>> {
		return Result.try({
			try: async () => {
				// 1. 验证Claude数据路径
				if (this.config.claudePaths.length === 0) {
					return null;
				}

				// 2. 加载本地使用数据
				const blocks = await loadSessionBlockData({
					claudePath: this.config.claudePaths[0], // 使用第一个有效路径
					sessionDurationHours: this.config.sessionDurationHours,
					mode: this.config.mode,
					order: this.config.order,
				});

				if (blocks.length === 0) {
					return null;
				}

				// 3. 应用稳定的选择策略
				return this.selectStableSession(blocks);
			},
			catch: (error) => {
				const errorMsg = error instanceof Error ? error.message : String(error);
				return `计算当前会话失败: ${errorMsg}`;
			},
		})();
	}

	/**
	 * 稳定会话选择策略
	 *
	 * 使用分级选择逻辑，确保会话选择的稳定性：
	 * 1. 优先选择真正活跃的会话（有最近活动且在窗口期内）
	 * 2. 其次选择当前时间在窗口期内的会话
	 * 3. 最后选择最近的会话
	 */
	private selectStableSession(blocks: SessionBlock[]): SessionBlock | null {
		const now = new Date();

		// 优先级1: 真正活跃的会话（有最近活动且在窗口期内）
		const activeBlocks = blocks.filter((block) => {
			return Boolean(block.isActive)
				&& block.actualEndTime != null
				&& (now.getTime() - block.actualEndTime.getTime()) < (2 * 60 * 60 * 1000); // 2小时内有活动
		});

		if (activeBlocks.length > 0) {
			return activeBlocks[0] ?? null; // 返回最新的活跃会话
		}

		// 优先级2: 当前时间在窗口期内的会话
		const currentTimeBlocks = blocks.filter((block) => {
			return now >= block.startTime && now < block.endTime;
		});

		if (currentTimeBlocks.length > 0) {
			return currentTimeBlocks[0] ?? null;
		}

		// 优先级3: 最近的会话
		const recentBlocks = blocks
			.filter(block => !(block.isGap ?? false))
			.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

		return recentBlocks[0] ?? null;
	}

	/**
	 * 获取所有会话块（用于调试和测试）
	 */
	async getAllBlocks(): Promise<SessionBlock[]> {
		if (this.config.claudePaths.length === 0) {
			return [];
		}

		try {
			return await loadSessionBlockData({
				claudePath: this.config.claudePaths[0],
				sessionDurationHours: this.config.sessionDurationHours,
				mode: this.config.mode,
				order: this.config.order,
			});
		}
		catch (error) {
			logger.error('UnifiedSessionSelector: 获取所有会话块失败', error);
			return [];
		}
	}
}

/**
 * 创建统一会话选择器的便捷函数
 */
export function createUnifiedSessionSelector(
	config: SessionSelectorConfig = {},
): UnifiedSessionSelector {
	return new UnifiedSessionSelector(config);
}

/**
 * 全局单例会话选择器（用于性能优化）
 *
 * 注意：在生产环境中建议使用单例，在测试环境中建议创建独立实例
 */
let globalSessionSelector: UnifiedSessionSelector | null = null;

/**
 * 获取全局会话选择器单例
 */
export function getGlobalSessionSelector(
	config: SessionSelectorConfig = {},
): UnifiedSessionSelector {
	if (globalSessionSelector === null) {
		globalSessionSelector = new UnifiedSessionSelector(config);
	}
	return globalSessionSelector;
}

/**
 * 重置全局会话选择器（用于测试）
 */
export function resetGlobalSessionSelector(): void {
	if (globalSessionSelector !== null) {
		globalSessionSelector[Symbol.dispose]();
		globalSessionSelector = null;
	}
}

if (import.meta.vitest != null) {
	describe('UnifiedSessionSelector', () => {
		let selector: UnifiedSessionSelector;
		let tempDir: string;

		beforeEach(async () => {
			const { createFixture } = await import('fs-fixture');
			const now = new Date();
			const recentTimestamp = new Date(now.getTime() - 60 * 60 * 1000); // 1小时前

			const fixture = await createFixture({
				'projects/test-project/session1/usage.jsonl': `${JSON.stringify({
					timestamp: recentTimestamp.toISOString(),
					message: {
						model: 'claude-sonnet-4-20250514',
						usage: {
							input_tokens: 100,
							output_tokens: 50,
							cache_creation_input_tokens: 0,
							cache_read_input_tokens: 0,
						},
					},
					costUSD: 0.01,
					version: '1.0.0',
				})}\n`,
			});
			tempDir = fixture.path;

			selector = new UnifiedSessionSelector({
				claudePaths: [tempDir],
				sessionDurationHours: 5,
				mode: 'display',
				order: 'desc',
			});
		});

		afterEach(() => {
			selector[Symbol.dispose]();
		});

		it('应该初始化并获取当前会话', async () => {
			const session = await selector.getCurrentSession('test-user', false);
			expect(session).not.toBeNull();

			if (session !== null) {
				expect(session.tokenCounts.inputTokens).toBe(100);
				expect(session.tokenCounts.outputTokens).toBe(50);
				expect(session.costUSD).toBe(0.01);
			}
		});

		it('应该使用缓存机制', async () => {
			// 第一次调用
			const session1 = await selector.getCurrentSession('test-user', false);

			// 第二次调用应该使用缓存
			const session2 = await selector.getCurrentSession('test-user', false);

			expect(session1?.id).toBe(session2?.id);

			const status = selector.getStatus();
			expect(status.hasCachedSession).toBe(true);
			expect(status.cacheAge).toBeLessThan(1000); // 应该很新
		});

		it('应该在缓存过期后重新计算', async () => {
			// 获取初始会话
			const session1 = await selector.getCurrentSession('test-user', false);

			// 清除缓存
			selector.clearCache();

			// 应该重新计算
			const session2 = await selector.getCurrentSession('test-user', false);

			// 内容应该相同但重新计算了
			expect(session1?.id).toBe(session2?.id);

			const status = selector.getStatus();
			expect(status.cacheAge).toBeLessThan(100); // 应该是新的缓存
		});

		it('应该处理空目录', async () => {
			const { createFixture } = await import('fs-fixture');
			const emptyFixture = await createFixture({});

			const emptySelector = new UnifiedSessionSelector({
				claudePaths: [emptyFixture.path],
			});

			const session = await emptySelector.getCurrentSession('test-user', false);
			expect(session).toBeNull();

			emptySelector[Symbol.dispose]();
		});

		it('应该正确报告状态', () => {
			const status = selector.getStatus();

			expect(status.claudePathsCount).toBe(1);
			expect(status.config.sessionDurationHours).toBe(5);
			expect(status.config.mode).toBe('display');
			expect(status.config.order).toBe('desc');
		});

		it('全局单例应该工作正常', () => {
			const selector1 = getGlobalSessionSelector();
			const selector2 = getGlobalSessionSelector();

			expect(selector1).toBe(selector2); // 应该是同一个实例

			resetGlobalSessionSelector();

			const selector3 = getGlobalSessionSelector();
			expect(selector3).not.toBe(selector1); // 应该是新实例
		});
	});
}
