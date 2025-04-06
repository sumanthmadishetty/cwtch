#!/usr/bin/env node

import { program } from "commander";
import inquirer from "inquirer";
import ora from "ora";
import chalk from "chalk";
import Conf from "conf";
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  FilterLogEventsCommand,
  GetLogEventsCommand,
  LogGroup,
  FilteredLogEvent,
} from "@aws-sdk/client-cloudwatch-logs";
import { exec, spawn, ChildProcess } from "child_process";

// Define interfaces for our data structures
interface Favorites {
  [key: string]: string;
}

interface ConfigSchema {
  favorites: Favorites;
  recentSearches: string[];
}

interface FilterOptions {
  startTime: string;
  endTime?: string;
}

// Config store for favorites
const config = new Conf<ConfigSchema>({
  projectName: "cwtch",
  schema: {
    favorites: {
      type: "object",
      default: {},
    },
    recentSearches: {
      type: "array",
      default: [],
    },
  },
});

// Initialize AWS CloudWatch Logs client
const client = new CloudWatchLogsClient();

program
  .name("cwl")
  .description(
    "CloudWatch Log Tailer - A CLI tool to easily tail CloudWatch logs"
  )
  .version("0.0.1");

program
  .command("search")
  .description("Search log groups and tail logs")
  .argument("[query]", "Search string for log groups")
  .action(async (query?: string) => {
    try {
      await searchAndTailLogs(query);
    } catch (error) {
      console.error(chalk.red("Error:"), (error as Error).message);
      process.exit(1);
    }
  });

program
  .command("filter")
  .description("Search logs for specific text within a log group")
  .argument("<logGroupName>", "Log group to search in (or favorite keyword)")
  .argument("<filterPattern>", "Text pattern to search for")
  .option(
    "-s, --start-time <time>",
    'Start time in ISO format or minutes ago (e.g., "30m")',
    "30m"
  )
  .option("-e, --end-time <time>", "End time in ISO format (defaults to now)")
  .action(
    async (
      logGroupName: string,
      filterPattern: string,
      options: FilterOptions
    ) => {
      try {
        // Check if the input is a favorite keyword
        const favorites = config.get("favorites");
        if (favorites[logGroupName]) {
          logGroupName = favorites[logGroupName];
        }

        await searchLogsWithPattern(logGroupName, filterPattern, options);
      } catch (error) {
        console.error(chalk.red("Error:"), (error as Error).message);
        process.exit(1);
      }
    }
  );

program
  .command("favorite")
  .alias("fav")
  .description("Add a log group to favorites")
  .argument("<keyword>", "Short keyword to identify the log group")
  .argument("<logGroupName>", "Full name of the log group")
  .action((keyword: string, logGroupName: string) => {
    try {
      addFavorite(keyword, logGroupName);
      console.log(
        chalk.green(
          `✓ Added "${logGroupName}" to favorites with keyword "${keyword}"`
        )
      );
    } catch (error) {
      console.error(chalk.red("Error:"), (error as Error).message);
      process.exit(1);
    }
  });

program
  .command("list-favorites")
  .alias("ls")
  .description("List all favorite log groups")
  .action(() => {
    try {
      listFavorites();
    } catch (error) {
      console.error(chalk.red("Error:"), (error as Error).message);
      process.exit(1);
    }
  });

program
  .command("remove-favorite")
  .alias("rm")
  .description("Remove a log group from favorites")
  .argument("<keyword>", "Keyword of the favorite to remove")
  .action((keyword: string) => {
    try {
      removeFavorite(keyword);
      console.log(chalk.green(`✓ Removed favorite with keyword "${keyword}"`));
    } catch (error) {
      console.error(chalk.red("Error:"), (error as Error).message);
      process.exit(1);
    }
  });

program
  .command("recent")
  .description("List recent searches")
  .action(() => {
    try {
      listRecentSearches();
    } catch (error) {
      console.error(chalk.red("Error:"), (error as Error).message);
      process.exit(1);
    }
  });

interface ProgramOptions {
  favorite?: string;
  keyword?: string;
}

// Add -f option to the main program for quick access to favorites
program
  .option(
    "-f, --favorite <keyword>",
    "Quickly tail logs from a favorite log group"
  )
  .option(
    "-k, --keyword <pattern>",
    "Search logs for specific text while tailing"
  )
  .action(async (options: ProgramOptions) => {
    if (options.favorite) {
      try {
        await tailFavorite(options.favorite, options.keyword);
      } catch (error) {
        console.error(chalk.red("Error:"), (error as Error).message);
        process.exit(1);
      }
    } else {
      program.help();
    }
  });

program.parse(process.argv);

