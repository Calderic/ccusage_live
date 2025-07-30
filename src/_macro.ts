/**
 * Prefetch claude data for the current user.
 */

import type { ModelPricing } from './_types.ts';
import { LITELLM_PRICING_URL } from './_consts.ts';
import { modelPricingSchema } from './_types.ts';

/**
 * Prefetches the pricing data for Claude models from the LiteLLM API.
 * This function fetches the pricing data and filters out models that start with 'claude-'.
 * It returns a record of model names to their pricing information.
 *
 * @returns A promise that resolves to a record of model names and their pricing information.
 * @throws Will throw an error if the fetch operation fails.
 */
export async function prefetchClaudePricing(): Promise<Record<string, ModelPricing>> {
	try {
		// 增加20秒超时，优化网络请求
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 20000); // 20秒超时

		const response = await fetch(LITELLM_PRICING_URL, {
			signal: controller.signal,
			headers: {
				'User-Agent': 'ccusage-cli/1.0',
			},
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(`Failed to fetch pricing data: HTTP ${response.status} ${response.statusText}`);
		}

		const data = await response.json() as Record<string, unknown>;

		const prefetchClaudeData: Record<string, ModelPricing> = {};

		// Cache all models that start with 'claude-'
		for (const [modelName, modelData] of Object.entries(data)) {
			if (modelName.startsWith('claude-') && modelData != null && typeof modelData === 'object') {
				const parsed = modelPricingSchema.safeParse(modelData);
				if (parsed.success) {
					prefetchClaudeData[modelName] = parsed.data;
				}
			}
		}

		return prefetchClaudeData;
	}
	catch (error) {
		// 网络错误时抛出，让调用者处理
		throw new Error(`Failed to prefetch Claude pricing: ${error instanceof Error ? error.message : String(error)}`);
	}
}
