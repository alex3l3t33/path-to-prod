import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  globalIgnores([
    "node_modules",
    "main.js",
    "esbuild.config.mjs",
    "tests/dashboard-preview.html"
  ]),
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"]
        }
      }
    },
    rules: {
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          brands: [
            "Atlassian",
            "GitHub",
            "Jira",
            "Kanban",
            "Obsidian",
            "Path to Prod",
            "Scrum"
          ],
          acronyms: ["API", "HTTP", "HTTPS", "ICS", "JQL", "URL"]
        }
      ]
    }
  }
]);
