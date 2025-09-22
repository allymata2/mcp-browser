#!/usr/bin/env node

import { promises as fs } from "fs";
import path from "path";
import { parse } from "@babel/parser";
import * as babelTraverse from "@babel/traverse";
import * as t from "@babel/types";

const traverse = babelTraverse.default || babelTraverse;

class TaintAnalyzer {
  constructor() {
    this.taintedVariables = new Set();
    this.taintSources = new Set();
    this.networkCalls = [];
    this.apiEndpoints = [];
    this.dangerousPatterns = [];
    this.astErrors = [];
  }

  analyzeFile(filePath, content) {
    console.log(`🔍 Analyzing: ${filePath}`);

    try {
      const ast = parse(content, {
        sourceType: "module",
        allowImportExportEverywhere: true,
        allowReturnOutsideFunction: true,
        plugins: [
          "jsx",
          "typescript",
          "decorators-legacy",
          "classProperties",
          "asyncGenerators",
          "functionBind",
          "exportDefaultFrom",
          "exportNamespaceFrom",
          "dynamicImport",
          "nullishCoalescingOperator",
          "optionalChaining",
        ],
      });

      const analysis = {
        file: filePath,
        taintedVariables: new Set(),
        networkCalls: [],
        apiEndpoints: [],
        dangerousPatterns: [],
        taintSources: new Set(),
      };

      traverse(ast, {
        // Detect taint sources
        CallExpression: (path) => {
          this.detectTaintSources(path, analysis);
          this.detectNetworkCalls(path, analysis);
        },

        // Track variable assignments
        AssignmentExpression: (path) => {
          this.trackVariableAssignment(path, analysis);
        },

        // Track variable declarations
        VariableDeclarator: (path) => {
          this.trackVariableDeclaration(path, analysis);
        },

        // Detect dangerous patterns
        BinaryExpression: (path) => {
          this.detectDangerousPatterns(path, analysis);
        },

        // Detect template literals with potential injection
        TemplateLiteral: (path) => {
          this.detectTemplateLiteralInjection(path, analysis);
        },
      });

      return analysis;
    } catch (error) {
      console.warn(`⚠️  AST parsing failed for ${filePath}: ${error.message}`);
      this.astErrors.push({
        file: filePath,
        error: error.message,
      });
      return null;
    }
  }

  detectTaintSources(path, analysis) {
    const { node } = path;

    // Common taint sources
    const taintSources = [
      "location.href",
      "location.search",
      "location.hash",
      "document.URL",
      "document.referrer",
      "window.name",
      "document.cookie",
      "localStorage.getItem",
      "sessionStorage.getItem",
      "URLSearchParams.get",
      "new URLSearchParams",
      "req.query",
      "req.params",
      "req.body",
      "req.headers",
    ];

    if (t.isMemberExpression(node.callee)) {
      const source = this.getMemberExpressionString(node.callee);
      if (taintSources.includes(source)) {
        analysis.taintSources.add(source);
        this.taintedVariables.add(source);
      }
    }

    // Detect user input sources
    if (t.isIdentifier(node.callee)) {
      const source = node.callee.name;
      if (["prompt", "confirm", "alert"].includes(source)) {
        analysis.taintSources.add(source);
      }
    }
  }

  detectNetworkCalls(path, analysis) {
    const { node } = path;

    // Detect fetch calls
    if (t.isIdentifier(node.callee) && node.callee.name === "fetch") {
      const callInfo = this.extractCallInfo(path);
      if (callInfo) {
        analysis.networkCalls.push({
          type: "fetch",
          ...callInfo,
          line: path.node.loc?.start.line || 0,
        });

        analysis.apiEndpoints.push({
          method: "GET", // Default, could be enhanced
          url: callInfo.url,
          line: path.node.loc?.start.line || 0,
          riskLevel: this.isTainted(callInfo.url) ? "HIGH" : "MEDIUM",
          context: this.getContext(path, 3),
        });
      }
    }

    // Detect axios calls
    if (t.isMemberExpression(node.callee)) {
      const method = this.getMemberExpressionString(node.callee);
      if (
        method.startsWith("axios.") ||
        method.includes(".get") ||
        method.includes(".post")
      ) {
        const callInfo = this.extractCallInfo(path);
        if (callInfo) {
          analysis.networkCalls.push({
            type: "axios",
            method: method,
            ...callInfo,
            line: path.node.loc?.start.line || 0,
          });
        }
      }
    }

    // Detect XMLHttpRequest
    if (t.isNewExpression(node) && t.isIdentifier(node.callee)) {
      if (node.callee.name === "XMLHttpRequest") {
        analysis.networkCalls.push({
          type: "XMLHttpRequest",
          line: path.node.loc?.start.line || 0,
          context: this.getContext(path, 3),
        });
      }
    }
  }

