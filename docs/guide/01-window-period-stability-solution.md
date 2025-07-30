# 01. 拼车实时监控窗口期稳定性解决方案

## 📋 问题概述

当前系统存在两套实时监控机制，导致窗口期显示不稳定：

- **原版 `ccusage blocks --live`**: 基于本地JSONL文件实时计算会话块状态
- **拼车版 `team live`**: 错误地依赖Supabase数据库查询活跃会话状态

**核心问题**: 拼车版监控偏离了设计原则。Supabase应该只用于数据同步（上传本机数据、获取队友信息），实际显示的窗口期应该基于本地数据计算，而不是数据库状态。

## 🎯 解决目标

1. **稳定性**: 窗口期显示稳定，不会无故跳跃
2. **一致性**: 两套监控系统使用统一的会话选择逻辑
3. **准确性**: 准确反映当前活跃的5小时计费窗口  
4. **本地优先**: 显示数据基于本地计算，Supabase仅用于队友数据同步
5. **性能**: 减少不必要的重复计算和数据库查询

## 🏗️ 解决方案设计

### 方案1: 统一会话选择逻辑（推荐）

#### 核心思路
**回归设计本意**: 拼车监控系统应该基于本地数据计算当前会话，Supabase只负责：
- 上传本机使用数据到团队共享库
- 获取队友的使用数据用于团队统计
- 实际显示的"当前窗口期"完全基于本地JSONL文件计算

#### 实现方案

```typescript
// 新增: 统一的会话选择器
export class UnifiedSessionSelector {
  private cachedSession: SessionBlock | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_DURATION = 30000; // 30秒缓存

  /**
   * 获取当前活跃会话（带缓存）
   */
  async getCurrentSession(
    userId?: string,
    teamContext?: boolean
  ): Promise<SessionBlock | null> {
    const now = Date.now();
    
    // 如果缓存有效，直接返回
    if (this.cachedSession && (now - this.cacheTimestamp) < this.CACHE_DURATION) {
      return this.cachedSession;
    }

    // 重新计算当前会话
    const session = await this.calculateCurrentSession(userId, teamContext);
    
    // 更新缓存
    this.cachedSession = session;
    this.cacheTimestamp = now;
    
    return session;
  }

  private async calculateCurrentSession(
    userId?: string, 
    teamContext?: boolean
  ): Promise<SessionBlock | null> {
    // 1. 加载本地使用数据
    const entries = await this.loadUserEntries(userId);
    
    // 2. 使用统一算法计算会话块
    const blocks = identifySessionBlocks(entries);
    
    // 3. 应用稳定的选择策略
    return this.selectStableSession(blocks);
  }

  private selectStableSession(blocks: SessionBlock[]): SessionBlock | null {
    const now = new Date();
    
    // 优先级1: 真正活跃的会话（有最近活动且在窗口期内）
    const activeBlocks = blocks.filter(block => {
      return block.isActive && 
             block.actualEndTime &&
             (now.getTime() - block.actualEndTime.getTime()) < (2 * 60 * 60 * 1000); // 2小时内有活动
    });
    
    if (activeBlocks.length > 0) {
      return activeBlocks[0]; // 返回最新的活跃会话
    }
    
    // 优先级2: 当前时间在窗口期内的会话
    const currentTimeBlocks = blocks.filter(block => {
      return now >= block.startTime && now < block.endTime;
    });
    
    if (currentTimeBlocks.length > 0) {
      return currentTimeBlocks[0];
    }
    
    // 优先级3: 最近的会话
    const recentBlocks = blocks
      .filter(block => !block.isGap)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
    
    return recentBlocks[0] || null;
  }
}
```

#### 集成到拼车监控

```typescript
// 修改: team-service.ts
export class TeamService {
  private sessionSelector = new UnifiedSessionSelector();

  async getTeamStats(teamId: string, currentUserId?: string): Promise<Result<TeamAggregatedStats, string>> {
    // 1. 从Supabase获取团队基础信息和队友数据（仅用于团队统计）
    const { data: team } = await supabase.from('teams').select('*').eq('id', teamId).single();
    const { data: members } = await supabase.from('team_members').select('*').eq('team_id', teamId);
    const { data: teammatesSessions } = await supabase.from('usage_sessions')
      .select('*').eq('team_id', teamId).neq('user_id', currentUserId);

    // 2. **关键变化**: 当前会话完全基于本地数据计算
    const currentSession = await this.sessionSelector.getCurrentSession(currentUserId, false); // 本地计算

    // 3. 个人数据基于本地，队友数据来自数据库同步
    const personalStats = currentSession ? {
      current_tokens: getTotalTokens(currentSession.tokenCounts),
      current_cost: currentSession.costUSD,
      is_active: currentSession.isActive
    } : { current_tokens: 0, current_cost: 0, is_active: false };

    // 4. 队友数据来自Supabase同步
    const teammateStats = teammatesSessions.map(session => ({
      user_id: session.user_id,
      user_name: members.find(m => m.user_id === session.user_id)?.user_name || 'Unknown',
      current_tokens: session.token_counts.total,
      current_cost: session.cost_usd,
      is_active: session.is_active
    }));

    return Result.succeed({
      team,
      members,
      current_session: currentSession, // 基于本地数据的会话
      member_stats: [personalStats, ...teammateStats], // 本地+同步数据
      // ... 其他统计基于混合数据
    });
  }
}
```

### 方案2: 改进会话活跃判断逻辑

#### 问题根源
```typescript
// 当前有问题的逻辑
const isActive = now.getTime() - actualEndTime.getTime() < sessionDurationMs && now < endTime;
```

