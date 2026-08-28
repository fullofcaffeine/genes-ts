#!/usr/bin/env node

import {
  checkGenesAgentGuidance,
  GenesAgentGuidanceError,
  installGenesAgentGuidance,
} from "./agents/index.js";

function help(): string {
  return `Genes tooling

Usage:
  genes agents install [--root <project-root>]
  genes agents check [--root <project-root>]
  genes --help

Commands:
  agents install  Create or update the managed block in root AGENTS.md.
  agents check    Verify that root AGENTS.md has the current managed block.

The default project root is the current working directory.
`;
}

interface AgentsCommand {
  readonly action: "check" | "install";
  readonly root: string;
}

function parseArguments(args: readonly string[]): AgentsCommand | "help" {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return "help";
  }
  if (args[0] !== "agents" || (args[1] !== "install" && args[1] !== "check")) {
    throw new Error("Expected `genes agents install` or `genes agents check`.");
  }
  let root = process.cwd();
  let hasRoot = false;
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== "--root" || hasRoot) {
      throw new Error(`Unknown or duplicate argument: ${argument ?? ""}`);
    }
    const value = args[index + 1];
    if (value === undefined) throw new Error("--root requires a project path.");
    root = value;
    hasRoot = true;
    index += 1;
  }
  return { action: args[1], root };
}

function main(args: readonly string[]): number {
  let command: AgentsCommand | "help";
  try {
    command = parseArguments(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`genes: ${message}\n\n${help()}`);
    return 2;
  }
  if (command === "help") {
    process.stdout.write(help());
    return 0;
  }

  try {
    if (command.action === "install") {
      const result = installGenesAgentGuidance(command.root);
      process.stdout.write(
        `genes agents: ${result.action} ${result.path} (v${result.version})\n`,
      );
      return 0;
    }
    const result = checkGenesAgentGuidance(command.root);
    const output = `genes agents: ${result.status} ${result.path} (v${result.version})\n`;
    if (result.status === "current") {
      process.stdout.write(output);
      return 0;
    }
    process.stderr.write(output);
    return 1;
  } catch (error) {
    if (error instanceof GenesAgentGuidanceError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

process.exitCode = main(process.argv.slice(2));