  extractCallInfo(path) {
    const { node } = path;

    if (node.arguments.length === 0) return null;

    const firstArg = node.arguments[0];
    let url = "";

    if (t.isStringLiteral(firstArg)) {
      url = firstArg.value;
    } else if (t.isTemplateLiteral(firstArg)) {
      url = this.extractTemplateLiteral(firstArg);
    } else if (t.isIdentifier(firstArg)) {
      url = `$${firstArg.name}`;
    }

    return {
      url: url,
      isTainted: this.isTainted(url),
      context: this.getContext(path, 3),
    };
  }

  extractTemplateLiteral(templateLiteral) {
    let result = "";
    for (let i = 0; i < templateLiteral.quasis.length; i++) {
      result += templateLiteral.quasis[i].value.raw;
      if (i < templateLiteral.expressions.length) {
        const expr = templateLiteral.expressions[i];
        if (t.isIdentifier(expr)) {
          result += `$${expr.name}`;
        } else if (t.isMemberExpression(expr)) {
          result += `$${this.getMemberExpressionString(expr)}`;
        }
      }
    }
    return result;
  }

  getMemberExpressionString(memberExpr) {
    if (t.isIdentifier(memberExpr.object)) {
      return `${memberExpr.object.name}.${memberExpr.property.name}`;
    } else if (t.isMemberExpression(memberExpr.object)) {
      return `${this.getMemberExpressionString(memberExpr.object)}.${memberExpr.property.name}`;
    }
    return "";
  }

  trackVariableAssignment(path, analysis) {
    const { node } = path;

    if (t.isIdentifier(node.left)) {
      const varName = node.left.name;

      // Check if right side is tainted
      if (this.isExpressionTainted(node.right)) {
        analysis.taintedVariables.add(varName);
        this.taintedVariables.add(varName);
      }
    }
  }

  trackVariableDeclaration(path, analysis) {
    const { node } = path;

    if (t.isIdentifier(node.id)) {
      const varName = node.id.name;

      if (node.init && this.isExpressionTainted(node.init)) {
        analysis.taintedVariables.add(varName);
        this.taintedVariables.add(varName);
      }
    }
  }

  detectDangerousPatterns(path, analysis) {
    const { node } = path;

    // Detect string concatenation with potentially tainted data
    if (node.operator === "+") {
      if (
        this.isExpressionTainted(node.left) ||
        this.isExpressionTainted(node.right)
      ) {
        analysis.dangerousPatterns.push({
          type: "string_concat",
          line: path.node.loc?.start.line || 0,
          context: this.getContext(path, 2),
        });
      }
    }
  }

  detectTemplateLiteralInjection(path, analysis) {
    const { node } = path;

    // Check if template literal contains tainted expressions
    for (const expr of node.expressions) {
      if (this.isExpressionTainted(expr)) {
        analysis.dangerousPatterns.push({
          type: "template_literal_injection",
          line: path.node.loc?.start.line || 0,
          context: this.getContext(path, 2),
        });
        break;
      }
    }
  }

  isExpressionTainted(expr) {
    if (t.isIdentifier(expr)) {
      return this.taintedVariables.has(expr.name);
    }

    if (t.isMemberExpression(expr)) {
      const memberStr = this.getMemberExpressionString(expr);
      return this.taintedVariables.has(memberStr);
    }

    if (t.isCallExpression(expr)) {
      if (t.isMemberExpression(expr.callee)) {
        const method = this.getMemberExpressionString(expr.callee);
        return this.taintSources.has(method);
      }
    }

    return false;
  }

  isTainted(value) {
    if (typeof value !== "string") return false;

    // Check for tainted variable references
    for (const taintedVar of this.taintedVariables) {
      if (value.includes(taintedVar)) return true;
    }

    return false;
  }

  getContext(path, lines) {
    const loc = path.node.loc;
    if (!loc) return "";

    const startLine = Math.max(1, loc.start.line - lines);
    const endLine = loc.end.line + lines;

    return `Lines ${startLine}-${endLine}`;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage: node analyze-js.js <js-files-path> <output-path>");
    console.log(
      "Example: node analyze-js.js ./js_downloads ./analysis_results"
    );
    process.exit(1);
  }

  const [jsFilesPath, outputPath] = args;

  console.log("🚀 Starting JavaScript AST and Taint Analysis...");
  console.log(`📁 JS Files Path: ${jsFilesPath}`);
  console.log(`📁 Output Path: ${outputPath}`);

