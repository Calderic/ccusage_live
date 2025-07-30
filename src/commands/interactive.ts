import process from 'node:process';
import { Result } from '@praha/byethrow';
import pc from 'picocolors';
import prompts from 'prompts';
import { logger } from '../logger.ts';
import { systemConfig } from '../team/system-config.ts';
import { blocksCommand } from './blocks.ts';
import { dailyCommand } from './daily.ts';
import { monthlyCommand } from './monthly.ts';
import { sessionCommand } from './session.ts';
import {
	teamCreateCommand,
	teamJoinCommand,
	teamLeaveCommand,
	teamListCommand,
	teamLiveCommand,
	teamMembersCommand,
} from './team.ts';

/**
 * 交互式菜单选项
 */
type MenuChoice = {
	title: string;
	description?: string;
	value: string;
};

/**
 * ASCII艺术头部
 */
const ASCII_HEADER = `
${pc.cyan('╔═══════════════════════════════════════════════════════════════╗')}
${pc.cyan('║')}                    ${pc.red('⚡ CCUSAGE TERMINAL ⚡')}                    ${pc.cyan('║')}
${pc.cyan('║')}              ${pc.green('[ Claude Code Usage Monitor ]')}               ${pc.cyan('║')}
${pc.cyan('╠═══════════════════════════════════════════════════════════════╣')}
${pc.cyan('║')}  ${pc.yellow('>')} System Status: ${pc.green('ONLINE')}     ${pc.yellow('>')} User: ${pc.magenta(process.env.USER ?? 'UNKNOWN')}      ${pc.cyan('║')}
${pc.cyan('║')}  ${pc.yellow('>')} Security: ${pc.green('ENCRYPTED')}      ${pc.yellow('>')} Access: ${pc.green('AUTHORIZED')}       ${pc.cyan('║')}
${pc.cyan('╚═══════════════════════════════════════════════════════════════╝')}
`;

/**
 * 主菜单选项
 */
const MAIN_MENU_CHOICES: MenuChoice[] = [
	{
		title: `${pc.cyan('▶')} ${pc.bold('车队管理')}`,
		description: pc.gray('创建、加入和管理车队'),
		value: 'team',
	},
	{
		title: `${pc.yellow('▶')} ${pc.bold('用量查询')}`,
		description: pc.gray('查看Claude Code使用统计'),
		value: 'usage',
	},
	{
		title: `${pc.magenta('▶')} ${pc.bold('其他工具')}`,
		description: pc.gray('系统工具和高级功能'),
		value: 'tools',
	},
	{
		title: `${pc.red('◀')} ${pc.bold('退出')}`,
		description: pc.gray('退出程序'),
		value: 'exit',
	},
];

/**
 * 车队管理菜单选项
 */
const TEAM_MENU_CHOICES: MenuChoice[] = [
	{
		title: `${pc.green('●')} ${pc.bold('创建车队')}`,
		description: pc.gray('创建一个新的车队'),
		value: 'create',
	},
	{
		title: `${pc.blue('●')} ${pc.bold('加入车队')}`,
		description: pc.gray('使用邀请码加入现有车队'),
		value: 'join',
	},
	{
		title: `${pc.yellow('●')} ${pc.bold('车队列表')}`,
		description: pc.gray('查看我的所有车队'),
		value: 'list',
	},
	{
		title: `${pc.magenta('●')} ${pc.bold('车队成员')}`,
		description: pc.gray('查看车队成员信息'),
		value: 'members',
	},
	{
		title: `${pc.red('●')} ${pc.bold('实时监控')}`,
		description: pc.gray('启动车队实时监控界面'),
		value: 'live',
	},
	{
		title: `${pc.gray('●')} ${pc.bold('离开车队')}`,
		description: pc.gray('从当前车队中离开'),
		value: 'leave',
	},
	{
		title: `${pc.dim('◀')} ${pc.dim('返回主菜单')}`,
		description: pc.gray('返回上级菜单'),
		value: 'back',
	},
];

/**
 * 用量查询菜单选项
 */