// If no command is specified and no -f option, default to the search command
if (
  !process.argv.slice(2).length ||
  (process.argv.length === 3 &&
    process.argv[2] !== "-f" &&
    !process.argv[2].startsWith("--"))
) {
  const query = process.argv[2] || "";
  searchAndTailLogs(query);
}

async function searchAndTailLogs(query: string = ""): Promise<void> {
  const spinner = ora("Searching for log groups...").start();

  try {
    // Fetch all log groups that match the query
    const logGroups = await findLogGroups(query);
    spinner.stop();

    if (logGroups.length === 0) {
      console.log(chalk.yellow(`No log groups found matching "${query}"`));
      return;
    }

    // Let user select a log group
    const response = await inquirer.prompt([
      {
        type: "list",
        name: "logGroupName",
        message: "Select a log group to tail:",
        choices: logGroups.map((lg) => ({
          name: lg.logGroupName!,
          value: lg.logGroupName,
        })),
      },
    ]);

    const logGroupName: string = response.logGroupName;

    // Ask if user wants to add this to favorites
    const favoriteResponse = await inquirer.prompt([
      {
        type: "confirm",
        name: "addToFavorites",
        message: "Would you like to add this log group to favorites?",
        default: false,
      },
    ]);

    if (favoriteResponse.addToFavorites) {
      const keywordResponse = await inquirer.prompt([
        {
          type: "input",
          name: "keyword",
          message: "Enter a keyword for this favorite:",
          validate: (input: string) =>
            input.trim() !== "" || "Keyword cannot be empty",
        },
      ]);

      addFavorite(keywordResponse.keyword, logGroupName);
      console.log(
        chalk.green(
          `✓ Added "${logGroupName}" to favorites with keyword "${keywordResponse.keyword}"`
        )
      );
    }

    // Ask if they want to filter logs
    const filterResponse = await inquirer.prompt([
      {
        type: "confirm",
        name: "useFilter",
        message: "Would you like to filter logs with a keyword?",
        default: false,
      },
    ]);

    let filterPattern: string | null = null;
    if (filterResponse.useFilter) {
      const patternResponse = await inquirer.prompt([
        {
          type: "input",
          name: "pattern",
          message: "Enter text to filter logs:",
          validate: (input: string) =>
            input.trim() !== "" || "Filter pattern cannot be empty",
        },
      ]);
      filterPattern = patternResponse.pattern;
    }

    // Start tailing logs
    await tailLogs(logGroupName, filterPattern);
  } catch (error) {
    spinner.stop();
    throw error;
  }
}

async function findLogGroups(query: string): Promise<LogGroup[]> {
  //   const pattern = query ? `.*${query}.*` : ".*";

  const command = new DescribeLogGroupsCommand({
    logGroupNamePattern: query,
    limit: 50,
  });

  const response = await client.send(command);
  return response.logGroups || [];
}

async function tailLogs(
  logGroupName: string,
  filterPattern: string | null = null
): Promise<void> {
  console.log(chalk.blue(`\nTailing logs for ${logGroupName}`));
  if (filterPattern) {
    console.log(chalk.yellow(`Filtering for: "${filterPattern}"`));
    // Save to recent searches
    saveRecentSearch(filterPattern);
  }
  console.log(chalk.dim("Press Ctrl+C to exit\n"));
  console.log(chalk.green("Starting streaming logs..."));

  // Use spawn instead of exec for long-running processes
  const command = "aws";
  let args = ["logs", "tail", logGroupName, "--follow"];

  // Add filter if provided
  if (filterPattern) {
    args.push("--filter-pattern", `"${filterPattern}"`);
  }

  console.log(
    chalk.dim(
      `Executing: aws logs tail "${logGroupName}" --follow${
        filterPattern ? ` --filter-pattern "${filterPattern}"` : ""
      }`
    )
  );

  // Using spawn instead of exec for streaming
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  // Pipe the output to console
  child.stdout.on("data", (data: Buffer) => {
    process.stdout.write(data);
  });

  child.stderr.on("data", (data: Buffer) => {
    process.stderr.write(chalk.red(data));
  });

  // Handle errors
  child.on("error", (error: Error) => {
    console.error(chalk.red("Error executing AWS CLI:"), error.message);
    console.log(
      chalk.yellow("Make sure AWS CLI is installed and properly configured.")
    );
    process.exit(1);
  });

  // Handle exit
  child.on("close", (code: number | null) => {
    if (code !== 0 && code !== null) {
      console.error(chalk.red(`AWS CLI process exited with code ${code}`));
      process.exit(1);
    }
  });

  // Handle ctrl+c to clean up
  process.on("SIGINT", () => {
    child.kill();
    console.log(chalk.dim("\nStopped tailing logs"));
    process.exit(0);
  });

  // This function will not resolve until the child process exits
  // which will only happen on error or when the user presses Ctrl+C
  return new Promise<void>((resolve) => {
    child.on("close", () => {
      resolve();
    });
  });
}

