/**
 * @fileoverview 车队管理命令
 *
 * 提供车队相关的 CLI 命令，包括创建车队、加入车队、
 * 查看车队信息、实时监控等功能。
 */

import process from 'node:process';
import { Result } from '@praha/byethrow';
import Table from 'cli-table3';
import { define } from 'gunshi';
import pc from 'picocolors';
import { getPreferredTimeDescription } from '../team/_team-types.ts';
import {
	createRecommendedConfig,
	startEnhancedTeamLiveMonitor,
	validateMonitorConfig,
} from '../team/enhanced-live-monitor.ts';
import { testSupabaseConnection } from '../team/supabase-client.ts';
import { teamService } from '../team/team-service.ts';

/**
 * 创建车队命令
 */
export const teamCreateCommand = define({
	name: 'create',
	description: '创建新的车队',
	args: {
		name: {
			type: 'positional',
			description: '车队名称',
		},
		userName: {
			type: 'string',
			short: 'u',
			description: '用户名称',
			default: process.env.USER || 'User',
		},
	},
	async run(ctx) {
		const { name, userName } = ctx.values;

		if (!name) {
			console.error(pc.red('❌ 请提供车队名称'));
			console.error(pc.gray('用法: ccusage team create <车队名称>'));
			process.exit(1);
		}

		console.log(pc.cyan('🚗 创建车队中...'));

		// 测试数据库连接
		const connectionResult = await testSupabaseConnection();
		if (Result.isFailure(connectionResult)) {
			console.error(pc.red(`❌ 无法连接到数据库: ${connectionResult.error}`));
			console.error(pc.gray('请检查 SUPABASE_URL 和 SUPABASE_ANON_KEY 环境变量'));
			process.exit(1);
		}

		// 创建车队
		const result = await teamService.createTeam({
			name,
			user_name: userName,
		});

		if (Result.isFailure(result)) {
			console.error(pc.red(`❌ 创建车队失败: ${result.error}`));
			process.exit(1);
		}

		const { team, code } = result.value;

		console.log('');
		console.log(pc.green('✅ 车队创建成功！'));
		console.log('');
		console.log(pc.bold('📋 车队信息:'));
		console.log(`  名称: ${pc.yellow(team.name)}`);
		console.log(`  邀请码: ${pc.cyan(pc.bold(code))}`);
		console.log(`  创建者: ${pc.blue(userName)}`);
		console.log('');
		console.log(pc.gray('💡 分享邀请码给队友来加入车队'));
		console.log(pc.gray('💡 使用以下命令查看车队实时状态:'));
		console.log(pc.gray(`   ccusage team live`));
	},
});

/**
 * 加入车队命令
 */
export const teamJoinCommand = define({
	name: 'join',
	description: '使用邀请码加入车队',
	args: {
		code: {
			type: 'positional',
			description: '6位车队邀请码',
		},
		userName: {
			type: 'string',
			short: 'u',
			description: '用户名称',
			default: process.env.USER || 'User',
		},
	},
	async run(ctx) {
		const { code, userName } = ctx.values;

		if (!code) {
			console.error(pc.red('❌ 请提供车队邀请码'));
			console.error(pc.gray('用法: ccusage team join <邀请码>'));
			process.exit(1);
		}

		console.log(pc.cyan('🚗 加入车队中...'));

		// 测试数据库连接
		const connectionResult = await testSupabaseConnection();
		if (Result.isFailure(connectionResult)) {
			console.error(pc.red(`❌ 无法连接到数据库: ${connectionResult.error}`));
			console.error(pc.gray('请检查 SUPABASE_URL 和 SUPABASE_ANON_KEY 环境变量'));
			process.exit(1);
		}

		// 加入车队
		const result = await teamService.joinTeam({
			code,
			user_name: userName,
		});

		if (Result.isFailure(result)) {
			console.error(pc.red(`❌ 加入车队失败: ${result.error}`));
			process.exit(1);
		}

		const { team } = result.value;

		console.log('');
		console.log(pc.green('✅ 成功加入车队！'));
		console.log('');
		console.log(pc.bold('📋 车队信息:'));
		console.log(`  名称: ${pc.yellow(team.name)}`);
		console.log(`  成员: ${pc.blue(userName)}`);
		console.log('');
		console.log(pc.gray('💡 使用以下命令查看车队实时状态:'));
		console.log(pc.gray(`   ccusage team live`));
	},
});

