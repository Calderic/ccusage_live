/**
 * @fileoverview 车队实时监控渲染模块
 *
 * 基于现有的 live-rendering 模块扩展，提供车队专用的
 * 实时监控界面，显示多用户协作状态。
 */

import type { TeamAggregatedStats } from './_team-types.ts';
import process from 'node:process';
/**
 * Simple delay function with abort signal support
 */
function delay(ms: number, options?: { signal?: AbortSignal }): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(resolve, ms);
		
		if (options?.signal) {
			if (options.signal.aborted) {
				clearTimeout(timeout);
				reject(new Error('Operation was aborted'));
				return;
			}
			
			options.signal.addEventListener('abort', () => {
				clearTimeout(timeout);
				reject(new Error('Operation was aborted'));
			});
		}
	});
}
import { Result } from '@praha/byethrow';
import * as ansiEscapes from 'ansi-escapes';
import pc from 'picocolors';
import stringWidth from 'string-width';
import { centerText, createProgressBar, TerminalManager } from '../_terminal-utils.ts';
import { formatCurrency, formatNumber } from '../_utils.ts';
import { logger } from '../logger.ts';
import { systemConfig } from './system-config.ts';
import { teamService } from './team-service.ts';

/**
 * 车队实时监控配置
 */
type TeamLiveMonitoringConfig = {
	teamId: string;
	teamName: string;
	refreshInterval: number;
	tokenLimit?: number; // Token 限制
	currentUserId?: string; // 当前用户ID，用于混合本地数据
};

/**
 * 启动车队实时监控
 * @param config 监控配置
 */
export async function startTeamLiveMonitoring(config: TeamLiveMonitoringConfig): Promise<void> {
	// 如果没有指定tokenLimit，从系统配置获取（只在启动时获取一次）
	if (!config.tokenLimit) {
		const tokenLimitResult = await systemConfig.getTokenLimit();
		if (Result.isSuccess(tokenLimitResult)) {
			config.tokenLimit = tokenLimitResult.value;
		}
		else {
			// 如果获取失败，使用ClaudeMax计划的fallback值
			config.tokenLimit = 100000000; // 100M tokens
			logger.warn('Failed to get token limit from config, using fallback:', tokenLimitResult.error);
		}
	}

	const terminal = new TerminalManager();
	const abortController = new AbortController();
	let lastRenderTime = 0;
	const minRenderInterval = 1000; // 最小渲染间隔 1 秒

	// 设置优雅退出
	const cleanup = (): void => {
		abortController.abort();
		terminal.cleanup();
		terminal.clearScreen();
		logger.info('车队实时监控已停止');
		if (process.exitCode == null) {
			process.exit(0);
		}
	};

	process.on('SIGINT', cleanup);
	process.on('SIGTERM', cleanup);

	// 设置终端
	terminal.enterAlternateScreen();
	terminal.enableSyncMode();
	terminal.clearScreen();
	terminal.hideCursor();

	try {
		while (!abortController.signal.aborted) {
			const now = Date.now();
			const timeSinceLastRender = now - lastRenderTime;

			// 限制渲染频率
			if (timeSinceLastRender < minRenderInterval) {
				await delayWithAbort(minRenderInterval - timeSinceLastRender, abortController.signal);
				continue;
			}

			// 获取车队统计数据（混合本地和云端数据）
			const statsResult = await teamService.getTeamStats(config.teamId, config.currentUserId);

			if (Result.isFailure(statsResult)) {
				await renderErrorState(terminal, `获取车队数据失败: ${statsResult.error}`, abortController.signal);
				continue;
			}

			const stats = statsResult.value;

			// 渲染车队监控界面
			renderTeamLiveDisplay(terminal, stats, config);
			lastRenderTime = Date.now();

			// 等待下次刷新
			await delayWithAbort(config.refreshInterval, abortController.signal);
		}
	}
	catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			return; // 正常退出
		}

		const errorMessage = error instanceof Error ? error.message : String(error);
		terminal.startBuffering();
		terminal.clearScreen();
		terminal.write(pc.red(`错误: ${errorMessage}\n`));
		terminal.flush();
		logger.error(`车队监控错误: ${errorMessage}`);
		await delayWithAbort(config.refreshInterval, abortController.signal).catch(() => {});
	}
	finally {
		cleanup();
	}
}

/**
 * 带中断支持的延迟函数
 */
async function delayWithAbort(ms: number, signal: AbortSignal): Promise<void> {
	await delay(ms, { signal });
}

/**
 * 渲染错误状态
 */
