# CloudWatch Log Tailer (cwl)

A simple CLI tool to easily search, tail, and manage CloudWatch log groups. Built with TypeScript.

## Features

- Search for CloudWatch log groups with pattern matching
- Filter logs with specific keywords or patterns
- Tail logs in real-time with optional filtering
- Save and manage favorite log groups for quick access
- Track recent searches for easy reuse
- Color-coded output for better readability
- Fully typed with TypeScript

## Installation

```bash
# Install globally
npm install -g cwtch

# Or use with npx
npx cwtch
```

## Development Setup

```bash
# Clone the repository
# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Run in development mode with auto-recompile
npm run dev
```

Make sure you have AWS credentials configured via:
- AWS CLI (`aws configure`)
- Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- Shared credentials file (`~/.aws/credentials`)
- IAM role when running on AWS resources (EC2, Lambda, etc.)

## AWS Permissions Required

Your AWS credentials need the following permissions:
- `logs:DescribeLogGroups`
- `logs:GetLogEvents`
- `logs:FilterLogEvents`

## Usage

### Basic Usage

```bash
# Search and tail logs (interactive mode)
cwl [search_term]

# Quick access to favorite logs
cwl -f <favorite_keyword>

# Quick access with filtering
cwl -f <favorite_keyword> -k "error"
```

### Available Commands

```bash
# Search for log groups and tail logs
cwl search [query]

# Filter logs for specific text
cwl filter <logGroupName> "<pattern>" [options]
cwl filter <favorite_keyword> "<pattern>" [options]

# Filter options:
#   -s, --start-time <time>  Start time in ISO format or minutes ago (e.g., "30m")
#   -e, --end-time <time>    End time in ISO format (defaults to now)

# Add a log group to favorites
cwl favorite <keyword> <logGroupName>
cwl fav <keyword> <logGroupName>

# List all favorites
cwl list-favorites
cwl ls

# Remove a favorite
cwl remove-favorite <keyword>
cwl rm <keyword>

# View recent searches
cwl recent

# Show help
cwl --help
```

## Examples

```bash
# Search for all log groups containing "production"
cwl production

# Tail logs from a favorite log group with keyword "api"
cwl -f api

# Tail logs with filtering for errors
cwl -f api -k "ERROR"

# Add a log group to favorites
cwl favorite api /aws/lambda/production-api-service

# List all favorites
cwl ls

# Search logs from the last hour with a specific pattern
cwl filter api "timeout" --start-time "60m"
```

## License

MIT