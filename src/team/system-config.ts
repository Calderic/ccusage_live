/**
 * @fileoverview 系统配置管理器
 *
 * 负责从数据库获取系统配置，包括token阈值、费用警告线等
 */

import { Result } from '@praha/byethrow';
import { logger } from '../logger.ts';
import { PricingFetcher } from '../pricing-fetcher.ts';
import { getSupabaseClient } from './supabase-client.ts';

/**
 * 系统配置类型定义
 */
export type SystemConfig = {
	token_limits: {
		per_session: number;
		daily: number;
		monthly: number;
	};
	cost_warning_levels: {
		level1: number; // 0.8 = 80%
		level2: number; // 0.9 = 90%
		critical: number; // 1.0 = 100%
	};
	burn_rate_thresholds: {
		high: number;
		moderate: number;
		normal: number;
	};
	notification_settings: {
		email_enabled: boolean;
		slack_enabled: boolean;
	};
	system_limits: {
		max_teams_per_user: number;
		max_members_per_team: number;
	};
	default_token_threshold: {
		tokens: number;
		usd_equivalent: number;
		pricing_method: 'litellm_dynamic' | 'fixed';
		calculation_note: string;
	};
	pricing_config?: {
		use_litellm: boolean;
		target_usd_amount: number;
		fallback_tokens: number;
		claude_max_plan: boolean;
	};
};

/**
 * 默认配置（作为fallback使用）
 */
const DEFAULT_CONFIG: SystemConfig = {
	token_limits: {
		per_session: 100000000, // ClaudeMax计划fallback: 100M tokens
		daily: 500000000, // 500M tokens per day
		monthly: 15000000000, // 15B tokens per month
	},
	cost_warning_levels: {
		level1: 0.8, // 80%
		level2: 0.9, // 90%
		critical: 1.0, // 100%
	},
	burn_rate_thresholds: {
		high: 1000,
		moderate: 500,
		normal: 100,
	},
	notification_settings: {
		email_enabled: true,
		slack_enabled: false,
	},
	system_limits: {
		max_teams_per_user: 10,
		max_members_per_team: 50,
	},
	default_token_threshold: {
		tokens: 100000000, // ClaudeMax计划fallback
		usd_equivalent: 40.0,
		pricing_method: 'litellm_dynamic',
		calculation_note: 'ClaudeMax plan fallback, should calculate from LiteLLM pricing',
	},
	pricing_config: {
		use_litellm: true,
		target_usd_amount: 40.0,
		fallback_tokens: 100000000,
		claude_max_plan: true,
	},
};

/**
 * 系统配置管理器
 */
export class SystemConfigManager {
	private cachedConfig: SystemConfig | null = null;
	private cacheExpiry: number = 0;
	private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5分钟缓存

	// 动态token计算缓存（网络优先，缓存复用）
	private cachedDynamicTokens: number | null = null;
	private dynamicTokensCacheExpiry: number = 0;
	private readonly DYNAMIC_TOKENS_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2小时缓存，避免重复网络调用

	// 复用PricingFetcher实例，避免每次重新创建和丢失缓存
	private pricingFetcher: PricingFetcher | null = null;

	/**
	 * 获取系统配置
	 */
	async getConfig(): Promise<Result.Result<SystemConfig, string>> {
		// 检查缓存
		if (this.cachedConfig && Date.now() < this.cacheExpiry) {
			return Result.succeed(this.cachedConfig);
		}

		try {
			// 尝试从数据库获取配置
			const configResult = await this.fetchConfigFromDatabase();

			if (Result.isSuccess(configResult)) {
				this.cachedConfig = configResult.value;
				this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
				return Result.succeed(this.cachedConfig);
			}

			// 数据库获取失败，使用默认配置
			logger.warn('Failed to fetch system config from database, using defaults:', configResult.error);
			return Result.succeed(DEFAULT_CONFIG);
		}
		catch (error) {
			logger.warn('Error fetching system config, using defaults:', error);
			return Result.succeed(DEFAULT_CONFIG);
		}
	}