async function searchLogsWithPattern(
  logGroupName: string,
  filterPattern: string,
  options: FilterOptions
): Promise<void> {
  // Save to recent searches
  saveRecentSearch(filterPattern);

  // Parse time options
  const now = Date.now();
  let startTime: number, endTime: number;

  if (options.startTime.endsWith("m")) {
    // Parse as "minutes ago"
    const minutes = parseInt(options.startTime.slice(0, -1));
    startTime = now - minutes * 60 * 1000;
  } else {
    // Parse as ISO string
    startTime = new Date(options.startTime).getTime();
  }

  endTime = options.endTime ? new Date(options.endTime).getTime() : now;

  const spinner = ora(
    `Searching for "${filterPattern}" in ${logGroupName}...`
  ).start();

  try {
    const command = new FilterLogEventsCommand({
      logGroupName: logGroupName,
      filterPattern: filterPattern,
      startTime: startTime,
      endTime: endTime,
    });

    const response = await client.send(command);
    spinner.stop();

    if (!response.events || response.events.length === 0) {
      console.log(chalk.yellow("No matching log events found."));
      return;
    }

    console.log(
      chalk.green(`\nFound ${response.events.length} matching events:`)
    );
    console.log(chalk.dim("─".repeat(80)));

    for (const event of response.events) {
      printLogEvent(event);
    }

    if (response.nextToken) {
      console.log(
        chalk.yellow(
          "\nMore results available. Refine your search or narrow the time window."
        )
      );
    }
  } catch (error) {
    spinner.stop();
    throw error;
  }
}

function printLogEvent(event: FilteredLogEvent): void {
  const timestamp = new Date(event.timestamp || 0).toISOString();
  console.log(`${chalk.dim(timestamp)} ${event.message || ""}`);
}

function addFavorite(keyword: string, logGroupName: string): void {
  const favorites = config.get("favorites");
  favorites[keyword] = logGroupName;
  config.set("favorites", favorites);
}

function removeFavorite(keyword: string): void {
  const favorites = config.get("favorites");
  if (!favorites[keyword]) {
    throw new Error(`No favorite found with keyword "${keyword}"`);
  }
  delete favorites[keyword];
  config.set("favorites", favorites);
}

function listFavorites(): void {
  const favorites = config.get("favorites");

  if (Object.keys(favorites).length === 0) {
    console.log(chalk.yellow("No favorites saved yet."));
    console.log(
      "Add a favorite with:",
      chalk.blue("cwl favorite <keyword> <logGroupName>")
    );
    return;
  }

  console.log(chalk.bold("\nYour Favorites:"));
  console.log(chalk.dim("─".repeat(50)));

  Object.entries(favorites).forEach(([keyword, logGroupName]) => {
    console.log(`${chalk.green(keyword.padEnd(15))} ${logGroupName}`);
  });

  console.log(chalk.dim("─".repeat(50)));
  console.log(
    `\nUse ${chalk.blue(
      "cwl -f <keyword>"
    )} to quickly tail a favorite log group`
  );
}

async function tailFavorite(
  keyword: string,
  filterPattern: string | null = null
): Promise<void> {
  const favorites = config.get("favorites");
  const logGroupName = favorites[keyword];

  if (!logGroupName) {
    throw new Error(`No favorite found with keyword "${keyword}"`);
  }

  console.log(
    chalk.green(`Using favorite "${keyword}" for log group: ${logGroupName}`)
  );
  await tailLogs(logGroupName, filterPattern);
}

function saveRecentSearch(searchPattern: string): void {
  const recentSearches = config.get("recentSearches");

  // Add to beginning, remove duplicates, keep max 10
  const updatedSearches = [
    searchPattern,
    ...recentSearches.filter((s) => s !== searchPattern),
  ].slice(0, 10);

  config.set("recentSearches", updatedSearches);
}

function listRecentSearches(): void {
  const recentSearches = config.get("recentSearches");

  if (recentSearches.length === 0) {
    console.log(chalk.yellow("No recent searches."));
    return;
  }

  console.log(chalk.bold("\nRecent Searches:"));
  console.log(chalk.dim("─".repeat(50)));

  recentSearches.forEach((search, index) => {
    console.log(`${chalk.blue((index + 1).toString().padEnd(3))} ${search}`);
  });

  console.log(chalk.dim("─".repeat(50)));
  console.log(
    `\nUse ${chalk.blue(
      'cwl filter <logGroup> "<search-text>"'
    )} to search logs`
  );
}
