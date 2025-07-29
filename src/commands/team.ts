/**
 * @fileoverview 车队管理命令
 *
 * 提供车队相关的 CLI 命令，包括创建车队、加入车队、
 * 查看车队信息、实时监控等功能。
 */

import { command } from 'gunshi';
import { Result } from '@praha/byethrow';
import pc from 'picocolors';
import Table from 'cli-table3';
import process from 'node:process';
import { teamService } from '../team/team-service.ts';
import { testSupabaseConnection } from '../team/supabase-client.ts';
import type { TeamAggregatedStats } from '../team/_team-types.ts';
import { startTeamLiveMonitoring } from '../team/_team-live-rendering.ts';
import { logger } from '../logger.ts';

/**
 * 创建车队命令
 */
const createCommand = command()
	.name('create')
	.description('创建新的车队')
	.argument('<name>', '车队名称')
	.option('-u, --user-name <name>', '用户名称', process.env.USER || 'User')
	.action(async (name: string, options: { userName: string }) => {
		console.log(pc.cyan('🚗 正在创建车队...'));

		// 测试数据库连接
		const connectionResult = await testSupabaseConnection();
		if (Result.isFailure(connectionResult)) {
			console.error(pc.red(`❌ 数据库连接失败: ${connectionResult.error}`));
			console.log(pc.yellow('\n💡 请确保已正确配置 Supabase 环境变量:'));
			console.log('  export SUPABASE_URL="your-supabase-url"');
			console.log('  export SUPABASE_ANON_KEY="your-supabase-anon-key"');
			process.exit(1);
		}

		const result = await teamService.createTeam({
			name,
			user_name: options.userName,
		});

		if (Result.isFailure(result)) {
			console.error(pc.red(`❌ 创建车队失败: ${result.error}`));
			process.exit(1);
		}

		const { team, code } = result.data;
		
		console.log('');
		console.log(pc.green('✅ 车队创建成功！'));
		console.log('');
		console.log(pc.bold('📋 车队信息:'));
		console.log(`  名称: ${pc.yellow(team.name)}`);
		console.log(`  邀请码: ${pc.cyan(pc.bold(code))}`);
		console.log(`  创建者: ${pc.blue(options.userName)}`);
		console.log('');
		console.log(pc.gray('💡 分享邀请码给队友，让他们使用以下命令加入:'));
		console.log(pc.gray(`   ccusage team join ${code}`));
	});

/**
 * 加入车队命令
 */
const joinCommand = command()
	.name('join')
	.description('使用邀请码加入车队')
	.argument('<code>', '6位车队邀请码')
	.option('-u, --user-name <name>', '用户名称', process.env.USER || 'User')
	.action(async (code: string, options: { userName: string }) => {
		console.log(pc.cyan('🚗 正在加入车队...'));

		// 测试数据库连接
		const connectionResult = await testSupabaseConnection();
		if (Result.isFailure(connectionResult)) {
			console.error(pc.red(`❌ 数据库连接失败: ${connectionResult.error}`));
			process.exit(1);
		}

		const result = await teamService.joinTeam({
			code: code.toUpperCase(),
			user_name: options.userName,
		});

		if (Result.isFailure(result)) {
			console.error(pc.red(`❌ 加入车队失败: ${result.error}`));
			process.exit(1);
		}

		const { team } = result.data;
		
		console.log('');
		console.log(pc.green('✅ 成功加入车队！'));
		console.log('');
		console.log(pc.bold('📋 车队信息:'));
		console.log(`  名称: ${pc.yellow(team.name)}`);
		console.log(`  成员: ${pc.blue(options.userName)}`);
		console.log('');
		console.log(pc.gray('💡 使用以下命令查看车队实时状态:'));
		console.log(pc.gray('   ccusage team live'));
	});

/**
 * 查看车队列表命令
 */
const listCommand = command()
	.name('list')
	.description('查看我的车队列表')
	.option('-u, --user-name <name>', '用户名称', process.env.USER || 'User')
	.action(async (options: { userName: string }) => {
		console.log(pc.cyan('🚗 正在查询车队列表...'));

		const result = await teamService.getUserTeams(options.userName);

		if (Result.isFailure(result)) {
			console.error(pc.red(`❌ 查询车队失败: ${result.error}`));
			process.exit(1);
		}

		const teams = result.data;

		if (teams.length === 0) {
			console.log('');
			console.log(pc.yellow('📝 您还没有加入任何车队'));
			console.log('');
			console.log(pc.gray('💡 使用以下命令创建或加入车队:'));
			console.log(pc.gray('   ccusage team create "车队名称"'));
			console.log(pc.gray('   ccusage team join <邀请码>'));
			return;
		}

		console.log('');
		console.log(pc.bold('📋 我的车队列表:'));
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
		console.log('');
		console.log(pc.gray('💡 使用以下命令查看车队详情:'));
		console.log(pc.gray('   ccusage team members <车队名称>'));
		console.log(pc.gray('   ccusage team live <车队名称>'));
	});

