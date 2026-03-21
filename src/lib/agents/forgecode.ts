import { join } from "path";

export async function generateForgeCodeConfig(projectDir: string): Promise<string> {
  const configPath = join(projectDir, "forge.yaml");
  const file = Bun.file(configPath);

  let existing = "";
  if (await file.exists()) {
    existing = await file.text();
  }

  // If custom_rules already references AGENTS.md, leave it alone
  if (existing.includes("AGENTS.md")) {
    return existing;
  }

  // Append memory reference to custom_rules
  if (existing.includes("custom_rules:")) {
    // Append to existing custom_rules
    return existing.replace(
      /custom_rules:\s*\|/,
      `custom_rules: |\n  - Follow the memory protocol defined in AGENTS.md`
    );
  }

  // Add custom_rules section
  const addition = `\ncustom_rules: |\n  - Follow the memory protocol defined in AGENTS.md\n`;
  return existing ? existing.trimEnd() + "\n" + addition : addition;
}

export function getForgeCodeConfigPath(): string {
  return "forge.yaml";
}
