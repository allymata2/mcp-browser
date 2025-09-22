#!/usr/bin/env node

const { promises: fs } = require("fs");
const path = require("path");
const acorn = require("acorn");
const walk = require("acorn-walk");

class AcornAnalyzer {
  constructor() {
    this.networkCalls = [];
    this.apiEndpoints = [];
    this.dangerousPatterns = [];
    this.taintSources = [];
  }

  analyzeFile(filePath, content) {
    try {
      const ast = acorn.parse(content, {
        ecmaVersion: 2020,
        sourceType: "module",
        allowHashBang: true,
        allowImportExportEverywhere: true,
        allowAwaitOutsideFunction: true,
      });

      const analysis = {
        file: filePath,
        networkCalls: [],
        apiEndpoints: [],
        dangerousPatterns: [],
        taintSources: [],
      };

      walk.simple(ast, {
        CallExpression: (node) => {
          this.analyzeCallExpression(node, analysis);
        },
        NewExpression: (node) => {
          this.analyzeNewExpression(node, analysis);
        },
        AssignmentExpression: (node) => {
          this.analyzeAssignment(node, analysis);
        },
      });

      return analysis;
    } catch (error) {
      console.error(`❌ Error parsing ${filePath}:`, error.message);
      return null;
    }
  }

  analyzeCallExpression(node, analysis) {
    const callee = node.callee;

    // Fetch calls
    if (callee.type === "Identifier" && callee.name === "fetch") {
      const url = this.extractUrl(node.arguments[0]);
      analysis.networkCalls.push({
        type: "fetch",
        url: url,
        method: "GET",
        line: node.loc?.start.line || 0,
        context: this.getContext(node),
      });
    }

    // Axios calls
    if (callee.type === "MemberExpression") {
      const object = callee.object;
      const property = callee.property;

      if (object.type === "Identifier" && object.name === "axios") {
        const method = property.name;
        const url = this.extractUrl(node.arguments[0]);

        analysis.networkCalls.push({
          type: "axios",
          url: url,
          method: method.toUpperCase(),
          line: node.loc?.start.line || 0,
          context: this.getContext(node),
        });
      }
    }

    // XMLHttpRequest
    if (
      callee.type === "NewExpression" &&
      callee.callee?.name === "XMLHttpRequest"
    ) {
      analysis.networkCalls.push({
        type: "XMLHttpRequest",
        url: "N/A",
        method: "N/A",
        line: node.loc?.start.line || 0,
        context: this.getContext(node),
      });
    }
  }

  analyzeNewExpression(node, analysis) {
    if (node.callee.name === "XMLHttpRequest") {
      analysis.networkCalls.push({
        type: "XMLHttpRequest",
        url: "N/A",
        method: "N/A",
        line: node.loc?.start.line || 0,
        context: this.getContext(node),
      });
    }
  }

  analyzeAssignment(node, analysis) {
    // Detect potential taint sources
    if (node.left.type === "Identifier") {
      const varName = node.left.name;

      if (this.isTaintSource(node.right)) {
        analysis.taintSources.push({
          variable: varName,
          source: this.getTaintSource(node.right),
          line: node.loc?.start.line || 0,
        });
      }
    }
  }

  extractUrl(arg) {
    if (!arg) return "N/A";

    if (arg.type === "Literal") {
      return arg.value;
    } else if (arg.type === "TemplateLiteral") {
      return `Template: ${arg.quasis.map((q) => q.value.raw).join("")}`;
    } else if (arg.type === "Identifier") {
      return `$${arg.name}`;
    }

    return "N/A";
  }

  isTaintSource(node) {
    if (!node) return false;

    // Check for user input sources
    const taintPatterns = [
      "location",
      "document",
      "window",
      "navigator",
      "localStorage",
      "sessionStorage",
      "cookie",
    ];

    if (node.type === "MemberExpression") {
      const object = node.object;
      if (object.type === "Identifier" && taintPatterns.includes(object.name)) {
        return true;
      }
    }

    return false;
  }

  getTaintSource(node) {
    if (node.type === "MemberExpression") {
      return `${node.object.name}.${node.property.name}`;
    }
    return "Unknown";
  }

  getContext(node) {
    const loc = node.loc;
    if (!loc) return "N/A";

    return `Lines ${loc.start.line}-${loc.end.line}`;
  }
}

async function getJavaScriptFiles(dirPath) {
  const files = [];

  async function scanDirectory(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await scanDirectory(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        files.push(fullPath);
      }
    }
  }

  await scanDirectory(dirPath);
  return files;
}

