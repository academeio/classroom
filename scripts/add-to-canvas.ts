/**
 * Canvas Module Item Automation Script
 *
 * Adds a classroom URL as an ExternalUrl module item in Canvas LMS.
 *
 * Usage:
 *   npx tsx scripts/add-to-canvas.ts \
 *     --institution sbv \
 *     --course 374 \
 *     --module 12488 \
 *     --title "Interactive Classroom: Brachial Plexus" \
 *     --url "https://classroom.cbme.in/classroom/abc123"
 *
 * Environment variables (per institution):
 *   CANVAS_API_URL_SBV=https://sbvlms.cloudintegral.com
 *   CANVAS_API_TOKEN_SBV=<your-token>
 */

interface Args {
  institution: string;
  course: string;
  module: string;
  title: string;
  url: string;
}

function printUsage(): void {
  console.log(`
Usage:
  npx tsx scripts/add-to-canvas.ts \\
    --institution <institution> \\
    --course <course_id> \\
    --module <module_id> \\
    --title "<item title>" \\
    --url "<classroom URL>"

Required arguments:
  --institution   Institution key (e.g., sbv, santosh). Used to look up
                  CANVAS_API_URL_<INSTITUTION> and CANVAS_API_TOKEN_<INSTITUTION>
                  environment variables.
  --course        Canvas course ID (numeric).
  --module        Canvas module ID (numeric).
  --title         Title for the module item.
  --url           Classroom URL to add as an External URL item.

Environment variables:
  CANVAS_API_URL_<INSTITUTION>    Base URL of the Canvas instance
  CANVAS_API_TOKEN_<INSTITUTION>  API access token for the Canvas instance

Example:
  CANVAS_API_URL_SBV=https://sbvlms.cloudintegral.com \\
  CANVAS_API_TOKEN_SBV=your_token_here \\
  npx tsx scripts/add-to-canvas.ts \\
    --institution sbv \\
    --course 374 \\
    --module 12488 \\
    --title "Interactive Classroom: Brachial Plexus" \\
    --url "https://classroom.cbme.in/classroom/abc123"
`);
}

function parseArgs(argv: string[]): Args | null {
  const args: Record<string, string> = {};
  const required = ['institution', 'course', 'module', 'title', 'url'];

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      return null;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[++i];
      if (!value) {
        console.error(`Missing value for --${key}`);
        return null;
      }
      args[key] = value;
    }
  }

  const missing = required.filter((k) => !args[k]);
  if (missing.length > 0) {
    console.error(`Missing required arguments: ${missing.map((m) => `--${m}`).join(', ')}`);
    return null;
  }

  return args as unknown as Args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) {
    printUsage();
    process.exit(1);
  }

  const institutionKey = args.institution.toUpperCase();
  const apiUrl = process.env[`CANVAS_API_URL_${institutionKey}`];
  const apiToken = process.env[`CANVAS_API_TOKEN_${institutionKey}`];

  if (!apiUrl) {
    console.error(`Environment variable CANVAS_API_URL_${institutionKey} is not set.`);
    process.exit(1);
  }
  if (!apiToken) {
    console.error(`Environment variable CANVAS_API_TOKEN_${institutionKey} is not set.`);
    process.exit(1);
  }

  const endpoint = `${apiUrl.replace(/\/$/, '')}/api/v1/courses/${args.course}/modules/${args.module}/items`;

  const body = {
    module_item: {
      type: 'ExternalUrl',
      title: args.title,
      external_url: args.url,
      new_tab: true,
    },
  };

  console.log(`Adding module item to Canvas...`);
  console.log(`  Institution: ${args.institution}`);
  console.log(`  Course ID:   ${args.course}`);
  console.log(`  Module ID:   ${args.module}`);
  console.log(`  Title:       ${args.title}`);
  console.log(`  URL:         ${args.url}`);
  console.log();

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Canvas API error (${response.status} ${response.statusText}):`);
      console.error(errorText);
      process.exit(1);
    }

    const item = await response.json();
    console.log('Module item created successfully!');
    console.log(`  Item ID:     ${item.id}`);
    console.log(`  Title:       ${item.title}`);
    console.log(`  Type:        ${item.type}`);
    console.log(`  URL:         ${item.external_url}`);
    console.log(`  Position:    ${item.position}`);
    console.log(`  HTML URL:    ${item.html_url}`);
  } catch (error) {
    console.error('Failed to connect to Canvas API:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
