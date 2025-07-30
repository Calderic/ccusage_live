#!/usr/bin/env node

/**
 * 配置设置脚本
 * 用于在发布npm包前设置真实的Supabase配置
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import prompts from 'prompts';

const CONFIG_FILE_PATH = join(process.cwd(), 'src/config/default-config.ts');

async function setupConfig() {
	console.log('🚀 CCUsage Live - 配置设置');
	console.log('============================');
	console.log('');
	console.log('请提供你的Supabase项目配置信息：');
	console.log('');

	const responses = await prompts([
		{
			type: 'text',
			name: 'supabaseUrl',
			message: 'Supabase项目URL:',
			validate: value => value.startsWith('https://') ? true : 'URL必须以https://开头',
		},
		{
			type: 'text',
			name: 'supabaseAnonKey',
			message: 'Supabase匿名密钥:',
			validate: value => value.length > 50 ? true : '密钥长度不正确',
		},
		{
			type: 'confirm',
			name: 'enableTeamMode',
			message: '启用团队协作功能?',
			initial: true,
		},
		{
			type: 'confirm',
			name: 'enableWebInterface',
			message: '启用Web管理界面?',
			initial: true,
		},
		{
			type: 'confirm',
			name: 'enableMcpServer',
			message: '启用MCP服务器?',
			initial: true,
		},
		{
			type: 'confirm',
			name: 'confirm',
			message: '确认更新配置文件?',
			initial: true,
		},
	]);

	if (!responses.confirm) {
		console.log('❌ 配置更新已取消');
		process.exit(0);
	}

	// 读取当前配置文件
	const configContent = readFileSync(CONFIG_FILE_PATH, 'utf-8');

	// 替换配置值
	const updatedContent = configContent
		.replace(/url: 'https:\/\/your-project-id\.supabase\.co'/, `url: '${responses.supabaseUrl}'`)
		.replace(/anonKey: 'your-anon-key-here'/, `anonKey: '${responses.supabaseAnonKey}'`)
		.replace(/teamMode: true/, `teamMode: ${responses.enableTeamMode}`)
		.replace(/webInterface: true/, `webInterface: ${responses.enableWebInterface}`)
		.replace(/mcpServer: true/, `mcpServer: ${responses.enableMcpServer}`);

	// 写入更新后的配置
	writeFileSync(CONFIG_FILE_PATH, updatedContent, 'utf-8');

	console.log('');
	console.log('✅ 配置更新成功！');
	console.log('');
	console.log('📋 配置信息:');
	console.log(`   Supabase URL: ${responses.supabaseUrl}`);
	console.log(`   匿名密钥: ${responses.supabaseAnonKey.substring(0, 20)}...`);
	console.log(`   团队模式: ${responses.enableTeamMode ? '✅' : '❌'}`);
	console.log(`   Web界面: ${responses.enableWebInterface ? '✅' : '❌'}`);
	console.log(`   MCP服务器: ${responses.enableMcpServer ? '✅' : '❌'}`);
	console.log('');
	console.log('🎯 下一步：运行 bun run build && npm publish 发布包');
}

setupConfig().catch(error => {
	console.error('❌ 配置设置失败:', error);
	process.exit(1);
});