function generateSummaryReport(results) {
  let report = `# JavaScript AST Analysis Report (Acorn)\n\n`;
  report += `**Generated:** ${results.timestamp}\n\n`;

  report += `## Summary\n\n`;
  report += `- **Total Files:** ${results.summary.totalFiles}\n`;
  report += `- **Analyzed Files:** ${results.summary.analyzedFiles}\n`;
  report += `- **Network Calls:** ${results.summary.totalNetworkCalls}\n`;
  report += `- **API Endpoints:** ${results.summary.totalApiEndpoints}\n`;
  report += `- **Dangerous Patterns:** ${results.summary.totalDangerousPatterns}\n`;
  report += `- **Taint Sources:** ${results.summary.totalTaintSources}\n\n`;

  if (results.networkCalls.length > 0) {
    report += `## Network Calls\n\n`;
    results.networkCalls.forEach((call, index) => {
      report += `${index + 1}. **${call.type}** ${call.url}\n`;
      report += `   - Method: ${call.method}\n`;
      report += `   - Line: ${call.line}\n`;
      report += `   - Context: ${call.context}\n\n`;
    });
  }

  if (results.taintSources.length > 0) {
    report += `## Taint Sources\n\n`;
    results.taintSources.forEach((source, index) => {
      report += `${index + 1}. **${source.variable}** = ${source.source}\n`;
      report += `   - Line: ${source.line}\n\n`;
    });
  }

  return report;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(
      "Usage: node analyze-js-acorn.cjs <js-files-path> <output-path>"
    );
    console.log(
      "Example: node analyze-js-acorn.cjs ./juice_js_files ./acorn_results"
    );
    process.exit(1);
  }

  const [jsFilesPath, outputPath] = args;

  console.log("🚀 Starting JavaScript AST Analysis with Acorn...");
  console.log(`📁 JS Files Path: ${jsFilesPath}`);
  console.log(`📁 Output Path: ${outputPath}`);

  const analyzer = new AcornAnalyzer();
  const results = {
    timestamp: new Date().toISOString(),
    summary: {
      totalFiles: 0,
      analyzedFiles: 0,
      totalNetworkCalls: 0,
      totalApiEndpoints: 0,
      totalDangerousPatterns: 0,
      totalTaintSources: 0,
    },
    files: [],
    networkCalls: [],
    apiEndpoints: [],
    dangerousPatterns: [],
    taintSources: [],
  };

  try {
    const jsFiles = await getJavaScriptFiles(jsFilesPath);
    results.summary.totalFiles = jsFiles.length;

    // Create output directory
    await fs.mkdir(outputPath, { recursive: true });

    for (const filePath of jsFiles) {
      try {
        const content = await fs.readFile(filePath, "utf8");
        const analysis = analyzer.analyzeFile(filePath, content);

        if (analysis) {
          results.files.push(analysis);
          results.summary.analyzedFiles++;

          // Aggregate results
          results.networkCalls.push(...analysis.networkCalls);
          results.apiEndpoints.push(...analysis.apiEndpoints);
          results.dangerousPatterns.push(...analysis.dangerousPatterns);
          results.taintSources.push(...analysis.taintSources);
        }
      } catch (fileError) {
        console.error(
          `❌ Error analyzing file ${filePath}:`,
          fileError.message
        );
      }
    }

    results.summary.totalNetworkCalls = results.networkCalls.length;
    results.summary.totalApiEndpoints = results.apiEndpoints.length;
    results.summary.totalDangerousPatterns = results.dangerousPatterns.length;
    results.summary.totalTaintSources = results.taintSources.length;

    // Save results
    const resultsPath = path.join(outputPath, "acorn_analysis.json");
    await fs.writeFile(resultsPath, JSON.stringify(results, null, 2));

    // Generate summary report
    const summaryPath = path.join(outputPath, "acorn_summary.txt");
    const summary = generateSummaryReport(results);
    await fs.writeFile(summaryPath, summary);

    console.log("\n✅ Analysis completed!");
    console.log(`📊 Results:`);
    console.log(`- Total Files: ${results.summary.totalFiles}`);
    console.log(`- Analyzed Files: ${results.summary.analyzedFiles}`);
    console.log(`- Network Calls: ${results.summary.totalNetworkCalls}`);
    console.log(`- API Endpoints: ${results.summary.totalApiEndpoints}`);
    console.log(
      `- Dangerous Patterns: ${results.summary.totalDangerousPatterns}`
    );
    console.log(`- Taint Sources: ${results.summary.totalTaintSources}`);
    console.log(`\n📁 Results saved to: ${outputPath}`);
  } catch (error) {
    console.error("❌ Analysis failed:", error);
    process.exit(1);
  }
}

// Run the analysis
main().catch(console.error);