async function renderErrorState(terminal: TerminalManager, error: string, signal: AbortSignal): Promise<void> {
	terminal.startBuffering();
	terminal.write(ansiEscapes.cursorTo(0, 0));
	terminal.write(ansiEscapes.eraseDown);
	terminal.write(pc.red(`❌ ${error}\n`));
	terminal.write(pc.gray('正在重试...\n'));
	terminal.write(ansiEscapes.cursorHide);
	terminal.flush();

	await delayWithAbort(3000, signal); // 3秒后重试
}

/**
 * 渲染车队实时监控界面
 */
function renderTeamLiveDisplay(
	terminal: TerminalManager,
	stats: TeamAggregatedStats,
	config: TeamLiveMonitoringConfig,
): void {
	terminal.startBuffering();
	terminal.write(ansiEscapes.cursorTo(0, 0));
	terminal.write(ansiEscapes.eraseDown);

	const width = terminal.width;

	// 使用紧凑模式处理窄终端
	if (width < 70) {
		renderCompactTeamDisplay(terminal, stats, config);
		terminal.write(ansiEscapes.cursorHide);
		terminal.flush();
		return;
	}

	// 计算盒子尺寸
	const boxWidth = Math.min(120, width - 2);
	const boxMargin = Math.floor((width - boxWidth) / 2);
	const marginStr = ' '.repeat(boxMargin);

	// 绘制标题
	terminal.write(`${marginStr}┌${'─'.repeat(boxWidth - 2)}┐\n`);
	terminal.write(`${marginStr}│${pc.bold(centerText('🚗 CLAUDE 拼车实时监控', boxWidth - 2))}│\n`);
	terminal.write(`${marginStr}├${'─'.repeat(boxWidth - 2)}┤\n`);
	terminal.write(`${marginStr}│${' '.repeat(boxWidth - 2)}│\n`);

	// 车队基本信息
	const teamInfo = `车队: ${stats.team.name}  |  成员: ${stats.members.length}/${stats.members.length}  |  活跃: ${stats.active_members_count}`;
	const teamInfoPadded = teamInfo + ' '.repeat(Math.max(0, boxWidth - 3 - stringWidth(teamInfo)));
	terminal.write(`${marginStr}│ ${teamInfoPadded}│\n`);

	// 当前会话信息
	if (stats.current_session) {
		const session = stats.current_session;
		const startTime = session.startTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
		const endTime = session.endTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
		const remaining = Math.max(0, (session.endTime.getTime() - new Date().getTime()) / (1000 * 60));
		const remainingStr = remaining > 60
			? `${Math.floor(remaining / 60)}h ${Math.floor(remaining % 60)}m`
			: `${Math.floor(remaining)}m`;

		const sessionInfo = `当前窗口: ${startTime}-${endTime}  |  剩余: ${remainingStr}`;
		const sessionInfoPadded = sessionInfo + ' '.repeat(Math.max(0, boxWidth - 3 - stringWidth(sessionInfo)));
		terminal.write(`${marginStr}│ ${sessionInfoPadded}│\n`);
	}

	terminal.write(`${marginStr}│${' '.repeat(boxWidth - 2)}│\n`);
	terminal.write(`${marginStr}├${'─'.repeat(boxWidth - 2)}┤\n`);
	terminal.write(`${marginStr}│${' '.repeat(boxWidth - 2)}│\n`);

	// 使用情况（显示当前5小时窗口期）
	let timeRangeText = '当前窗口期';
	if (stats.current_session) {
		const startTime = stats.current_session.startTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
		const endTime = stats.current_session.endTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
		timeRangeText = `当前窗口期 (${startTime}-${endTime})`;
	}
	const usageLabel = pc.bold(`🔥 使用情况 - ${timeRangeText}`);
	const usageLabelPadded = usageLabel + ' '.repeat(Math.max(0, boxWidth - 3 - stringWidth(usageLabel)));
	terminal.write(`${marginStr}│ ${usageLabelPadded}│\n`);

	// 获取当前用户的个人使用情况
	const currentUser = config.currentUserId 
		? stats.member_stats.find(member => member.user_id === config.currentUserId)
		: stats.member_stats[0]; // 如果没有指定用户ID，使用第一个成员

	// 使用个人数据而不是团队总数据
	const personalTokens = currentUser?.current_tokens || 0;
	const personalCost = currentUser?.current_cost || 0;

	// Token 使用进度条（从配置或系统配置获取限制）
	const tokenLimit = config.tokenLimit || 100000000; // ClaudeMax fallback: 100M
	const tokenPercent = (personalTokens / tokenLimit) * 100;
	let barColor = pc.green;
	if (tokenPercent > 100) { barColor = pc.red; }
	else if (tokenPercent > 80) { barColor = pc.yellow; }

	const barWidth = Math.min(40, boxWidth - 20);
	const tokenBar = createProgressBar(
		personalTokens,
		tokenLimit,
		barWidth,
		{
			showPercentage: false,
			fillChar: barColor('█'),
			emptyChar: pc.gray('░'),
			leftBracket: '[',
			rightBracket: ']',
		},
	);

	const tokenInfo = `TOKEN  ${tokenBar} ${tokenPercent.toFixed(1)}% (${formatTokensShort(personalTokens)}/${formatTokensShort(tokenLimit)})`;
	const tokenInfoPadded = tokenInfo + ' '.repeat(Math.max(0, boxWidth - 3 - stringWidth(tokenInfo)));
	terminal.write(`${marginStr}│ ${tokenInfoPadded}│\n`);

	// 费用和个人燃烧率（从个人数据推算）
	const personalBurnRate = stats.burn_rate && currentUser
		? Math.round(stats.burn_rate.tokens_per_minute * (personalTokens / Math.max(stats.total_tokens, 1)))
		: null;
	
	const burnRateText = personalBurnRate
		? `${formatTokensShort(personalBurnRate)} token/min ${getBurnRateIndicator(stats.burn_rate?.indicator || 'NORMAL')}`
		: 'N/A';
	const costInfo = `个人费用: ${formatCurrency(personalCost)} / 燃烧率: ${burnRateText}`;
	const costInfoPadded = costInfo + ' '.repeat(Math.max(0, boxWidth - 3 - stringWidth(costInfo)));
	terminal.write(`${marginStr}│ ${costInfoPadded}│\n`);

	terminal.write(`${marginStr}│${' '.repeat(boxWidth - 2)}│\n`);
	terminal.write(`${marginStr}├${'─'.repeat(boxWidth - 2)}┤\n`);
	terminal.write(`${marginStr}│${' '.repeat(boxWidth - 2)}│\n`);

	// 成员状态
	const membersLabel = pc.bold('👥 成员状态');
	const membersLabelPadded = membersLabel + ' '.repeat(Math.max(0, boxWidth - 3 - stringWidth(membersLabel)));
	terminal.write(`${marginStr}│ ${membersLabelPadded}│\n`);

	for (const member of stats.member_stats.slice(0, 5)) { // 最多显示5个成员
		const statusText = member.is_active ? '[活跃]' : '[空闲]';
		const memberInfo = `${member.status_indicator} ${member.user_name}    ${statusText} ${formatTokensShort(member.current_tokens)} tokens  ${member.preferred_time}`;
		const memberInfoPadded = memberInfo + ' '.repeat(Math.max(0, boxWidth - 3 - stringWidth(memberInfo)));
		terminal.write(`${marginStr}│ ${memberInfoPadded}│\n`);
	}

	if (stats.member_stats.length > 5) {
		const moreInfo = pc.gray(`... 还有 ${stats.member_stats.length - 5} 位成员`);
		const moreInfoPadded = moreInfo + ' '.repeat(Math.max(0, boxWidth - 3 - stringWidth(moreInfo)));
		terminal.write(`${marginStr}│ ${moreInfoPadded}│\n`);
	}

	terminal.write(`${marginStr}│${' '.repeat(boxWidth - 2)}│\n`);
	terminal.write(`${marginStr}├${'─'.repeat(boxWidth - 2)}┤\n`);
	terminal.write(`${marginStr}│${' '.repeat(boxWidth - 2)}│\n`);

	// 智能建议
	if (stats.smart_suggestions.length > 0) {
		const suggestionsLabel = pc.bold('💡 智能建议');
		const suggestionsLabelPadded = suggestionsLabel + ' '.repeat(Math.max(0, boxWidth - 3 - stringWidth(suggestionsLabel)));
		terminal.write(`${marginStr}│ ${suggestionsLabelPadded}│\n`);

		for (const suggestion of stats.smart_suggestions.slice(0, 3)) { // 最多显示3条建议
			const suggestionText = `• ${suggestion}`;
			const suggestionPadded = suggestionText + ' '.repeat(Math.max(0, boxWidth - 3 - stringWidth(suggestionText)));
			terminal.write(`${marginStr}│ ${suggestionPadded}│\n`);
		}

		terminal.write(`${marginStr}│${' '.repeat(boxWidth - 2)}│\n`);
	}

	// 底部信息
	terminal.write(`${marginStr}├${'─'.repeat(boxWidth - 2)}┤\n`);
	const refreshText = `↻ 每${config.refreshInterval / 1000}秒刷新  •  按 Ctrl+C 停止监控`;
	terminal.write(`${marginStr}│${pc.gray(centerText(refreshText, boxWidth - 2))}│\n`);
	terminal.write(`${marginStr}└${'─'.repeat(boxWidth - 2)}┘\n`);

	terminal.write(ansiEscapes.cursorHide);
	terminal.flush();
}