const USAGE_MENU_CHOICES: MenuChoice[] = [
	{
		title: `${pc.cyan('●')} ${pc.bold('今日用量')}`,
		description: pc.gray('查看今日Claude Code使用统计'),
		value: 'daily',
	},
	{
		title: `${pc.blue('●')} ${pc.bold('月度用量')}`,
		description: pc.gray('查看本月使用量汇总'),
		value: 'monthly',
	},
	{
		title: `${pc.green('●')} ${pc.bold('会话用量')}`,
		description: pc.gray('按会话查看详细使用情况'),
		value: 'session',
	},
	{
		title: `${pc.yellow('●')} ${pc.bold('计费块用量')}`,
		description: pc.gray('查看5小时计费周期使用量'),
		value: 'blocks',
	},
	{
		title: `${pc.dim('◀')} ${pc.dim('返回主菜单')}`,
		description: pc.gray('返回上级菜单'),
		value: 'back',
	},
];

/**
 * 清屏函数
 */
function clearScreen(): void {
	process.stdout.write('\x1B[2J\x1B[0f');
}

/**
 * 显示头部信息
 */
function showHeader(): void {
	// eslint-disable-next-line no-console
	console.log(ASCII_HEADER);
}

/**
 * 显示菜单并获取用户选择
 */
async function showMenu(choices: MenuChoice[], title: string): Promise<string | undefined> {
	clearScreen();
	showHeader();

	// eslint-disable-next-line no-console
	console.log(`\n${pc.cyan('┌──')} ${pc.bold(title)} ${pc.cyan('──┐')}`);
	// eslint-disable-next-line no-console
	console.log(pc.cyan('│'));

	const response = await prompts({
		type: 'select',
		name: 'choice',
		message: pc.bold('选择操作'),
		choices,
		initial: 0,
		hint: pc.gray('使用方向键选择，回车确认'),
	});

	return response.choice;
}

/**
 * 显示加载动画
 */
function showLoading(message: string): NodeJS.Timeout {
	const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
	let i = 0;

	return setInterval(() => {
		process.stdout.write(`\r${pc.cyan(frames[i])} ${message}`);
		i = (i + 1) % frames.length;
	}, 100);
}

/**
 * 执行子命令
 */