  try {
    // Create output directory
    await fs.mkdir(outputPath, { recursive: true });

    const analyzer = new TaintAnalyzer();
    const results = {
      timestamp: new Date().toISOString(),
      summary: {
        totalFiles: 0,
        analyzedFiles: 0,
        astErrors: 0,
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
      astErrors: [],
    };

    // Get all JavaScript files
    const jsFiles = await getJavaScriptFiles(jsFilesPath);
    results.summary.totalFiles = jsFiles.length;

    console.log(`📄 Found ${jsFiles.length} JavaScript files to analyze`);

    // Analyze each file
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

          // Add taint sources
          for (const source of analysis.taintSources) {
            if (!results.taintSources.includes(source)) {
              results.taintSources.push(source);
            }
          }
        }
      } catch (error) {
        console.warn(`⚠️  Error analyzing ${filePath}: ${error.message}`);
      }
    }

    // Add AST errors
    results.astErrors = analyzer.astErrors;
    results.summary.astErrors = analyzer.astErrors.length;

    // Update summary
    results.summary.totalNetworkCalls = results.networkCalls.length;
    results.summary.totalApiEndpoints = results.apiEndpoints.length;
    results.summary.totalDangerousPatterns = results.dangerousPatterns.length;
    results.summary.totalTaintSources = results.taintSources.length;

    // Save results
    const resultsPath = path.join(outputPath, "ast_taint_analysis.json");
    await fs.writeFile(resultsPath, JSON.stringify(results, null, 2));

    // Generate summary report
    const summaryPath = path.join(outputPath, "analysis_summary.txt");
    const summary = generateSummaryReport(results);
    await fs.writeFile(summaryPath, summary);

    console.log("\n✅ Analysis completed!");
    console.log(`📊 Results:`);
    console.log(`- Total Files: ${results.summary.totalFiles}`);
    console.log(`- Analyzed Files: ${results.summary.analyzedFiles}`);
    console.log(`- AST Errors: ${results.summary.astErrors}`);
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
  let report = `# JavaScript AST and Taint Analysis Report\n\n`;
  report += `**Generated:** ${results.timestamp}\n\n`;

  report += `## Summary\n\n`;
  report += `- **Total Files:** ${results.summary.totalFiles}\n`;
  report += `- **Analyzed Files:** ${results.summary.analyzedFiles}\n`;
  report += `- **AST Errors:** ${results.summary.astErrors}\n`;
  report += `- **Network Calls:** ${results.summary.totalNetworkCalls}\n`;
  report += `- **API Endpoints:** ${results.summary.totalApiEndpoints}\n`;
  report += `- **Dangerous Patterns:** ${results.summary.totalDangerousPatterns}\n`;
  report += `- **Taint Sources:** ${results.summary.totalTaintSources}\n\n`;

  if (results.taintSources.length > 0) {
    report += `## Taint Sources\n\n`;
    results.taintSources.forEach((source, index) => {
      report += `${index + 1}. ${source}\n`;
    });
    report += `\n`;
  }

  if (results.networkCalls.length > 0) {
    report += `## Network Calls\n\n`;
    results.networkCalls.forEach((call, index) => {
      report += `${index + 1}. **${call.type}** ${call.url || "N/A"}\n`;
      report += `   - File: ${call.file}\n`;
      report += `   - Line: ${call.line}\n`;
      report += `   - Tainted: ${call.isTainted ? "Yes" : "No"}\n`;
      if (call.context) {
        report += `   - Context: ${call.context}\n`;
      }
      report += `\n`;
    });
  }

  if (results.apiEndpoints.length > 0) {
    report += `## API Endpoints\n\n`;
    results.apiEndpoints.forEach((endpoint, index) => {
      report += `${index + 1}. **${endpoint.method}** ${endpoint.url}\n`;
      report += `   - File: ${endpoint.file}\n`;
      report += `   - Line: ${endpoint.line}\n`;
      report += `   - Risk Level: ${endpoint.riskLevel}\n`;
      if (endpoint.context) {
        report += `   - Context: ${endpoint.context}\n`;
      }
      report += `\n`;
    });
  }

  if (results.dangerousPatterns.length > 0) {
    report += `## Dangerous Patterns\n\n`;
    results.dangerousPatterns.forEach((pattern, index) => {
      report += `${index + 1}. **${pattern.type}**\n`;
      report += `   - File: ${pattern.file}\n`;
      report += `   - Line: ${pattern.line}\n`;
      if (pattern.context) {
        report += `   - Context: ${pattern.context}\n`;
      }
      report += `\n`;
    });
  }

  if (results.astErrors.length > 0) {
    report += `## AST Parsing Errors\n\n`;
    results.astErrors.forEach((error, index) => {
      report += `${index + 1}. **${error.file}**\n`;
      report += `   - Error: ${error.error}\n\n`;
    });
  }

  return report;
}

// Run the analysis
main().catch(console.error);