/**
 * 车队列表命令
 */
export const teamListCommand = define({
	name: 'list',
	description: '查看我的车队列表',
	args: {
		userName: {
			type: 'string',
			short: 'u',
			description: '用户名称',
			default: process.env.USER || 'User',
		},
	},
	async run(ctx) {
		const { userName } = ctx.values;

		console.log(pc.cyan('🚗 获取车队列表...'));

		// 测试数据库连接
		const connectionResult = await testSupabaseConnection();
		if (Result.isFailure(connectionResult)) {
			console.error(pc.red(`❌ 无法连接到数据库: ${connectionResult.error}`));
			console.error(pc.gray('请检查 SUPABASE_URL 和 SUPABASE_ANON_KEY 环境变量'));
			process.exit(1);
		}

		// 获取车队列表
		const teamsResult = await teamService.getUserTeams(userName);
		if (Result.isFailure(teamsResult)) {
			console.error(pc.red(`❌ 查询车队失败: ${teamsResult.error}`));
			process.exit(1);
		}

		const teams = teamsResult.value;
		if (teams.length === 0) {
			console.error(pc.red('❌ 您还没有加入任何车队'));
			process.exit(1);
		}

		console.log('');
		console.log(pc.bold(`👥 我的车队 (${teams.length})`));
		console.log('');

		const table = new Table({
			head: ['车队名称', '加入时间', '状态'].map(h => pc.cyan(h)),
			style: { border: [], head: [] },
		});

		for (const { team, member } of teams) {
			const joinDate = new Date(member.joined_at).toLocaleDateString('zh-CN');
			const status = member.is_active ? pc.green('活跃') : pc.gray('已离开');

			table.push([
				pc.yellow(team.name),
				joinDate,
				status,
			]);
		}

		console.log(table.toString());
	},
});

/**
 * 车队成员命令
 */
export const teamMembersCommand = define({
	name: 'members',
	description: '查看车队成员列表',
	args: {
		teamName: {
			type: 'positional',
			description: '车队名称（可选，默认使用第一个车队）',
		},
		userName: {
			type: 'string',
			short: 'u',
			description: '用户名称',
			default: process.env.USER || 'User',
		},
	},
	async run(ctx) {
		const { teamName, userName } = ctx.values;

		console.log(pc.cyan('🚗 获取成员列表...'));

		// 测试数据库连接
		const connectionResult = await testSupabaseConnection();
		if (Result.isFailure(connectionResult)) {
			console.error(pc.red(`❌ 无法连接到数据库: ${connectionResult.error}`));
			console.error(pc.gray('请检查 SUPABASE_URL 和 SUPABASE_ANON_KEY 环境变量'));
			process.exit(1);
		}

		// 获取用户车队列表
		const teamsResult = await teamService.getUserTeams(userName);
		if (Result.isFailure(teamsResult)) {
			console.error(pc.red(`❌ 查询车队失败: ${teamsResult.error}`));
			process.exit(1);
		}

		const teams = teamsResult.value;
		if (teams.length === 0) {
			console.error(pc.red('❌ 您还没有加入任何车队'));
			process.exit(1);
		}

		// 选择车队
		let selectedTeam = teams[0];
		if (teamName) {
			const found = teams.find((t: any) => t.team.name === teamName);
			if (!found) {
				console.error(pc.red(`❌ 找不到车队: ${teamName}`));
				process.exit(1);
			}
			selectedTeam = found;
		}

		if (!selectedTeam) {
			console.error(pc.red('❌ 未能选择车队'));
			process.exit(1);
		}

		// 获取成员列表
		const membersResult = await teamService.getTeamMembers(selectedTeam.team.id);
		if (Result.isFailure(membersResult)) {
			console.error(pc.red(`❌ 查询成员失败: ${membersResult.error}`));
			process.exit(1);
		}

		const members = membersResult.value;

		console.log('');
		console.log(pc.bold(`👥 车队成员 - ${pc.yellow(selectedTeam.team.name)}`));
		console.log('');

		const table = new Table({
			head: ['成员名称', '加入时间', '使用偏好', '状态'].map(h => pc.cyan(h)),
			style: { border: [], head: [] },
		});

		for (const member of members) {
			const joinDate = new Date(member.joined_at).toLocaleDateString('zh-CN');
			const preference = member.settings.preferred_hours
				? getPreferredTimeDescription(member.settings.preferred_hours)
				: '未设置';
			const status = member.is_active ? pc.green('活跃') : pc.gray('已离开');

			table.push([
				pc.blue(member.user_name),
				joinDate,
				preference,
				status,
			]);
		}

		console.log(table.toString());
		console.log('');
		console.log(pc.gray(`💡 车队邀请码: ${pc.cyan(selectedTeam.team.code)}`));
	},
});

