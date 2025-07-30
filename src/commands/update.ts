/**
 * @fileoverview Update command for ccusage-live CLI
 *
 * Checks for available updates from npm registry and displays update information
 */

import { define } from 'gunshi';
import { performUpdateCheck } from '../update-checker.ts';

/**
 * Update检查命令
 */
export const updateCommand = define({
	name: 'update',
	description: '检查是否有可用的软件更新',
	args: {
		silent: {
			type: 'boolean',
			short: 's',
			description: '静默模式，不显示详细信息',
		},
		package: {
			type: 'string',
			short: 'p',
			description: '指定要检查的npm包名 (默认: ccusage-live)',
		},
	},
	async run(ctx) {
		const silent = ctx.values.silent || false;
		const packageName = ctx.values.package || 'ccusage-live';

		await performUpdateCheck(packageName, silent);
	},
});