async function executeCommand(command: string, args: string[] = []): Promise<void> {
	// eslint-disable-next-line no-console
	console.log(`\n${pc.cyan('┌──')} ${pc.bold('执行命令')} ${pc.cyan('──┐')}`);
	// eslint-disable-next-line no-console
	console.log(pc.cyan('│'));

	const loading = showLoading(`正在执行: ${command} ${args.join(' ')}`);

	try {
		// 构建上下文对象，模拟 gunshi 的上下文
		const ctx = {
			values: {} as Record<string, any>,
			args: {} as Record<string, any>,
		};

		// 解析参数到上下文
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg != null && arg.startsWith('--')) {
				const key = arg.slice(2);
				const nextArg = args[i + 1];
				if (nextArg != null && !nextArg.startsWith('--')) {
					ctx.values[key] = nextArg;
					i++; // 跳过值参数
				}
				else {
					ctx.values[key] = true;
				}
			}
			else if (arg === '--yes') {
				ctx.values.yes = true;
			}
		}

		// 根据命令选择对应的处理函数
		let commandFn: any;
		let commandArgs: string[] = [];

		if (command === 'team' && args.length > 0) {
			const subCommand = args[0];
			commandArgs = args.slice(1);

			switch (subCommand) {
				case 'create':
					commandFn = teamCreateCommand;
					// 传递车队名称作为位置参数到 values
					if (commandArgs[0] != null) {
						ctx.values.name = commandArgs[0];
					}
					// 设置默认用户名（从环境变量或默认值）
					ctx.values.userName = process.env.USER || 'User';
					break;
				case 'join':
					commandFn = teamJoinCommand;
					// 传递邀请码作为位置参数到 values
					if (commandArgs[0] != null) {
						ctx.values.code = commandArgs[0];
					}
					// 设置默认用户名（从环境变量或默认值）
					ctx.values.userName = process.env.USER || 'User';
					break;
				case 'list':
					commandFn = teamListCommand;
					// 设置默认用户名
					ctx.values.userName = process.env.USER || 'User';
					break;
				case 'members':
					commandFn = teamMembersCommand;
					// 设置默认用户名
					ctx.values.userName = process.env.USER || 'User';
					break;
				case 'live':
					commandFn = teamLiveCommand;
					// 设置所有必需的参数和默认值
					ctx.values.userName = process.env.USER || 'User';
					ctx.values.refresh = 5; // 默认5秒刷新间隔
					ctx.values.sync = true; // 启用数据同步以显示真实数据
					ctx.values.syncInterval = 30; // 默认30秒同步间隔
					// 从数据库获取默认Token限制，失败时使用100M（ClaudeMax fallback）
					const tokenLimitResult = await systemConfig.getTokenLimit();
					ctx.values.tokenLimit = Result.isSuccess(tokenLimitResult) ? tokenLimitResult.value : 100000000;
					break;
				case 'leave':
					commandFn = teamLeaveCommand;
					// 设置默认用户名
					ctx.values.userName = process.env.USER || 'User';
					break;
				case undefined:
					throw new Error('缺少车队子命令');
				default:
					throw new Error(`未知的车队子命令: ${subCommand}`);
			}
		}
		else {
			switch (command) {
				case 'daily':
					commandFn = dailyCommand;
					break;
				case 'monthly':
					commandFn = monthlyCommand;
					break;
				case 'session':
					commandFn = sessionCommand;
					break;
				case 'blocks':
					commandFn = blocksCommand;
					break;
				default:
					throw new Error(`未知命令: ${command}`);
			}
		}

		if (commandFn != null && typeof commandFn.run === 'function') {
			// 对于长时间运行的命令（如 team live），立即清除loading状态
			const isLongRunningCommand = command === 'team' && args[0] === 'live';

			if (isLongRunningCommand) {
				clearInterval(loading);
				process.stdout.write('\r\x1B[K'); // 清除加载行
			}

			await commandFn.run(ctx);

			if (!isLongRunningCommand) {
				clearInterval(loading);
				process.stdout.write('\r\x1B[K'); // 清除加载行
				// eslint-disable-next-line no-console
				console.log(`\n${pc.green('✓')} ${pc.bold('命令执行完成')}`);
			}
		}
		else {
			throw new Error(`命令 ${command} 没有可用的执行函数`);
		}
	}
	catch (error) {
		clearInterval(loading);
		process.stdout.write('\r\x1B[K');
		// eslint-disable-next-line no-console
		console.log(`\n${pc.red('✗')} ${pc.bold('命令执行出错:')} ${error instanceof Error ? error.message : String(error)}`);
		throw error;
	}
}

/**
 * 处理车队管理菜单
 */
async function handleTeamMenu(): Promise<void> {
	while (true) {
		const choice = await showMenu(TEAM_MENU_CHOICES, '选择车队功能');

		if (!choice || choice === 'back') {
			break;
		}

		try {
			switch (choice) {
				case 'create': {
					// eslint-disable-next-line no-console
					console.log(`\n${pc.cyan('┌──')} ${pc.bold('创建车队')} ${pc.cyan('──┐')}`);
					const response = await prompts({
						type: 'text',
						name: 'name',
						message: pc.cyan('车队名称'),
						hint: pc.gray('输入新车队的名称'),
						validate: (value: string) => value.length > 0 ? true : '车队名称不能为空',
					});
					if (response.name) {
						await executeCommand('team', ['create', response.name]);
					}
					break;
				}
				case 'join': {
					// eslint-disable-next-line no-console
					console.log(`\n${pc.cyan('┌──')} ${pc.bold('加入车队')} ${pc.cyan('──┐')}`);
					const response = await prompts({
						type: 'text',
						name: 'code',
						message: pc.cyan('邀请码'),
						hint: pc.gray('输入6位车队邀请码'),
						validate: (value: string) => value.length === 6 ? true : '邀请码必须是6位',
					});
					if (response.code) {
						await executeCommand('team', ['join', response.code]);
					}
					break;
				}
				case 'list':
					await executeCommand('team', ['list']);
					break;
				case 'members':
					await executeCommand('team', ['members']);
					break;
				case 'live':
					await executeCommand('team', ['live']);
					break;
				case 'leave': {
					// eslint-disable-next-line no-console
					console.log(`\n${pc.cyan('┌──')} ${pc.bold('离开车队')} ${pc.cyan('──┐')}`);
					// eslint-disable-next-line no-console
					console.log(pc.yellow('⚠️  警告: 此操作无法撤销'));
					const confirm = await prompts({
						type: 'confirm',
						name: 'confirmed',
						message: pc.red('确定要离开车队吗？'),
						initial: false,
					});
					if (confirm.confirmed) {
						await executeCommand('team', ['leave', '--yes']);
					}
					break;
				}
			}
		}
		catch (error) {
			logger.error(`执行命令时出错: ${error}`);
		}

		// 操作完成后暂停，让用户查看结果
		// eslint-disable-next-line no-console
		console.log(`\n${pc.cyan('└──')} ${pc.dim('操作完成')} ${pc.cyan('──┘')}`);
		await prompts({
			type: 'confirm',
			name: 'continue',
			message: pc.gray('按回车键返回菜单'),
			initial: true,
		});
	}
}

