/**
 * @fileoverview 更新检测功能
 *
 * 检查npm上发布的版本是否领先于当前版本，提示用户更新
 */

import { Result } from '@praha/byethrow';
import { logger } from './logger.ts';

/**
 * npm registry API响应类型
 */
type NpmRegistryResponse = {
	'dist-tags': {
		latest: string;
		[key: string]: string;
	};
	'versions': Record<string, any>;
};

/**
 * 版本比较结果
 */
export type VersionCheckResult = {
	currentVersion: string;
	latestVersion: string;
	hasUpdate: boolean;
	updateAvailable?: {
		newVersion: string;
		releaseNotes?: string;
	};
};

/**
 * 从package.json获取当前版本
 */
async function getCurrentVersion(): Promise<Result.Result<string, string>> {
	try {
		// 在构建后的dist中，需要从上级目录读取package.json
		const packageJsonPath = new URL('../package.json', import.meta.url);

		// 兼容Node.js和Bun环境
		let packageJsonText: string;
		if (typeof Bun !== 'undefined') {
			// Bun环境
			packageJsonText = await Bun.file(packageJsonPath).text();
		}
		else {
			// Node.js环境
			const fs = await import('node:fs/promises');
			packageJsonText = await fs.readFile(packageJsonPath, 'utf-8');
		}

		const packageJson = JSON.parse(packageJsonText);
		return Result.succeed(packageJson.version as string);
	}
	catch (error) {
		return Result.fail(`无法读取当前版本: ${error}`);
	}
}

/**
 * 从npm registry获取最新版本信息
 */
async function getLatestVersionFromNpm(packageName: string): Promise<Result.Result<string, string>> {
	try {
		const response = await fetch(`https://registry.npmjs.org/${packageName}`, {
			headers: {
				'Accept': 'application/json',
				'User-Agent': 'ccusage-live-update-checker',
			},
		});

		if (!response.ok) {
			return Result.fail(`npm registry请求失败: ${response.status} ${response.statusText}`);
		}

		const data = await response.json() as NpmRegistryResponse;
		const latestVersion = data['dist-tags']?.latest;

		if (!latestVersion) {
			return Result.fail('无法从npm registry获取最新版本信息');
		}

		return Result.succeed(latestVersion);
	}
	catch (error) {
		return Result.fail(`获取npm版本信息失败: ${error}`);
	}
}

/**
 * 比较两个语义化版本
 * @param currentVersion 当前版本
 * @param latestVersion 最新版本
 * @returns 如果最新版本更高则返回true
 */
function compareVersions(currentVersion: string, latestVersion: string): boolean {
	const current = currentVersion.replace(/^v/, '').split('.').map(Number);
	const latest = latestVersion.replace(/^v/, '').split('.').map(Number);

	for (let i = 0; i < Math.max(current.length, latest.length); i++) {
		const currentPart = current[i] || 0;
		const latestPart = latest[i] || 0;

		if (latestPart > currentPart) {
			return true;
		}
		if (latestPart < currentPart) {
			return false;
		}
	}

	return false;
}

/**
 * 检查是否有可用更新
 */
export async function checkForUpdates(packageName = 'ccusage-live', silent = false): Promise<Result.Result<VersionCheckResult, string>> {
	const currentVersionResult = await getCurrentVersion();
	if (Result.isFailure(currentVersionResult)) {
		return Result.fail(currentVersionResult.error);
	}

	const currentVersion = currentVersionResult.value;

	if (!silent) {
		logger.info('检查更新中...');
	}

	const latestVersionResult = await getLatestVersionFromNpm(packageName);
	if (Result.isFailure(latestVersionResult)) {
		return Result.fail(latestVersionResult.error);
	}

	const latestVersion = latestVersionResult.value;
	const hasUpdate = compareVersions(currentVersion, latestVersion);

	const result: VersionCheckResult = {
		currentVersion,
		latestVersion,
		hasUpdate,
	};

	if (hasUpdate) {
		result.updateAvailable = {
			newVersion: latestVersion,
		};
	}

	return Result.succeed(result);
}

/**
 * 显示更新提示信息
 */
export function showUpdateNotification(versionCheck: VersionCheckResult, packageName = 'ccusage-live'): void {
	if (!versionCheck.hasUpdate) {
		logger.info(`✅ 已是最新版本 (${versionCheck.currentVersion})`);
		return;
	}

	const { currentVersion, latestVersion } = versionCheck;

	console.log('');
	logger.warn(`🔄 发现新版本可用!`);
	logger.info(`   当前版本: ${currentVersion}`);
	logger.info(`   最新版本: ${latestVersion}`);
	console.log('');
	logger.info('📦 更新命令:');
	logger.info(`   npm update -g ${packageName}`);
	logger.info('   # 或者');
	logger.info(`   bun install -g ${packageName}@latest`);
	console.log('');
}

/**
 * 执行更新检查并显示结果
 */
export async function performUpdateCheck(packageName?: string, silent = false): Promise<void> {
	const result = await checkForUpdates(packageName, silent);

	if (Result.isFailure(result)) {
		if (!silent) {
			logger.error(`更新检查失败: ${result.error}`);
		}
		return;
	}

	if (!silent) {
		showUpdateNotification(result.value, packageName);
	}
}

if (import.meta.vitest != null) {
	describe('更新检测功能', () => {
		it('应该正确比较版本号', () => {
			expect(compareVersions('1.0.0', '1.0.1')).toBe(true);
			expect(compareVersions('1.0.1', '1.0.0')).toBe(false);
			expect(compareVersions('1.0.0', '1.0.0')).toBe(false);
			expect(compareVersions('1.0.0', '1.1.0')).toBe(true);
			expect(compareVersions('2.0.0', '1.9.9')).toBe(false);
			expect(compareVersions('1.0.0', '2.0.0')).toBe(true);
		});

		it('应该处理v前缀的版本号', () => {
			expect(compareVersions('v1.0.0', '1.0.1')).toBe(true);
			expect(compareVersions('1.0.0', 'v1.0.1')).toBe(true);
			expect(compareVersions('v1.0.0', 'v1.0.1')).toBe(true);
		});

		it('应该处理不同长度的版本号', () => {
			expect(compareVersions('1.0', '1.0.1')).toBe(true);
			expect(compareVersions('1.0.1', '1.0')).toBe(false);
			expect(compareVersions('1', '1.0.1')).toBe(true);
		});
	});
}