	/**
	 * 从数据库获取配置
	 */
	private async fetchConfigFromDatabase(): Promise<Result.Result<SystemConfig, string>> {
		try {
			// 获取Supabase客户端
			const supabaseResult = getSupabaseClient();
			if (Result.isFailure(supabaseResult)) {
				return Result.fail(`Database connection failed: ${supabaseResult.error}`);
			}

			const supabase = supabaseResult.value;

			// 获取所有系统配置
			const { data: configs, error } = await supabase
				.from('system_config')
				.select('config_key, config_value');

			if (error) {
				return Result.fail(`Database error: ${error.message}`);
			}

			if (!configs || configs.length === 0) {
				return Result.fail('No system config found in database');
			}

			// 将数组转换为配置对象
			const configMap: Record<string, any> = {};
			for (const config of configs) {
				configMap[config.config_key] = config.config_value;
			}

			// 构建完整的配置对象，使用默认值填充缺失的配置
			const systemConfig: SystemConfig = {
				token_limits: configMap.token_limits || DEFAULT_CONFIG.token_limits,
				cost_warning_levels: configMap.cost_warning_levels || DEFAULT_CONFIG.cost_warning_levels,
				burn_rate_thresholds: configMap.burn_rate_thresholds || DEFAULT_CONFIG.burn_rate_thresholds,
				notification_settings: configMap.notification_settings || DEFAULT_CONFIG.notification_settings,
				system_limits: configMap.system_limits || DEFAULT_CONFIG.system_limits,
				default_token_threshold: configMap.default_token_threshold || DEFAULT_CONFIG.default_token_threshold,
				pricing_config: configMap.pricing_config || DEFAULT_CONFIG.pricing_config, // 添加缺失的 pricing_config 映射
			};

			return Result.succeed(systemConfig);
		}
		catch (error) {
			return Result.fail(`Failed to fetch config from database: ${error}`);
		}
	}

	/**
	 * 获取token限制（常用方法）
	 * 如果配置为动态计算，则从LiteLLM价格表计算；否则返回配置值
	 */
	async getTokenLimit(): Promise<Result.Result<number, string>> {
		const configResult = await this.getConfig();
		if (Result.isFailure(configResult)) {
			return Result.fail(configResult.error);
		}

		const config = configResult.value;

		// 优先检查是否有通过web界面设置的固定值
		if (config.default_token_threshold.pricing_method === 'fixed') {
			logger.info(`Using fixed token limit from web interface: ${config.default_token_threshold.tokens.toLocaleString()} tokens`);
			return Result.succeed(config.default_token_threshold.tokens);
		}

		// 如果配置为动态计算且启用LiteLLM
		if (config.pricing_config?.use_litellm
			&& config.default_token_threshold.pricing_method === 'litellm_dynamic') {
			// 检查缓存，避免重复的网络调用
			const now = Date.now();
			const hasValidCachedTokens = this.cachedDynamicTokens !== null
				&& !isNaN(this.cachedDynamicTokens)
				&& this.cachedDynamicTokens > 0;
			const cacheNotExpired = now < this.dynamicTokensCacheExpiry;
			const cacheValid = hasValidCachedTokens && cacheNotExpired;

			if (cacheValid) {
				return Result.succeed(this.cachedDynamicTokens!);
			}

			const dynamicTokens = await this.calculateDynamicTokenLimit(
				config.pricing_config.target_usd_amount,
			);

			if (Result.isSuccess(dynamicTokens)) {
				return Result.succeed(dynamicTokens.value);
			}

			// 动态计算失败，使用fallback
			logger.warn('Dynamic token calculation failed, using fallback:', dynamicTokens.error);
			return Result.succeed(config.pricing_config.fallback_tokens);
		}

		// 使用配置的固定值
		return Result.succeed(config.token_limits.per_session);
	}