/**
 * 处理用量查询菜单
 */
async function handleUsageMenu(): Promise<void> {
	while (true) {
		const choice = await showMenu(USAGE_MENU_CHOICES, '选择用量查询类型');

		if (!choice || choice === 'back') {
			break;
		}

		try {
			switch (choice) {
				case 'daily':
					await executeCommand('daily');
					break;
				case 'monthly':
					await executeCommand('monthly');
					break;
				case 'session':
					await executeCommand('session');
					break;
				case 'blocks':
					await executeCommand('blocks');
					break;
			}
		}
		catch (error) {
			logger.error(`执行命令时出错: ${error}`);
		}

		// 操作完成后暂停，让用户查看结果
		// eslint-disable-next-line no-console
		console.log(`\n${pc.cyan('└──')} ${pc.dim('操作完成')} ${pc.cyan('──┘')}`);
		await prompts({
			type: 'confirm',
			name: 'continue',
			message: pc.gray('按回车键返回菜单'),
			initial: true,
		});
	}
}

/**
 * 交互式菜单主函数
 */
export async function interactiveCommand(): Promise<void> {
	while (true) {
		const choice = await showMenu(MAIN_MENU_CHOICES, 'CCUSAGE 控制台');

		if (!choice || choice === 'exit') {
			clearScreen();
			// eslint-disable-next-line no-console
			console.log(`\n${pc.cyan('╔═══════════════════════════════════════╗')}`);
			// eslint-disable-next-line no-console
			console.log(`${pc.cyan('║')}        ${pc.green('感谢使用 CCUSAGE 系统')}        ${pc.cyan('║')}`);
			// eslint-disable-next-line no-console
			console.log(`${pc.cyan('║')}          ${pc.gray('连接已安全断开')}          ${pc.cyan('║')}`);
			// eslint-disable-next-line no-console
			console.log(`${pc.cyan('╚═══════════════════════════════════════╝')}\n`);
			break;
		}

		switch (choice) {
			case 'team':
				await handleTeamMenu();
				break;
			case 'usage':
				await handleUsageMenu();
				break;
			case 'tools':
				clearScreen();
				showHeader();
				console.log(`\n${pc.cyan('┌──')} ${pc.bold('系统工具')} ${pc.cyan('──┐')}`);
				console.log(`${pc.cyan('│')}`);
				console.log(`${pc.yellow('⚠️')} ${pc.bold('开发中...')}`);
				console.log(`${pc.gray('更多高级工具正在开发中，敬请期待！')}`);

				// 操作完成后暂停，让用户查看结果
				console.log(`\n${pc.cyan('└──')} ${pc.dim('操作完成')} ${pc.cyan('──┘')}`);
				await prompts({
					type: 'confirm',
					name: 'continue',
					message: pc.gray('按回车键返回菜单'),
					initial: true,
				});
				break;
		}
	}
}
