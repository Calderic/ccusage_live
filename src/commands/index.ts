import process from 'node:process';
import { cli } from 'gunshi';
import { description, name, version } from '../../package.json';
import { blocksCommand } from './blocks.ts';
import { dailyCommand } from './daily.ts';
import { interactiveCommand } from './interactive.ts';
import { mcpCommand } from './mcp.ts';
import { monthlyCommand } from './monthly.ts';
import { sessionCommand } from './session.ts';
import {
	teamCommand,
	teamCreateCommand,
	teamJoinCommand,
	teamLeaveCommand,
	teamListCommand,
	teamLiveCommand,
	teamMembersCommand,
} from './team.ts';

/**
 * Map of available CLI subcommands
 */
const subCommands = new Map();
subCommands.set('daily', dailyCommand);
subCommands.set('monthly', monthlyCommand);
subCommands.set('session', sessionCommand);
subCommands.set('blocks', blocksCommand);
subCommands.set('mcp', mcpCommand);
subCommands.set('team', teamCommand);

// 车队子命令
subCommands.set('team create', teamCreateCommand);
subCommands.set('team join', teamJoinCommand);
subCommands.set('team list', teamListCommand);
subCommands.set('team members', teamMembersCommand);
subCommands.set('team live', teamLiveCommand);
subCommands.set('team leave', teamLeaveCommand);

/**
 * Default command when no subcommand is specified
 * 启动交互式菜单
 */
const mainCommand = {
	name: 'main',
	description: 'Interactive menu for ccusage-live',
	async run() {
		return interactiveCommand();
	},
};

// eslint-disable-next-line antfu/no-top-level-await
await cli(process.argv.slice(2), mainCommand, {
	name,
	version,
	description,
	subCommands,
	renderHeader: null,
});
