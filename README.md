<div align="center">
    <h1>🚗 CCUsage Live</h1>
    <p><strong>Enhanced Claude Code usage analysis tool with live team monitoring and collaboration features</strong></p>
</div>

<p align="center">
    <a href="https://npmjs.com/package/ccusage-live"><img src="https://img.shields.io/npm/v/ccusage-live?color=yellow" alt="npm version" /></a>
    <a href="https://npmjs.com/package/ccusage-live"><img src="https://img.shields.io/npm/dy/ccusage-live" alt="NPM Downloads" /></a>
    <a href="https://packagephobia.com/result?p=ccusage-live"><img src="https://packagephobia.com/badge?p=ccusage-live" alt="install size" /></a>
    <a href="https://github.com/Calderic/ccusage-live"><img src="https://img.shields.io/github/stars/Calderic/ccusage-live?style=social" alt="GitHub stars" /></a>
</p>

> **Analyze your Claude Code usage with powerful team collaboration features — now with live monitoring, team management, and real-time synchronization!**

Built on top of the excellent [ccusage](https://github.com/ryoppippi/ccusage) by @ryoppippi, this enhanced version adds team collaboration, live monitoring, and advanced management features.

## Installation

### Global Installation (Recommended)

Install ccusage-live globally to use it anywhere:

```bash
# Using npm
npm install -g ccusage-live

# Using bun (faster)
bun install -g ccusage-live

# Using pnpm
pnpm install -g ccusage-live
```

### Quick Usage Without Installation

You can also run it directly without installation:

```bash
# Using bunx (recommended for speed)
bunx ccusage-live

# Using npx
npx ccusage-live@latest
```

> 💡 **Tip**: We recommend using `bun` for faster installation and execution!

## Usage

After installation, you can use either the full command name or the short alias:

```bash
# Using full command name
ccusage-live daily    # Daily token usage and costs
ccusage-live monthly  # Monthly aggregated report
ccusage-live session  # Usage by conversation session
ccusage-live blocks   # 5-hour billing windows

# Using short alias (convenient!)
ccul daily    # Same as ccusage-live daily
ccul monthly  # Same as ccusage-live monthly
ccul session  # Same as ccusage-live session
ccul blocks   # Same as ccusage-live blocks

# Team collaboration features
ccul team create "My Team"           # Create a new team
ccul team join <team-id>             # Join an existing team
ccul team list                       # List your teams
ccul team members <team-id>          # Show team members
ccul team sync                       # Sync usage to team database

# Live monitoring & real-time features
ccul blocks --active                 # Show active billing block with projections
ccul blocks --recent                 # Show recent blocks (last 3 days)
ccul blocks --live                   # Real-time usage dashboard (team mode)

# Advanced options
ccul daily --json                    # JSON output
ccul daily --mode calculate         # Force cost calculation
ccul monthly --since 2025-01-01     # Date filtering
ccul session --project myproject    # Filter by project

# MCP Server (for Claude Desktop integration)
ccul mcp                            # Start MCP server
ccul mcp --type http --port 8080    # HTTP MCP server
```

## ✨ Enhanced Features

### 🏢 Team Collaboration

- **👥 Team Management**: Create and manage teams with unique identifiers
- **🔗 Easy Joining**: Join teams using simple team codes
- **👨‍👩‍👧‍👦 Member Management**: View and manage team members
- **📊 Centralized Analytics**: Aggregate usage data across team members
- **🔄 Real-time Sync**: Automatic synchronization with team database
- **🌐 Web Dashboard**: Browser-based team management interface

### 📈 Live Monitoring & Real-time Features

- **⏰ Active Block Tracking**: Monitor current 5-hour billing window progress
- **🚨 Smart Alerts**: Configurable token threshold warnings
- **📊 Real-time Dashboard**: Live usage updates with burn rate calculations
- **💰 Cost Projections**: Predict costs based on current usage patterns
- **🔄 Auto-refresh**: Continuous monitoring with customizable intervals

### 📊 Core Usage Analytics

- **📅 Daily Reports**: Token usage and costs by date
- **📆 Monthly Reports**: Aggregated monthly statistics
- **💬 Session Reports**: Usage grouped by conversation sessions
- **⏰ 5-Hour Blocks**: Track Claude's billing window usage
- **🤖 Model Tracking**: Detailed breakdown by Claude model (Sonnet, Opus, etc.)
- **📊 Cost Analysis**: Precise USD cost tracking with multiple calculation modes

### 🛠️ Advanced Features

- **🔌 MCP Integration**: Built-in Model Context Protocol server for Claude Desktop
- **📄 JSON Export**: Structured data output for programmatic usage
- **📅 Date Filtering**: Flexible date range filtering
- **🎨 Smart Display**: Responsive tables with automatic compact mode
- **🌐 Multi-directory Support**: Handle multiple Claude installations
- **⚡ High Performance**: Optimized for speed with minimal bundle size

### 🔧 Configuration & Setup

- **🔄 Pre-configured**: Ready-to-use with included server settings
- **🔧 Environment Variables**: Flexible configuration options
- **📝 Interactive Setup**: Guided configuration wizard
- **🔒 Secure**: Built-in validation and error handling

## 🔧 Configuration

CCUsage Live comes pre-configured with team collaboration features. The package includes default server settings that work out of the box.

### Environment Variables (Optional)

You can override the default configuration using environment variables:

```bash
# Supabase Configuration
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key"

# Feature Controls
export CCUSAGE_TEAM_MODE="true"      # Enable team features
export CCUSAGE_WEB_INTERFACE="true"  # Enable web dashboard
export CCUSAGE_MCP_SERVER="true"     # Enable MCP server

# Usage Analysis
export CLAUDE_CONFIG_DIR="/custom/path"  # Custom Claude data directory
```

### Cost Calculation Modes

Control how costs are calculated:

- `--mode auto` (default): Use pre-calculated costs when available
- `--mode calculate`: Always calculate from tokens using model pricing
- `--mode display`: Use only pre-calculated cost values

### Team Setup

1. **Create a team**: `ccul team create "My Team"`
2. **Share team ID**: Give the team ID to your colleagues
3. **Join team**: Others run `ccul team join <team-id>`
4. **Sync data**: Run `ccul team sync` to upload usage data
5. **Monitor together**: Use `ccul blocks --live` for real-time monitoring

## 🌐 Web Dashboard

CCUsage Live includes a web-based dashboard for team management:

```bash
# Start the web interface (usually runs on port 3000)
ccul web

# Or access via MCP server
ccul mcp --type http --port 8080
```

The web dashboard provides:

- Team overview and member management
- Real-time usage monitoring
- Threshold configuration
- Usage analytics and charts

## 📋 Requirements

- **Node.js**: Version 20.19.4 or higher
- **Claude Code**: Any version (supports both `~/.claude` and `~/.config/claude`)
- **Internet**: Required for team features and cost calculations (offline mode available)

## 🚀 Development & Contributing

This package is based on the excellent [ccusage](https://github.com/ryoppippi/ccusage) by [@ryoppippi](https://github.com/ryoppippi), with enhanced team collaboration and live monitoring features.

### For Publishers

If you're setting up this package for your team, run the configuration script before publishing:

```bash
# Configure your Supabase settings
node scripts/setup-config.js

# Build and publish
bun run build
npm publish
```

### Building from Source

```bash
# Clone the repository
git clone https://github.com/Calderic/ccusage-live.git
cd ccusage-live

# Install dependencies
bun install

# Build the project
bun run build

# Run tests
bun run test

# Start development
bun run start daily
```

## 🙏 Acknowledgments

- **[@ryoppippi](https://github.com/ryoppippi)** - Creator of the original [ccusage](https://github.com/ryoppippi/ccusage)
- **Claude Code Community** - For the excellent CLI tool and community support
- **All Contributors** - Thanks to everyone who helped improve this tool

## 📄 License

[MIT](LICENSE) © [Calderic](https://github.com/Calderic)

---

<div align="center">
    <p><strong>Built with ❤️ for the Claude Code community</strong></p>
    <p>If you find this tool helpful, please ⭐ star the repository!</p>
</div>