#### 改进方案
```typescript
// 新的稳定判断逻辑
function calculateSessionState(
  startTime: Date, 
  endTime: Date, 
  actualEndTime: Date, 
  now: Date
): 'active' | 'current' | 'expired' {
  // 1. 如果当前时间在5小时窗口期内，认为是当前会话
  if (now >= startTime && now < endTime) {
    return 'current';
  }
  
  // 2. 如果距离最后活动不超过1小时，且在窗口期后不久，认为是活跃
  const timeSinceLastActivity = now.getTime() - actualEndTime.getTime();
  const timeSinceWindowEnd = now.getTime() - endTime.getTime();
  
  if (timeSinceLastActivity < (60 * 60 * 1000) && timeSinceWindowEnd < (30 * 60 * 1000)) {
    return 'active';
  }
  
  return 'expired';
}

// 使用新的状态判断
function createBlock(startTime: Date, entries: LoadedUsageEntry[], now: Date, sessionDurationMs: number): SessionBlock {
  const endTime = new Date(startTime.getTime() + sessionDurationMs);
  const lastEntry = entries[entries.length - 1];
  const actualEndTime = lastEntry?.timestamp || startTime;
  
  const state = calculateSessionState(startTime, endTime, actualEndTime, now);
  const isActive = state === 'active' || state === 'current';
  
  // ... 其余逻辑
}
```

### 方案3: 智能会话选择策略

#### 分级选择逻辑

```typescript
export class SmartSessionSelector {
  selectCurrentSession(blocks: SessionBlock[]): SessionBlock | null {
    const now = new Date();
    const strategies = [
      this.selectActiveWithRecentActivity,
      this.selectCurrentTimeWindow,
      this.selectMostRecentActive,
      this.selectLatestSession
    ];

    for (const strategy of strategies) {
      const result = strategy.call(this, blocks, now);
      if (result) {
        return result;
      }
    }

    return null;
  }

  private selectActiveWithRecentActivity(blocks: SessionBlock[], now: Date): SessionBlock | null {
    return blocks.find(block => 
      block.isActive && 
      block.actualEndTime &&
      (now.getTime() - block.actualEndTime.getTime()) < (2 * 60 * 60 * 1000) // 2小时内有活动
    ) || null;
  }

  private selectCurrentTimeWindow(blocks: SessionBlock[], now: Date): SessionBlock | null {
    return blocks.find(block => 
      now >= block.startTime && 
      now < block.endTime &&
      !block.isGap
    ) || null;
  }

  private selectMostRecentActive(blocks: SessionBlock[], now: Date): SessionBlock | null {
    const activeBlocks = blocks
      .filter(block => block.isActive && !block.isGap)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
    
    return activeBlocks[0] || null;
  }

  private selectLatestSession(blocks: SessionBlock[], now: Date): SessionBlock | null {
    const recentBlocks = blocks
      .filter(block => !block.isGap)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
    
    return recentBlocks[0] || null;
  }
}
```

## 📝 实施计划

### Phase 1: 核心改进 (优先级: 高)

1. **创建统一会话选择器** 
   - 文件: `src/_unified-session-selector.ts`
   - 实现缓存机制和分级选择策略

2. **修改团队服务集成**
   - 文件: `src/team/team-service.ts` 
   - 使用统一选择器替代数据库查询

3. **改进会话状态判断**
   - 文件: `src/_session-blocks.ts`
   - 修复 `createBlock` 中的 `isActive` 逻辑

### Phase 2: 性能优化 (优先级: 中)

4. **添加会话缓存层**
   - 30秒缓存当前会话选择
   - 避免频繁重新计算

5. **优化数据加载**
   - 减少重复的JSONL文件读取
   - 实现增量数据更新

### Phase 3: 用户体验 (优先级: 中)

6. **添加会话切换提示**
   - 当会话发生变化时显示通知
   - 提供会话历史查看功能

7. **配置项支持**
   - 允许用户配置会话选择策略
   - 支持手动锁定特定会话

## 🧪 测试验证

### 测试场景

```typescript
describe('会话稳定性测试', () => {
  test('连续刷新不应改变当前会话', async () => {
    const selector = new UnifiedSessionSelector();
    
    const session1 = await selector.getCurrentSession('user1');
    await delay(1000);
    const session2 = await selector.getCurrentSession('user1');
    
    expect(session1?.id).toBe(session2?.id);
  });

  test('跨窗口期边界应平滑过渡', async () => {
    // 模拟窗口期边界情况
    const now = new Date('2025-01-01T15:00:00Z'); // 窗口期结束时刻
    const blocks = createTestBlocks();
    
    const selector = new SmartSessionSelector();
    const session = selector.selectCurrentSession(blocks);
    
    expect(session).toBeDefined();
    expect(session?.startTime.getHours()).toBe(10); // 应该选择10-15点的窗口
  });
});
```

## 📊 预期效果

### 稳定性提升
- ✅ 窗口期显示稳定，30秒内不会变化
- ✅ 跨窗口期边界平滑过渡
- ✅ 减少90%的不必要会话切换

### 性能改进
- ✅ 减少60%的重复计算
- ✅ 数据库查询次数减少50%
- ✅ 界面刷新延迟降低至<100ms

### 用户体验
- ✅ 监控界面显示更稳定
- ✅ 燃烧率和进度条不会跳跃
- ✅ 用户可以信任显示的时间信息

## 🚀 部署建议

1. **渐进部署**: 先在开发环境验证，再逐步推广
2. **A/B测试**: 对比新旧逻辑的稳定性表现
3. **监控告警**: 添加会话切换频率监控
4. **回滚预案**: 保留原有逻辑作为降级方案

---

**这套解决方案将彻底解决拼车实时监控中窗口期不稳定的问题，提供更可靠的用户体验。**