/**
 * 紧凑模式显示（适用于窄终端）
 */
function renderCompactTeamDisplay(
	terminal: TerminalManager,
	stats: TeamAggregatedStats,
	config: TeamLiveMonitoringConfig,
): void {
	const width = terminal.width;

	// 标题
	terminal.write(`${pc.bold(centerText('🚗 拼车监控', width))}\n`);
	terminal.write(`${'─'.repeat(width)}\n`);

	// 车队信息
	terminal.write(`车队: ${pc.yellow(stats.team.name)} | 成员: ${stats.members.length} | 活跃: ${stats.active_members_count}\n`);

	// 会话信息
	if (stats.current_session) {
		const remaining = Math.max(0, (stats.current_session.endTime.getTime() - new Date().getTime()) / (1000 * 60));
		terminal.write(`剩余: ${Math.floor(remaining)}分钟\n`);
	}

	terminal.write(`${'─'.repeat(width)}\n`);

	// 获取当前用户的个人使用情况
	const currentUser = config.currentUserId 
		? stats.member_stats.find(member => member.user_id === config.currentUserId)
		: stats.member_stats[0]; // 如果没有指定用户ID，使用第一个成员

	// 使用个人数据而不是团队总数据
	const personalTokens = currentUser?.current_tokens || 0;
	const personalCost = currentUser?.current_cost || 0;

	// Token 使用
	const tokenLimit = config.tokenLimit || 100000000; // ClaudeMax fallback: 100M
	const tokenPercent = (personalTokens / tokenLimit) * 100;
	const status = tokenPercent > 100 ? pc.red('超限') : tokenPercent > 80 ? pc.yellow('警告') : pc.green('正常');
	terminal.write(`个人Tokens: ${formatTokensShort(personalTokens)}/${formatTokensShort(tokenLimit)} ${status}\n`);

	// 费用
	terminal.write(`个人费用: ${formatCurrency(personalCost)}\n`);

	// 个人燃烧率（从个人数据推算）
	const personalBurnRate = stats.burn_rate && currentUser
		? Math.round(stats.burn_rate.tokens_per_minute * (personalTokens / Math.max(stats.total_tokens, 1)))
		: null;
	
	if (personalBurnRate) {
		terminal.write(`个人速率: ${formatTokensShort(personalBurnRate)}/分钟\n`);
	}

	terminal.write(`${'─'.repeat(width)}\n`);

	// 成员状态（紧凑显示）
	for (const member of stats.member_stats.slice(0, 3)) {
		const status = member.is_active ? pc.green('●') : pc.gray('○');
		terminal.write(`${status} ${member.user_name}: ${formatTokensShort(member.current_tokens)}\n`);
	}

	// 底部
	terminal.write(`${'─'.repeat(width)}\n`);
	terminal.write(pc.gray(`刷新: ${config.refreshInterval / 1000}s | Ctrl+C: 退出\n`));
}