/**
 * 查看车队成员命令
 */
const membersCommand = command()
	.name('members')
	.description('查看车队成员列表')
	.argument('[team-name]', '车队名称（可选，默认使用第一个车队）')
	.option('-u, --user-name <name>', '用户名称', process.env.USER || 'User')
	.action(async (teamName: string | undefined, options: { userName: string }) => {
		console.log(pc.cyan('👥 正在查询车队成员...'));

		// 获取用户车队列表
		const teamsResult = await teamService.getUserTeams(options.userName);
		if (Result.isFailure(teamsResult)) {
			console.error(pc.red(`❌ 查询车队失败: ${teamsResult.error}`));
			process.exit(1);
		}

		const teams = teamsResult.data;
		if (teams.length === 0) {
			console.error(pc.red('❌ 您还没有加入任何车队'));
			process.exit(1);
		}

		// 选择车队
		let selectedTeam = teams[0];
		if (teamName) {
			const found = teams.find(t => t.team.name === teamName);
			if (!found) {
				console.error(pc.red(`❌ 找不到车队: ${teamName}`));
				process.exit(1);
			}
			selectedTeam = found;
		}

		// 获取成员列表
		const membersResult = await teamService.getTeamMembers(selectedTeam.team.id);
		if (Result.isFailure(membersResult)) {
			console.error(pc.red(`❌ 查询成员失败: ${membersResult.error}`));
			process.exit(1);
		}

		const members = membersResult.data;

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
	});

/**
 * 车队实时监控命令
 */
const liveCommand = command()
	.name('live')
	.description('车队实时监控界面')
	.argument('[team-name]', '车队名称（可选，默认使用第一个车队）')
	.option('-u, --user-name <name>', '用户名称', process.env.USER || 'User')
	.option('-r, --refresh <seconds>', '刷新间隔（秒）', '5')
	.action(async (teamName: string | undefined, options: { userName: string; refresh: string }) => {
		console.log(pc.cyan('🚗 启动车队实时监控...'));

		// 测试数据库连接
		const connectionResult = await testSupabaseConnection();
		if (Result.isFailure(connectionResult)) {
			console.error(pc.red(`❌ 数据库连接失败: ${connectionResult.error}`));
			process.exit(1);
		}

		// 获取用户车队列表
		const teamsResult = await teamService.getUserTeams(options.userName);
		if (Result.isFailure(teamsResult)) {
			console.error(pc.red(`❌ 查询车队失败: ${teamsResult.error}`));
			process.exit(1);
		}

		const teams = teamsResult.data;
		if (teams.length === 0) {
			console.error(pc.red('❌ 您还没有加入任何车队'));
			process.exit(1);
		}

		// 选择车队
		let selectedTeam = teams[0];
		if (teamName) {
			const found = teams.find(t => t.team.name === teamName);
			if (!found) {
				console.error(pc.red(`❌ 找不到车队: ${teamName}`));
				process.exit(1);
			}
			selectedTeam = found;
		}

		const refreshInterval = parseInt(options.refresh, 10) * 1000;
		if (isNaN(refreshInterval) || refreshInterval < 1000) {
			console.error(pc.red('❌ 刷新间隔必须是大于等于1的数字'));
			process.exit(1);
		}

		console.log(pc.green(`✅ 开始监控车队: ${selectedTeam.team.name}`));
		console.log(pc.gray('按 Ctrl+C 退出监控'));
		console.log('');

		// 启动实时监控
		await startTeamLiveMonitoring({
			teamId: selectedTeam.team.id,
			teamName: selectedTeam.team.name,
			refreshInterval,
		});
	});

/**
 * 离开车队命令
 */
