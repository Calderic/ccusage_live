/**
 * @fileoverview Supabase 客户端配置和初始化
 *
 * 提供 Supabase 数据库连接和基本的 CRUD 操作封装，
 * 包括错误处理和类型安全的数据访问。
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './_team-types.ts';
import process from 'node:process';
import { Result } from '@praha/byethrow';
import { createClient } from '@supabase/supabase-js';
import { getConfig, validateConfig } from '../config/default-config.ts';
import { logger } from '../logger.ts';

/**
 * Supabase 配置
 */
type SupabaseConfig = {
	url: string;
	anonKey: string;
};

/**
 * 获取 Supabase 配置（优先环境变量，fallback到预设配置）
 */
function getSupabaseConfig(): Result.Result<SupabaseConfig, string> {
	const config = getConfig();

	// 验证配置
	const validation = validateConfig(config);
	if (!validation.valid) {
		return Result.fail(`配置验证失败: ${validation.errors.join(', ')}`);
	}

	return Result.succeed({
		url: config.supabase.url,
		anonKey: config.supabase.anonKey,
	});
}

/**
 * Supabase 客户端单例
 */
let supabaseClient: SupabaseClient<Database> | null = null;

/**
 * 获取 Supabase 客户端实例
 * @returns Supabase 客户端或错误信息
 */
export function getSupabaseClient(): Result.Result<SupabaseClient<Database>, string> {
	if (supabaseClient) {
		return Result.succeed(supabaseClient);
	}

	const configResult = getSupabaseConfig();
	if (Result.isFailure(configResult)) {
		return Result.fail(`Supabase配置错误: ${configResult.error}`);
	}

	try {
		supabaseClient = createClient<Database>(
			configResult.value.url,
			configResult.value.anonKey,
			{
				auth: {
					persistSession: false, // CLI工具不需要持久化会话
				},
				db: {
					schema: 'public',
				},
			},
		);

		logger.debug('Supabase客户端初始化成功');
		return Result.succeed(supabaseClient);
	}
	catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error(`Supabase客户端初始化失败: ${errorMessage}`);
		return Result.fail(`Supabase客户端初始化失败: ${errorMessage}`);
	}
}

/**
 * 测试 Supabase 连接
 * @returns 连接测试结果
 */
export async function testSupabaseConnection(): Promise<Result.Result<boolean, string>> {
	const clientResult = getSupabaseClient();
	if (Result.isFailure(clientResult)) {
		return Result.fail(clientResult.error);
	}

	try {
		// 简单的连接测试 - 尝试查询 teams 表
		const { error } = await clientResult.value
			.from('teams')
			.select('id')
			.limit(1);

		if (error) {
			logger.error(`Supabase连接测试失败: ${error.message}`);
			return Result.fail(`数据库连接失败: ${error.message}`);
		}

		logger.debug('Supabase连接测试成功');
		return Result.succeed(true);
	}
	catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error(`Supabase连接测试异常: ${errorMessage}`);
		return Result.fail(`连接测试异常: ${errorMessage}`);
	}
}

/**
 * 清理 Supabase 客户端（主要用于测试）
 */
export function clearSupabaseClient(): void {
	supabaseClient = null;
}

/**
 * 带重试的数据库操作包装器
 * @param operation 数据库操作函数
 * @param maxRetries 最大重试次数
 * @param retryDelay 重试延迟（毫秒）
 * @returns 操作结果
 */
export async function withRetry<T>(
	operation: () => Promise<T>,
	maxRetries = 3,
	retryDelay = 1000,
): Promise<Result.Result<T, string>> {
	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			const result = await operation();
			return Result.succeed(result);
		}
		catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			logger.debug(`数据库操作失败 (尝试 ${attempt}/${maxRetries}): ${lastError.message}`);

			if (attempt < maxRetries) {
				await new Promise(resolve => setTimeout(resolve, retryDelay));
			}
		}
	}

	const errorMessage = lastError?.message ?? '未知错误';
	logger.error(`数据库操作最终失败: ${errorMessage}`);
	return Result.fail(`数据库操作失败: ${errorMessage}`);
}

/**
 * 格式化 Supabase 错误信息为用户友好的中文消息
 * @param error Supabase 错误对象
 * @returns 格式化后的错误信息
 */
export function formatSupabaseError(error: { code?: string; message: string }): string {
	const { code, message } = error;

	// 常见错误代码的中文映射
	const errorMappings: Record<string, string> = {
		'23505': '数据已存在，无法重复创建',
		'23503': '关联数据不存在',
		'42P01': '数据表不存在',
		'42703': '字段不存在',
		'23502': '必填字段不能为空',
		'PGRST116': '数据未找到',
		'PGRST301': '权限不足',
	};

	if (code && errorMappings[code]) {
		return errorMappings[code];
	}

	// 通用错误处理
	if (message.includes('duplicate key')) {
		return '数据已存在，请检查唯一性约束';
	}

	if (message.includes('foreign key')) {
		return '关联数据错误，请检查数据完整性';
	}

	if (message.includes('not found')) {
		return '请求的数据不存在';
	}

	if (message.includes('permission')) {
		return '权限不足，无法执行此操作';
	}

	// 返回原始错误信息作为后备
	return message;
}

if (import.meta.vitest != null) {
	describe('Supabase客户端', () => {
		beforeEach(() => {
			clearSupabaseClient();
		});

		it('应该在缺少环境变量时返回错误', () => {
			delete process.env.SUPABASE_URL;
			delete process.env.SUPABASE_ANON_KEY;

			const result = getSupabaseClient();
			expect(Result.isFailure(result)).toBe(true);
			if (Result.isFailure(result)) {
				expect(result.error).toContain('SUPABASE_URL');
			}
		});

		it('应该在有效配置下创建客户端', () => {
			process.env.SUPABASE_URL = 'https://test.supabase.co';
			process.env.SUPABASE_ANON_KEY = 'test-key';

			const result = getSupabaseClient();
			expect(Result.isSuccess(result)).toBe(true);
		});

		it('应该正确格式化错误信息', () => {
			expect(formatSupabaseError({ code: '23505', message: 'duplicate key' }))
				.toBe('数据已存在，无法重复创建');

			expect(formatSupabaseError({ message: 'custom error' }))
				.toBe('custom error');
		});

		it('应该实现重试机制', async () => {
			let attempts = 0;
			const operation = async () => {
				attempts++;
				if (attempts < 3) {
					throw new Error('测试错误');
				}
				return '成功';
			};

			const result = await withRetry(operation, 3, 10);
			expect(Result.isSuccess(result)).toBe(true);
			expect(attempts).toBe(3);
		});
	});
}