/**
 * 实时监控命令
 */
export const teamLiveCommand = define({
	name: 'live',
	description: '车队实时监控界面',
	args: {
		teamName: {
			type: 'positional',
			description: '车队名称（可选，默认使用第一个车队）',
		},
		userName: {
			type: 'string',
			short: 'u',
			description: '用户名称',
			default: process.env.USER || 'User',
		},
		refresh: {
			type: 'number',
			short: 'r',
			description: '刷新间隔（秒）',
			default: 5,
		},
		sync: {
			type: 'boolean',
			description: '启用数据同步',
			default: true,
		},
		syncInterval: {
			type: 'number',
			description: '数据同步间隔（秒）',
			default: 30,
		},
		tokenLimit: {
			type: 'number',
			description: 'Token使用限制（默认从数据库获取，等价$40）',
			default: undefined, // 将从数据库动态获取
		},
	},
	async run(ctx) {
		const { teamName, userName, refresh, sync, syncInterval, tokenLimit } = ctx.values;

		console.log(pc.cyan('🚗 启动增强版车队实时监控...'));

		// 解析和验证参数
		const refreshInterval = (refresh) * 1000;
		const syncIntervalMs = (syncInterval) * 1000;

		if (refreshInterval < 1000) {
			console.error(pc.red('❌ 刷新间隔必须是大于等于1的数字'));
			process.exit(1);
		}

		// 创建监控配置（从数据库获取默认值）
		const config = await createRecommendedConfig(userName, teamName as string | undefined);
		config.refreshInterval = refreshInterval;
		config.enableSync = sync;
		config.syncInterval = syncIntervalMs;

		// 如果用户指定了token限制，使用用户指定的值，否则使用从数据库获取的默认值
		if (tokenLimit !== undefined) {
			config.tokenLimit = tokenLimit;
		}

		// 验证配置
		const validationResult = validateMonitorConfig(config);
		if (Result.isFailure(validationResult)) {
			console.error(pc.red(`❌ 配置验证失败: ${validationResult.error}`));
			process.exit(1);
		}

		console.log(pc.gray('⚙️  配置信息:'));
		console.log(pc.gray(`   刷新间隔: ${refresh}秒`));
		console.log(pc.gray(`   数据同步: ${sync ? '启用' : '禁用'}`));
		if (sync) {
			console.log(pc.gray(`   同步间隔: ${syncInterval}秒`));
		}
		console.log(pc.gray(`   Token限制: ${(config.tokenLimit || 100000000).toLocaleString()}`));
		console.log('');

		// 启动监控
		const monitorResult = await startEnhancedTeamLiveMonitor(config);
		if (Result.isFailure(monitorResult)) {
			console.error(pc.red(`❌ 启动监控失败: ${monitorResult.error}`));
			process.exit(1);
		}
	},
});

/**
 * 离开车队命令
 */