	/**
	 * 根据LiteLLM价格表动态计算token限制
	 * 优先使用网络调用获取最新价格，然后缓存到内存中
	 */
	private async calculateDynamicTokenLimit(targetUsdAmount: number): Promise<Result.Result<number, string>> {
		try {
			let pricingResult: Result.Result<Map<string, any>, Error>;

			// 复用PricingFetcher实例，利用其内部缓存机制
			if (!this.pricingFetcher) {
				this.pricingFetcher = new PricingFetcher(false); // 使用在线模式
			}

			pricingResult = await this.pricingFetcher.fetchModelPricing();

			// 如果网络调用失败，才使用缓存的离线数据作为备选
			if (Result.isFailure(pricingResult)) {
				logger.warn('Network pricing failed, falling back to cached data:', pricingResult.error);
				using offlineFetcher = new PricingFetcher(true); // 使用离线模式作为备选
				pricingResult = await offlineFetcher.fetchModelPricing();
			}

			if (Result.isFailure(pricingResult)) {
				return Result.fail(`Failed to fetch pricing data: ${pricingResult.error}`);
			}

			const pricingMap = pricingResult.value;

			// 查找Claude 4 Sonnet模型价格（当前主要使用的模型）
			// 尝试多种可能的模型名称和字段名称
			const modelNames = [
				'claude-sonnet-4-20250514',
				'claude-4-sonnet-20250514',
				'claude-4-sonnet',
				'anthropic/claude-4-sonnet-20250514',
				'anthropic/claude-sonnet-4-20250514',
			];

			let claude4SonnetModel = null;
			let foundModelName = '';

			for (const modelName of modelNames) {
				const model = pricingMap.get(modelName);
				if (model) {
					claude4SonnetModel = model;
					foundModelName = modelName;
					break;
				}
			}

			if (!claude4SonnetModel) {
				// 如果找不到Claude 4模型，尝试找一个Claude 3.5 Sonnet作为备选
				const fallbackModel = pricingMap.get('claude-3-5-sonnet-20241022')
					|| pricingMap.get('anthropic/claude-3-5-sonnet-20241022');
				if (fallbackModel) {
					claude4SonnetModel = fallbackModel;
					foundModelName = 'claude-3-5-sonnet-20241022 (fallback)';
				}
				else {
					return Result.fail('Claude Sonnet model not found in pricing data');
				}
			}

			// LiteLLM返回的标准字段名称
			const fieldNames = [
				{ input: 'input_cost_per_token', output: 'output_cost_per_token' },
			];

			let inputCost = null;
			let outputCost = null;

			for (const fields of fieldNames) {
				const testInputCost = claude4SonnetModel[fields.input];
				const testOutputCost = claude4SonnetModel[fields.output];

				if (typeof testInputCost === 'number' && typeof testOutputCost === 'number') {
					inputCost = testInputCost;
					outputCost = testOutputCost;
					break;
				}
			}

			if (inputCost === null || outputCost === null
				|| typeof inputCost !== 'number' || typeof outputCost !== 'number'
				|| isNaN(inputCost) || isNaN(outputCost) || inputCost <= 0 || outputCost <= 0) {
				return Result.fail(`Invalid pricing data for ${foundModelName}: input=${inputCost}, output=${outputCost}`);
			}

			// 计算平均token价格 (input + output) / 2
			// 注意：LiteLLM返回的已经是每个token的价格，不需要除以1000
			const avgPricePerToken = (inputCost + outputCost) / 2;

			if (avgPricePerToken <= 0 || isNaN(avgPricePerToken)) {
				return Result.fail(`Invalid calculated price per token: ${avgPricePerToken}`);
			}

			// 计算目标美元金额对应的token数量
			const calculatedTokens = Math.round(targetUsdAmount / avgPricePerToken);

			if (isNaN(calculatedTokens) || calculatedTokens <= 0) {
				return Result.fail(`Invalid calculated tokens: ${calculatedTokens} (targetUsd=${targetUsdAmount}, pricePerToken=${avgPricePerToken})`);
			}

			// 缓存有效的计算结果
			this.cachedDynamicTokens = calculatedTokens;
			this.dynamicTokensCacheExpiry = Date.now() + this.DYNAMIC_TOKENS_CACHE_TTL_MS;

			logger.info(`Dynamic token calculation: $${targetUsdAmount} = ${calculatedTokens.toLocaleString()} tokens (${avgPricePerToken.toFixed(6)}/token) - cached for 2h`);

			return Result.succeed(calculatedTokens);
		}
		catch (error) {
			return Result.fail(`Dynamic token calculation error: ${error}`);
		}
	}

	/**
	 * 获取燃烧率阈值（常用方法）
	 */
	async getBurnRateThresholds(): Promise<Result.Result<{ high: number; moderate: number; normal: number }, string>> {
		const configResult = await this.getConfig();
		if (Result.isFailure(configResult)) {
			return Result.fail(configResult.error);
		}

		return Result.succeed(configResult.value.burn_rate_thresholds);
	}

	/**
	 * 清除缓存（用于测试或强制刷新）
	 */
	clearCache(): void {
		this.cachedConfig = null;
		this.cacheExpiry = 0;
		this.cachedDynamicTokens = null;
		this.dynamicTokensCacheExpiry = 0;
		// 清理PricingFetcher实例，强制重新创建
		if (this.pricingFetcher) {
			this.pricingFetcher.clearCache();
			this.pricingFetcher = null;
		}
		logger.info('System config cache cleared');
	}

	/**
	 * 更新系统配置（写入数据库）
	 */
	async updateConfig(configKey: string, configValue: any, description?: string): Promise<Result.Result<void, string>> {
		try {
			// 获取Supabase客户端
			const supabaseResult = getSupabaseClient();
			if (Result.isFailure(supabaseResult)) {
				return Result.fail(`Database connection failed: ${supabaseResult.error}`);
			}

			const supabase = supabaseResult.value;

			// 使用 upsert 更新或插入配置
			const { error } = await supabase
				.from('system_config')
				.upsert({
					config_key: configKey,
					config_value: configValue,
					description: description || null,
				}, {
					onConflict: 'config_key',
				});

			if (error) {
				return Result.fail(`Failed to update config: ${error.message}`);
			}

			// 清除缓存以强制重新获取
			this.clearCache();

			return Result.succeed(undefined);
		}
		catch (error) {
			return Result.fail(`Failed to update system config: ${error}`);
		}
	}
}

/**
 * 全局系统配置管理器实例
 */
export const systemConfig = new SystemConfigManager();