/**
 * 格式化 Token 数量（简短格式）
 */
function formatTokensShort(num: number): string {
	if (num >= 1000000) {
		return `${(num / 1000000).toFixed(1)}M`;
	}
	if (num >= 1000) {
		return `${(num / 1000).toFixed(1)}k`;
	}
	return num.toString();
}

/**
 * 获取燃烧率指示器
 */
function getBurnRateIndicator(indicator: 'HIGH' | 'MODERATE' | 'NORMAL'): string {
	switch (indicator) {
		case 'HIGH':
			return pc.red('⚡ 高');
		case 'MODERATE':
			return pc.yellow('⚡ 中');
		case 'NORMAL':
		default:
			return pc.green('✓ 正常');
	}
}

if (import.meta.vitest != null) {
	describe('车队实时渲染', () => {
		it('应该正确格式化 Token 数量', () => {
			expect(formatTokensShort(999)).toBe('999');
			expect(formatTokensShort(1000)).toBe('1.0k');
			expect(formatTokensShort(1500)).toBe('1.5k');
			expect(formatTokensShort(1000000)).toBe('1.0M');
			expect(formatTokensShort(2500000)).toBe('2.5M');
		});

		it('应该正确生成燃烧率指示器', () => {
			expect(getBurnRateIndicator('HIGH')).toContain('高');
			expect(getBurnRateIndicator('MODERATE')).toContain('中');
			expect(getBurnRateIndicator('NORMAL')).toContain('正常');
		});
	});
}