export const teamLeaveCommand = define({
	name: 'leave',
	description: '离开车队',
	args: {
		teamName: {
			type: 'positional',
			description: '车队名称（可选，默认使用第一个车队）',
		},
		userName: {
			type: 'string',
			short: 'u',
			description: '用户名称',
			default: process.env.USER || 'User',
		},
		yes: {
			type: 'boolean',
			short: 'y',
			description: '跳过确认提示',
			default: false,
		},
	},
	async run(ctx) {
		const { teamName, userName, yes } = ctx.values;

		// 测试数据库连接
		const connectionResult = await testSupabaseConnection();
		if (Result.isFailure(connectionResult)) {
			console.error(pc.red(`❌ 无法连接到数据库: ${connectionResult.error}`));
			console.error(pc.gray('请检查 SUPABASE_URL 和 SUPABASE_ANON_KEY 环境变量'));
			process.exit(1);
		}

		// 获取用户车队列表
		const teamsResult = await teamService.getUserTeams(userName);
		if (Result.isFailure(teamsResult)) {
			console.error(pc.red(`❌ 查询车队失败: ${teamsResult.error}`));
			process.exit(1);
		}

		const teams = teamsResult.value;
		if (teams.length === 0) {
			console.error(pc.red('❌ 您还没有加入任何车队'));
			process.exit(1);
		}

		// 选择车队
		let selectedTeam = teams[0];
		if (teamName) {
			const found = teams.find((t: any) => t.team.name === teamName);
			if (!found) {
				console.error(pc.red(`❌ 找不到车队: ${teamName}`));
				process.exit(1);
			}
			selectedTeam = found;
		}

		if (!selectedTeam) {
			console.error(pc.red('❌ 未能选择车队'));
			process.exit(1);
		}

		// 确认提示
		if (!yes) {
			console.log(pc.yellow(`⚠️  您确定要离开车队 "${selectedTeam.team.name}" 吗？`));
			console.log(pc.gray('此操作无法撤销，您需要重新获取邀请码才能再次加入。'));
			console.log('');
			console.log(pc.gray('如需确认，请添加 --yes 或 -y 参数重新运行命令'));
			process.exit(0);
		}

		// 离开车队
		const result = await teamService.leaveTeam(selectedTeam.team.id, userName);
		if (Result.isFailure(result)) {
			console.error(pc.red(`❌ 离开车队失败: ${result.error}`));
			process.exit(1);
		}

		console.log('');
		console.log(pc.green('✅ 成功离开车队'));
		console.log('');
		console.log(pc.bold('📋 车队信息:'));
		console.log(`车队: ${pc.yellow(selectedTeam.team.name)}`);
		console.log(`用户: ${pc.blue(userName)}`);
		console.log('');
		console.log(pc.gray('💡 如需重新加入，请联系车队成员获取邀请码'));
	},
});

/**
 * 主车队命令 - 显示帮助信息
 */
export const teamCommand = define({
	name: 'team',
	description: '车队管理功能',
	async run() {
		// 显示帮助信息
		console.log(pc.bold('🚗 Claude 拼车管理'));
		console.log('');
		console.log('使用以下命令管理您的车队:');
		console.log('');
		console.log(`${pc.cyan('  team create <name>     ')}创建新车队`);
		console.log(`${pc.cyan('  team join <code>       ')}使用邀请码加入车队`);
		console.log(`${pc.cyan('  team list              ')}查看我的车队列表`);
		console.log(`${pc.cyan('  team members [name]    ')}查看车队成员`);
		console.log(`${pc.cyan('  team live [name]       ')}车队实时监控`);
		console.log(`${pc.cyan('  team leave [name]      ')}离开车队`);
		console.log('');
		console.log(pc.gray('💡 提示: 使用 --help 查看各命令的详细用法'));
	},
});

if (import.meta.vitest != null) {
	describe('车队命令', () => {
		it('应该导出主命令', () => {
			expect(teamCommand).toBeDefined();
			expect(teamCommand.name).toBe('team');
		});

		it('应该导出所有子命令', () => {
			expect(teamCreateCommand).toBeDefined();
			expect(teamJoinCommand).toBeDefined();
			expect(teamListCommand).toBeDefined();
			expect(teamMembersCommand).toBeDefined();
			expect(teamLiveCommand).toBeDefined();
			expect(teamLeaveCommand).toBeDefined();
		});

		it('应该正确解析偏好时段', () => {
			expect(getPreferredTimeDescription([9, 10, 11])).toBe('上午使用偏好');
			expect(getPreferredTimeDescription([14, 15, 16])).toBe('下午使用偏好');
			expect(getPreferredTimeDescription([6, 12, 18, 0])).toBe('全天使用');
			expect(getPreferredTimeDescription([])).toBe('未设置');
		});
	});
}