const leaveCommand = command()
	.name('leave')
	.description('离开车队')
	.argument('[team-name]', '车队名称（可选，默认使用第一个车队）')
	.option('-u, --user-name <name>', '用户名称', process.env.USER || 'User')
	.option('-y, --yes', '跳过确认提示')
	.action(async (teamName: string | undefined, options: { userName: string; yes: boolean }) => {
		// 获取用户车队列表
		const teamsResult = await teamService.getUserTeams(options.userName);
		if (Result.isFailure(teamsResult)) {
			console.error(pc.red(`❌ 查询车队失败: ${teamsResult.error}`));
			process.exit(1);
		}

		const teams = teamsResult.data;
		if (teams.length === 0) {
			console.error(pc.red('❌ 您还没有加入任何车队'));
			process.exit(1);
		}

		// 选择车队
		let selectedTeam = teams[0];
		if (teamName) {
			const found = teams.find(t => t.team.name === teamName);
			if (!found) {
				console.error(pc.red(`❌ 找不到车队: ${teamName}`));
				process.exit(1);
			}
			selectedTeam = found;
		}

		// 确认提示
		if (!options.yes) {
			console.log(pc.yellow(`⚠️  您确定要离开车队 "${selectedTeam.team.name}" 吗？`));
			console.log(pc.gray('此操作将停止同步您的使用数据到该车队。'));
			console.log('');
			console.log(pc.gray('要继续，请重新运行命令并添加 --yes 参数'));
			return;
		}

		console.log(pc.cyan('🚗 正在离开车队...'));

		const result = await teamService.leaveTeam(selectedTeam.team.id, options.userName);
		if (Result.isFailure(result)) {
			console.error(pc.red(`❌ 离开车队失败: ${result.error}`));
			process.exit(1);
		}

		console.log('');
		console.log(pc.green('✅ 已成功离开车队'));
		console.log(`车队: ${pc.yellow(selectedTeam.team.name)}`);
	});

/**
 * 获取偏好时段描述（临时实现，应该从 _team-types.ts 导入）
 */
function getPreferredTimeDescription(hours?: number[]): string {
	if (!hours || hours.length === 0) {
		return '未设置';
	}

	const morningHours = hours.filter(h => h >= 6 && h < 12);
	const afternoonHours = hours.filter(h => h >= 12 && h < 18);
	const eveningHours = hours.filter(h => h >= 18 && h < 24);
	const nightHours = hours.filter(h => h >= 0 && h < 6);

	const periods = [];
	if (morningHours.length > 0) periods.push('上午');
	if (afternoonHours.length > 0) periods.push('下午');
	if (eveningHours.length > 0) periods.push('晚上');
	if (nightHours.length > 0) periods.push('深夜');

	if (periods.length === 0) return '未设置';
	if (periods.length >= 3) return '全天使用';

	return periods.join('、') + '使用偏好';
}

/**
 * 主车队命令，包含所有子命令
 */
export const teamCommand = command()
	.name('team')
	.description('车队管理功能')
	.subcommand(createCommand)
	.subcommand(joinCommand)
	.subcommand(listCommand)
	.subcommand(membersCommand)
	.subcommand(liveCommand)
	.subcommand(leaveCommand)
	.action(() => {
		console.log(pc.bold('🚗 Claude 拼车管理'));
		console.log('');
		console.log('使用以下命令管理您的车队:');
		console.log('');
		console.log(pc.cyan('  create <name>    ') + '创建新车队');
		console.log(pc.cyan('  join <code>      ') + '使用邀请码加入车队');
		console.log(pc.cyan('  list             ') + '查看我的车队列表');
		console.log(pc.cyan('  members [name]   ') + '查看车队成员');
		console.log(pc.cyan('  live [name]      ') + '车队实时监控');
		console.log(pc.cyan('  leave [name]     ') + '离开车队');
		console.log('');
		console.log(pc.gray('💡 提示: 使用 --help 查看各命令的详细用法'));
	});

if (import.meta.vitest != null) {
	describe('车队命令', () => {
		it('应该导出主命令', () => {
			expect(teamCommand).toBeDefined();
			expect(teamCommand.name).toBe('team');
		});

		it('应该包含所有子命令', () => {
			const subcommands = teamCommand.subcommands;
			const commandNames = Array.from(subcommands.keys());
			
			expect(commandNames).toContain('create');
			expect(commandNames).toContain('join');
			expect(commandNames).toContain('list');
			expect(commandNames).toContain('members');
			expect(commandNames).toContain('live');
			expect(commandNames).toContain('leave');
		});

		it('应该正确解析偏好时段', () => {
			expect(getPreferredTimeDescription([9, 10, 11])).toBe('上午使用偏好');
			expect(getPreferredTimeDescription([14, 15, 16])).toBe('下午使用偏好');
			expect(getPreferredTimeDescription([6, 12, 18, 0])).toBe('全天使用');
			expect(getPreferredTimeDescription([])).toBe('未设置');
		});
	});
}