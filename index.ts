#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { chromium, firefox, webkit, Browser, Page, BrowserContext } from 'playwright';
import { promises as fs } from 'fs';
import path from 'path';

interface BrowserSession {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  browserType: 'chromium' | 'firefox' | 'webkit';
  networkLogPath?: string;
  networkLogStream?: NodeJS.WriteStream;
}

class MCPBrowserServer {
  private server: Server;
  private sessions: Map<string, BrowserSession> = new Map();
  private defaultSessionId = 'default';

  constructor() {
    this.server = new Server(
      {
        name: "mcp-browser",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.cleanup();
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "browser_navigate",
          description: "Navigate to a URL in the browser",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL to navigate to" },
              waitFor: { type: "string", enum: ["load", "domcontentloaded", "networkidle"], default: "load" },
              sessionId: { type: "string", description: "Browser session ID", default: "default" },
              browser: { type: "string", enum: ["chromium", "firefox", "webkit"], default: "chromium" },
              viewport: {
                type: "object",
                properties: {
                  width: { type: "number", default: 1280 },
                  height: { type: "number", default: 720 }
                }
              }
            },
            required: ["url"]
          }
        },
        {
          name: "browser_click",
          description: "Click on an element",
          inputSchema: {
            type: "object",
            properties: {
              selector: { type: "string", description: "CSS selector of element to click" },
              sessionId: { type: "string", default: "default" },
              waitFor: { type: "number", description: "Wait time after click (ms)", default: 1000 },
              force: { type: "boolean", description: "Force click even if element not visible", default: false }
            },
            required: ["selector"]
          }
        },
        {
          name: "browser_type",
          description: "Type text into an element",
          inputSchema: {
            type: "object",
            properties: {
              selector: { type: "string", description: "CSS selector of element to type into" },
              text: { type: "string", description: "Text to type" },
              sessionId: { type: "string", default: "default" },
              clear: { type: "boolean", description: "Clear existing text first", default: true },
              delay: { type: "number", description: "Delay between keystrokes (ms)", default: 50 }
            },
            required: ["selector", "text"]
          }
        },
        {
          name: "browser_screenshot",
          description: "Take a screenshot of the page or element",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to save screenshot" },
              sessionId: { type: "string", default: "default" },
              selector: { type: "string", description: "CSS selector to screenshot specific element" },
              fullPage: { type: "boolean", description: "Take full page screenshot", default: false },
              type: { type: "string", enum: ["png", "jpeg"], description: "Image format", default: "png" },
              quality: { type: "number", description: "JPEG quality (0-100, only for JPEG)", default: 90 }
            },
            required: ["path"]
          }
        },
        {
          name: "browser_extract_text",
          description: "Extract text content from elements",
          inputSchema: {
            type: "object",
            properties: {
              selector: { type: "string", description: "CSS selector of elements to extract text from" },
              sessionId: { type: "string", default: "default" },
              attribute: { type: "string", description: "Extract attribute instead of text" },
              multiple: { type: "boolean", description: "Extract from multiple matching elements", default: false }
            },
            required: ["selector"]
          }
        },
        {
          name: "browser_wait_for_element",
          description: "Wait for an element to appear",
          inputSchema: {
            type: "object",
            properties: {
              selector: { type: "string", description: "CSS selector to wait for" },
              sessionId: { type: "string", default: "default" },
              timeout: { type: "number", description: "Timeout in milliseconds", default: 30000 },
              state: { type: "string", enum: ["visible", "hidden", "attached", "detached"], default: "visible" }
            },
            required: ["selector"]
          }
        },
        {
          name: "browser_fill_form",
          description: "Fill out a form with multiple fields",
          inputSchema: {
            type: "object",
            properties: {
              fields: {
                type: "object",
                description: "Object with selector:value pairs",
                additionalProperties: { type: "string" }
              },
              sessionId: { type: "string", default: "default" },
              submitSelector: { type: "string", description: "Submit button selector" },
              waitAfterSubmit: { type: "number", description: "Wait time after submit (ms)", default: 3000 }
            },
            required: ["fields"]
          }
        },
        {
          name: "browser_scroll",
          description: "Scroll the page",
          inputSchema: {
            type: "object",
            properties: {
              direction: { type: "string", enum: ["up", "down", "left", "right", "top", "bottom"], default: "down" },
              pixels: { type: "number", description: "Pixels to scroll", default: 500 },
              sessionId: { type: "string", default: "default" },
              selector: { type: "string", description: "Scroll specific element instead of page" }
            }
          }
        },
        {
          name: "browser_get_page_info",
          description: "Get current page information (title, URL, etc.)",
          inputSchema: {
            type: "object",
            properties: {
              sessionId: { type: "string", default: "default" },
              includeMetrics: { type: "boolean", description: "Include performance metrics", default: false }
            }
          }
        },
        {
          name: "browser_execute_script",
          description: "Execute JavaScript on the page",
          inputSchema: {
            type: "object",
            properties: {
              script: { type: "string", description: "JavaScript code to execute" },
              sessionId: { type: "string", default: "default" },
              args: { type: "array", description: "Arguments to pass to script" }
            },
            required: ["script"]
          }
        },
        {
          name: "browser_intercept_requests",
          description: "Intercept and monitor network requests",
          inputSchema: {
            type: "object",
            properties: {
              urlPattern: { type: "string", description: "URL pattern to intercept (glob)", default: "**" },
              sessionId: { type: "string", default: "default" },
              mockResponse: {
                type: "object",
                description: "Mock response to return",
                properties: {
                  status: { type: "number" },
                  body: {},
                  headers: { type: "object" }
                }
              }
            }
          }
        },
        {
          name: "browser_download_file",
          description: "Download files from the page",
          inputSchema: {
            type: "object",
            properties: {
              triggerSelector: { type: "string", description: "Element that triggers download" },
              downloadPath: { type: "string", description: "Directory to save downloads" },
              sessionId: { type: "string", default: "default" },
              timeout: { type: "number", description: "Download timeout (ms)", default: 30000 }
            },
            required: ["triggerSelector", "downloadPath"]
          }
        },
        {
          name: "browser_mobile_emulate",
          description: "Emulate mobile device",
          inputSchema: {
            type: "object",
            properties: {
              device: {
                type: "string",
                enum: ["iPhone 12", "iPhone 13", "iPhone 14", "iPad", "Samsung Galaxy S21", "Pixel 5"],
                description: "Device to emulate"
              },
              sessionId: { type: "string", default: "default" },
              orientation: { type: "string", enum: ["portrait", "landscape"], default: "portrait" }
            },
            required: ["device"]
          }
        },
        {
          name: "browser_close_session",
          description: "Close a browser session (browser stays open by default)",
          inputSchema: {
            type: "object",
            properties: {
              sessionId: { type: "string", default: "default" },
              keepBrowserOpen: { type: "boolean", description: "Keep browser window open", default: true }
            }
          }
        },
        {
          name: "browser_create_pdf",
          description: "Generate PDF from current page",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to save PDF" },
              sessionId: { type: "string", default: "default" },
              format: { type: "string", enum: ["A4", "A3", "Letter"], default: "A4" },
              printBackground: { type: "boolean", default: true },
              margin: {
                type: "object",
                properties: {
                  top: { type: "string", default: "1cm" },
                  bottom: { type: "string", default: "1cm" },
                  left: { type: "string", default: "1cm" },
                  right: { type: "string", default: "1cm" }
                }
              }
            },
            required: ["path"]
          }
        },
        {
          name: "browser_log_network_requests",
          description: "Start logging all network requests to a file",
          inputSchema: {
            type: "object",
            properties: {
              filePath: { type: "string", description: "Path to save network requests log" },
              sessionId: { type: "string", default: "default" },
              includeHeaders: { type: "boolean", description: "Include request/response headers", default: true },
              includeBody: { type: "boolean", description: "Include request/response body", default: false },
              filterUrl: { type: "string", description: "Optional URL filter (regex pattern)" }
            },
            required: ["filePath"]
          }
        },
        {
          name: "browser_scan_xss",
          description: "Scan for XSS vulnerabilities in loaded scripts and resources",
          inputSchema: {
            type: "object",
            properties: {
              sessionId: { type: "string", default: "default" },
              scanScripts: { type: "boolean", description: "Scan inline and external scripts", default: true },
              scanAttributes: { type: "boolean", description: "Scan HTML attributes for XSS", default: true },
              scanUrls: { type: "boolean", description: "Scan URL parameters for XSS", default: true },
              scanForms: { type: "boolean", description: "Scan form inputs for XSS", default: true },
              generatePoC: { type: "boolean", description: "Generate Proof of Concept HTTP requests", default: true },
              outputFile: { type: "string", description: "Optional file to save scan results" }
            }
          }
        },
        {
          name: "browser_interactive_xss_scan",
          description: "Interactive XSS scanner with automatic PoC testing and alert detection",
          inputSchema: {
            type: "object",
            properties: {
              sessionId: { type: "string", default: "default" },
              scanScripts: { type: "boolean", description: "Scan inline and external scripts", default: true },
              scanAttributes: { type: "boolean", description: "Scan HTML attributes for XSS", default: true },
              scanUrls: { type: "boolean", description: "Scan URL parameters for XSS", default: true },
              scanForms: { type: "boolean", description: "Scan form inputs for XSS", default: true },
              autoTestPoC: { type: "boolean", description: "Automatically test PoCs in browser", default: true },
              waitForAlert: { type: "number", description: "Wait time for alert detection (ms)", default: 3000 },
              outputFile: { type: "string", description: "Optional file to save scan results" }
            }
          }
        },
        {
          name: "browser_fetch_javascript_files",
          description: "Fetch and download all JavaScript files loaded by the web application",
          inputSchema: {
            type: "object",
            properties: {
              sessionId: { type: "string", default: "default" },
              downloadPath: { type: "string", description: "Directory to save JavaScript files" },
              includeInlineScripts: { type: "boolean", description: "Include inline scripts from HTML", default: true },
              includeExternalScripts: { type: "boolean", description: "Include external JavaScript files", default: true },
              includeDynamicScripts: { type: "boolean", description: "Include dynamically loaded scripts", default: true },
              filterUrl: { type: "string", description: "Optional URL filter (regex pattern)" },
              preserveStructure: { type: "boolean", description: "Preserve directory structure from URLs", default: true },
              generateManifest: { type: "boolean", description: "Generate manifest file with all downloaded files", default: true }
            },
            required: ["downloadPath"]
          }
        }
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case "browser_navigate":
            return await this.navigate(request.params.arguments as Parameters<typeof this.navigate>[0]);
          case "browser_click":
            return await this.click(request.params.arguments as Parameters<typeof this.click>[0]);
          case "browser_type":
            return await this.type(request.params.arguments as Parameters<typeof this.type>[0]);
          case "browser_screenshot":
            return await this.screenshot(request.params.arguments as Parameters<typeof this.screenshot>[0]);
          case "browser_extract_text":
            return await this.extractText(request.params.arguments as Parameters<typeof this.extractText>[0]);
          case "browser_wait_for_element":
            return await this.waitForElement(request.params.arguments as Parameters<typeof this.waitForElement>[0]);
          case "browser_fill_form":
            return await this.fillForm(request.params.arguments as Parameters<typeof this.fillForm>[0]);
          case "browser_scroll":
            return await this.scroll(request.params.arguments as Parameters<typeof this.scroll>[0]);
          case "browser_get_page_info":
            return await this.getPageInfo(request.params.arguments as Parameters<typeof this.getPageInfo>[0]);
          case "browser_execute_script":
            return await this.executeScript(request.params.arguments as Parameters<typeof this.executeScript>[0]);
          case "browser_intercept_requests":
            return await this.interceptRequests(request.params.arguments as Parameters<typeof this.interceptRequests>[0]);
          case "browser_download_file":
            return await this.downloadFile(request.params.arguments as Parameters<typeof this.downloadFile>[0]);
          case "browser_mobile_emulate":
            return await this.mobileEmulate(request.params.arguments as Parameters<typeof this.mobileEmulate>[0]);
          case "browser_close_session":
            return await this.closeSession(request.params.arguments as Parameters<typeof this.closeSession>[0]);
          case "browser_create_pdf":
            return await this.createPDF(request.params.arguments as Parameters<typeof this.createPDF>[0]);
          case "browser_log_network_requests":
            return await this.logNetworkRequests(request.params.arguments as Parameters<typeof this.logNetworkRequests>[0]);
          case "browser_scan_xss":
            return await this.scanXSS(request.params.arguments as Parameters<typeof this.scanXSS>[0]);
          case "browser_interactive_xss_scan":
            return await this.interactiveXSSScan(request.params.arguments as Parameters<typeof this.interactiveXSSScan>[0]);
          case "browser_fetch_javascript_files":
            return await this.fetchJavaScriptFiles(request.params.arguments as Parameters<typeof this.fetchJavaScriptFiles>[0]);
          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: error instanceof Error ? error.message : "Unknown error",
                tool: request.params.name
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async getOrCreateSession(
    sessionId: string,
    browserType: 'chromium' | 'firefox' | 'webkit' = 'chromium',
    viewport?: { width: number; height: number }
  ): Promise<BrowserSession> {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }

    let browser: Browser;
    switch (browserType) {
      case 'firefox':
        browser = await firefox.launch({
          headless: false,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        break;
      case 'webkit':
        browser = await webkit.launch({
          headless: false
        });
        break;
      default:
        browser = await chromium.launch({
          headless: false,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
    }

    const context = await browser.newContext({
      viewport: viewport || { width: 1280, height: 720 }
    });

    const page = await context.newPage();

    const session: BrowserSession = {
      id: sessionId,
      browser,
      context,
      page,
      browserType
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  private async navigate(args: {
    url: string;
    waitFor?: 'load' | 'domcontentloaded' | 'networkidle';
    sessionId?: string;
    browser?: 'chromium' | 'firefox' | 'webkit';
    viewport?: { width: number; height: number }
  }) {
    const { url, waitFor = 'load', sessionId = 'default', browser = 'chromium', viewport } = args;
    const session = await this.getOrCreateSession(sessionId, browser, viewport);

    await session.page.goto(url, { waitUntil: waitFor });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            url: session.page.url(),
            title: await session.page.title(),
            sessionId
          }, null, 2),
        },
      ],
    };
  }

  private async click(args: {
    selector: string;
    sessionId?: string;
    waitFor?: number;
    force?: boolean
  }) {
    const { selector, sessionId = 'default', waitFor = 1000, force = false } = args;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    await session.page.click(selector, { force });
    if (waitFor > 0) {
      await session.page.waitForTimeout(waitFor);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            action: 'click',
            selector
          }, null, 2),
        },
      ],
    };
  }

  private async type(args: {
    selector: string;
    text: string;
    sessionId?: string;
    clear?: boolean;
    delay?: number
  }) {
    const { selector, text, sessionId = 'default', clear = true, delay = 50 } = args;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    if (clear) {
      await session.page.fill(selector, '');
    }
    await session.page.type(selector, text, { delay });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            action: 'type',
            selector,
            text: text.substring(0, 100) + (text.length > 100 ? '...' : '')
          }, null, 2),
        },
      ],
    };
  }

  private async screenshot(args: {
    path: string;
    sessionId?: string;
    selector?: string;
    fullPage?: boolean;
    quality?: number;
    type?: 'png' | 'jpeg'
  }) {
    const { path, sessionId = 'default', selector, fullPage = false, quality = 90, type } = args;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Auto-detect type from file extension if not specified
    const fileType = type || (path.toLowerCase().endsWith('.jpg') || path.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png');

    const options: { path: string; type: 'png' | 'jpeg'; fullPage?: boolean; quality?: number } = {
      path,
      type: fileType as 'png' | 'jpeg'
    };

    if (fullPage) options.fullPage = true;

    // Only add quality for JPEG
    if (fileType === 'jpeg' && quality) {
      options.quality = quality;
    }

    if (selector) {
      const element = session.page.locator(selector);
      await element.screenshot(options);
    } else {
      await session.page.screenshot(options);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            action: 'screenshot',
            path,
            type: fileType,
            fullPage,
            selector,
            quality: fileType === 'jpeg' ? quality : undefined
          }, null, 2),
        },
      ],
    };
  }

  private async extractText(args: {
    selector: string;
    sessionId?: string;
    attribute?: string;
    multiple?: boolean
  }) {
    const { selector, sessionId = 'default', attribute, multiple = false } = args;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    let result;
    if (multiple) {
      const elements = session.page.locator(selector);
      const count = await elements.count();
      result = [];
      for (let i = 0; i < count; i++) {
        const element = elements.nth(i);
        const value = attribute ? await element.getAttribute(attribute) : await element.textContent();
        result.push(value);
      }
    } else {
      const element = session.page.locator(selector);
      result = attribute ? await element.getAttribute(attribute) : await element.textContent();
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            action: 'extract_text',
            selector,
            attribute,
            result
          }, null, 2),
        },
      ],
    };
  }

  private async waitForElement(args: {
    selector: string;
    sessionId?: string;
    timeout?: number;
    state?: 'visible' | 'hidden' | 'attached' | 'detached'
  }) {
    const { selector, sessionId = 'default', timeout = 30000, state = 'visible' } = args;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    await session.page.waitForSelector(selector, { timeout, state });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            action: 'wait_for_element',
            selector,
            state,
            timeout
          }, null, 2),
        },
      ],
    };
  }

  private async fillForm(args: {
    fields: Record<string, string>;
    sessionId?: string;
    submitSelector?: string;
    waitAfterSubmit?: number
  }) {
    const { fields, sessionId = 'default', submitSelector, waitAfterSubmit = 3000 } = args;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    for (const [selector, value] of Object.entries(fields)) {
      await session.page.fill(selector, value as string);
    }

    if (submitSelector) {
      await session.page.click(submitSelector);
      if (waitAfterSubmit > 0) {
        await session.page.waitForTimeout(waitAfterSubmit);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            action: 'fill_form',
            fieldsCount: Object.keys(fields).length,
            submitted: !!submitSelector
          }, null, 2),
        },
      ],
    };
  }

  private async scroll(args: {
    direction?: 'up' | 'down' | 'left' | 'right' | 'top' | 'bottom';
    pixels?: number;
    sessionId?: string;
    selector?: string
  }) {
    const { direction = 'down', pixels = 500, sessionId = 'default', selector } = args;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    let scrollFunction;
    switch (direction) {
      case 'up':
        scrollFunction = `window.scrollBy(0, -${pixels})`;
        break;
      case 'down':
        scrollFunction = `window.scrollBy(0, ${pixels})`;
        break;
      case 'left':
        scrollFunction = `window.scrollBy(-${pixels}, 0)`;
        break;
      case 'right':
        scrollFunction = `window.scrollBy(${pixels}, 0)`;
        break;
      case 'top':
        scrollFunction = `window.scrollTo(0, 0)`;
        break;
      case 'bottom':
        scrollFunction = `window.scrollTo(0, document.body.scrollHeight)`;
        break;
    }

    if (selector) {
      await session.page.locator(selector).evaluate((el, script) => {
        eval(script.replace('window.', 'el.'));
      }, scrollFunction);
    } else {
      await session.page.evaluate(scrollFunction);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            action: 'scroll',
            direction,
            pixels
          }, null, 2),
        },
      ],
    };
  }

  private async getPageInfo(args: {
    sessionId?: string;
    includeMetrics?: boolean
  }) {
    const { sessionId = 'default', includeMetrics = false } = args;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const info: {
      url: string;
      title: string;
      viewport: { width: number; height: number; } | null;
      metrics?: any;
    } = {
      url: session.page.url(),
      title: await session.page.title(),
      viewport: session.page.viewportSize()
    };

    if (includeMetrics) {
      const metrics = await session.page.evaluate(() => ({
        loadTime: performance.timing.loadEventEnd - performance.timing.navigationStart,
        domContentLoaded: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart,
        domElements: document.querySelectorAll('*').length
      }));
      info.metrics = metrics;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            info
          }, null, 2),
        },
      ],
    };
  }

  private async executeScript(args: {
    script: string;
    sessionId?: string;
    args?: unknown[]
  }) {
    const { script, sessionId = 'default', args: scriptArgs = [] } = args;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const result = await session.page.evaluate(
      ({ script, args }: { script: string; args: unknown[] }) => {
        const func = new Function('...args', script);
        return func(...args);
      },
      { script, args: scriptArgs }
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            result
          }, null, 2),
        },
      ],
    };
  }

  private async interceptRequests(args: {
    urlPattern?: string;
    sessionId?: string;
    mockResponse?: { status?: number; body?: unknown; headers?: Record<string, string> }
  }) {
    const { urlPattern = '**', sessionId = 'default', mockResponse } = args;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    await session.page.route(urlPattern, (route) => {
      if (mockResponse) {
        route.fulfill({
          status: mockResponse.status || 200,
          body: JSON.stringify(mockResponse.body),
          headers: mockResponse.headers || {}
        });
      } else {
        console.log(`Intercepted: ${route.request().method()} ${route.request().url()}`);
        route.continue();
      }
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            action: 'intercept_requests',
            pattern: urlPattern,
            hasMock: !!mockResponse
          }, null, 2),
        },
      ],
    };
  }

  private async downloadFile(args: {
    triggerSelector: string;
    downloadPath: string;
    sessionId?: string;
    timeout?: number
  }) {
    const { triggerSelector, downloadPath, sessionId = 'default', timeout = 30000 } = args;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const [download] = await Promise.all([
      session.page.waitForEvent('download', { timeout }),
      session.page.click(triggerSelector)
    ]);

    const filePath = path.join(downloadPath, download.suggestedFilename());
    await download.saveAs(filePath);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            action: 'download_file',
            filename: download.suggestedFilename(),
            path: filePath
          }, null, 2),
        },
      ],
    };
  }

  private async mobileEmulate(args: {
    device: string;
    sessionId?: string;
    orientation?: 'portrait' | 'landscape'
  }) {
    const { device, sessionId = 'default', orientation = 'portrait' } = args;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const devices = {
      'iPhone 12': { width: 390, height: 844, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X)' },
      'iPhone 13': { width: 390, height: 844, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)' },
      'iPhone 14': { width: 390, height: 844, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' },
      'iPad': { width: 768, height: 1024, userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_6 like Mac OS X)' },
      'Samsung Galaxy S21': { width: 360, height: 800, userAgent: 'Mozilla/5.0 (Linux; Android 11; SM-G991B)' },
      'Pixel 5': { width: 393, height: 851, userAgent: 'Mozilla/5.0 (Linux; Android 11; Pixel 5)' }
    };

    const deviceConfig = devices[device as keyof typeof devices];
    if (!deviceConfig) {
      throw new Error(`Unknown device: ${device}`);
    }

    const viewport = orientation === 'landscape'
      ? { width: deviceConfig.height, height: deviceConfig.width }
      : { width: deviceConfig.width, height: deviceConfig.height };

    // Close the old context and page
    await session.page.close();
    await session.context.close();

    // Create a new context with the desired userAgent and viewport
    const newContext = await session.browser.newContext({
      viewport,
      userAgent: deviceConfig.userAgent
    });
    const newPage = await newContext.newPage();

    // Update the session
    session.context = newContext;
    session.page = newPage;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            action: 'mobile_emulate',
            device,
            orientation,
            viewport
          }, null, 2),
        },
      ],
    };
  }

  private async createPDF(args: {
    path: string;
    sessionId?: string;
    format?: string;
    printBackground?: boolean;
    margin?: { top?: string; bottom?: string; left?: string; right?: string }
  }) {
    const { path, sessionId = 'default', format = 'A4', printBackground = true, margin } = args;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    await session.page.pdf({
      path,
      format,
      printBackground,
      margin: margin || { top: '1cm', bottom: '1cm', left: '1cm', right: '1cm' }
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            action: 'create_pdf',
            path,
            format
          }, null, 2),
        },
      ],
    };
  }

  private async closeSession(args: { sessionId?: string; keepBrowserOpen?: boolean }) {
    const { sessionId = 'default', keepBrowserOpen = true } = args;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Only close browser if explicitly requested
    if (!keepBrowserOpen) {
      await session.browser.close();
    }

    this.sessions.delete(sessionId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            action: 'close_session',
            sessionId,
            browserClosed: !keepBrowserOpen
          }, null, 2),
        },
      ],
    };
  }

  private async logNetworkRequests(args: {
    filePath: string;
    sessionId?: string;
    includeHeaders?: boolean;
    includeBody?: boolean;
    filterUrl?: string
  }) {
    const { filePath, sessionId = 'default', includeHeaders = true, includeBody = false, filterUrl } = args;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Close existing log stream if any
    if (session.networkLogStream) {
      session.networkLogStream.end();
    }

    // Create new log file
    const absolutePath = path.resolve(filePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    // Create write stream for the log file
    const logStream = await fs.open(absolutePath, 'w');
    session.networkLogPath = absolutePath;

    // Write initial log header
    const logHeader = {
      timestamp: new Date().toISOString(),
      sessionId,
      userAgent: await session.page.evaluate(() => navigator.userAgent),
      url: session.page.url(),
      settings: { includeHeaders, includeBody, filterUrl }
    };

    await logStream.writeFile(JSON.stringify(logHeader, null, 2) + '\n---REQUESTS---\n');

    let requestCounter = 0;

    // Set up request/response logging
    session.page.on('request', async (request) => {
      try {
        // Apply URL filter if provided
        if (filterUrl && !new RegExp(filterUrl).test(request.url())) {
          return;
        }

        requestCounter++;
        const requestData = {
          id: requestCounter,
          timestamp: new Date().toISOString(),
          type: 'request',
          method: request.method(),
          url: request.url(),
          resourceType: request.resourceType(),
          postData: includeBody ? request.postData() : undefined,
          headers: includeHeaders ? request.headers() : undefined
        };

        await logStream.writeFile(JSON.stringify(requestData, null, 2) + '\n');
      } catch (error) {
        console.error('Error logging request:', error);
      }
    });

    session.page.on('response', async (response) => {
      try {
        // Apply URL filter if provided
        if (filterUrl && !new RegExp(filterUrl).test(response.url())) {
          return;
        }

        const responseData = {
          timestamp: new Date().toISOString(),
          type: 'response',
          url: response.url(),
          status: response.status(),
          statusText: response.statusText(),
          headers: includeHeaders ? response.headers() : undefined,
          body: includeBody ? await response.text().catch(() => '[Binary or Error]') : undefined
        };

        await logStream.writeFile(JSON.stringify(responseData, null, 2) + '\n');
      } catch (error) {
        console.error('Error logging response:', error);
      }
    });

    // Also log failed requests
    session.page.on('requestfailed', async (request) => {
      try {
        if (filterUrl && !new RegExp(filterUrl).test(request.url())) {
          return;
        }

        const failedData = {
          timestamp: new Date().toISOString(),
          type: 'request_failed',
          url: request.url(),
          method: request.method(),
          failure: request.failure()?.errorText || 'Unknown error'
        };

        await logStream.writeFile(JSON.stringify(failedData, null, 2) + '\n');
      } catch (error) {
        console.error('Error logging failed request:', error);
      }
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            action: 'log_network_requests',
            filePath: absolutePath,
            sessionId,
            settings: { includeHeaders, includeBody, filterUrl },
            message: 'Network request logging started. All requests will be logged to the specified file.'
          }, null, 2),
        },
      ],
    };
  }

  private generateXSSPoCs(vulnerabilities: any[], baseUrl: string): any[] {
    const pocList: any[] = [];

    vulnerabilities.forEach((vuln, index) => {
      const poc = {
        id: index + 1,
        vulnerabilityType: vuln.type,
        severity: vuln.severity,
        location: vuln.location,
        description: vuln.description,
        httpRequests: [] as any[]
      };

      // Generate different PoC based on vulnerability type
      switch (vuln.type) {
        case 'url_parameter':
          poc.httpRequests.push(this.generateURLParameterPoC(vuln, baseUrl));
          break;
        case 'form_input':
          poc.httpRequests.push(this.generateFormInputPoC(vuln, baseUrl));
          break;
        case 'dangerous_attribute':
          poc.httpRequests.push(this.generateAttributePoC(vuln, baseUrl));
          break;
        case 'script_injection':
          poc.httpRequests.push(this.generateScriptInjectionPoC(vuln, baseUrl));
          break;
        case 'hidden_script_injection':
          poc.httpRequests.push(this.generateHiddenInputPoC(vuln, baseUrl));
          break;
        default:
          poc.httpRequests.push(this.generateGenericPoC(vuln, baseUrl));
      }

      pocList.push(poc);
    });

    return pocList;
  }

  private generateURLParameterPoC(vuln: any, baseUrl: string): any {
    const paramName = vuln.location.replace('URL param: ', '');

    // XSS payloads for URL parameters
    const payloads = [
      '<script>alert("XSS")</script>',
      '"><script>alert("XSS")</script>',
      'javascript:alert("XSS")',
      '"><img src=x onerror=alert("XSS")>',
      '\'><img src=x onerror=alert("XSS")>',
      '"><svg onload=alert("XSS")>',
      '"><iframe src="javascript:alert(\'XSS\')">'
    ];

    const requests = payloads.map((payload, index) => {
      const testUrl = new URL(baseUrl);
      testUrl.searchParams.set(paramName, payload);

      return {
        method: 'GET',
        url: testUrl.toString(),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive'
        },
        description: `URL Parameter XSS PoC ${index + 1}`,
        payload: payload,
        expectedResult: 'Alert popup with "XSS" message should appear'
      };
    });

    return {
      type: 'URL Parameter XSS',
      requests: requests
    };
  }

  private generateFormInputPoC(vuln: any, baseUrl: string): any {
    const inputNameMatch = vuln.location.match(/\(([^)]+)\)/);
    const inputName = inputNameMatch ? inputNameMatch[1] : 'input';

    const payloads = [
      '<script>alert("XSS")</script>',
      '"><script>alert("XSS")</script>',
      '"><img src=x onerror=alert("XSS")>',
      '\'><img src=x onerror=alert("XSS")>',
      '"><svg onload=alert("XSS")>'
    ];

    const requests = payloads.map((payload, index) => {
      return {
        method: 'POST',
        url: baseUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Connection': 'keep-alive'
        },
        body: `${inputName}=${encodeURIComponent(payload)}`,
        description: `Form Input XSS PoC ${index + 1}`,
        payload: payload,
        expectedResult: 'Alert popup with "XSS" message should appear after form submission'
      };
    });

    return {
      type: 'Form Input XSS',
      requests: requests
    };
  }

  private generateAttributePoC(vuln: any, baseUrl: string): any {
    const payloads = [
      'javascript:alert("XSS")',
      'javascript:alert(\'XSS\')',
      'javascript:alert(`XSS`)',
      'data:text/html,<script>alert("XSS")</script>',
      'vbscript:alert("XSS")'
    ];

    const requests = payloads.map((payload, index) => {
      return {
        method: 'GET',
        url: baseUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive'
        },
        description: `Dangerous Attribute XSS PoC ${index + 1}`,
        payload: payload,
        expectedResult: 'Alert popup with "XSS" message should appear when attribute is triggered',
        note: 'This requires manual testing by interacting with the element'
      };
    });

    return {
      type: 'Dangerous Attribute XSS',
      requests: requests
    };
  }

  private generateScriptInjectionPoC(vuln: any, baseUrl: string): any {
    const payloads = [
      '<script>alert("XSS")</script>',
      '<script>alert(\'XSS\')</script>',
      '<script>alert(`XSS`)</script>',
      '<img src=x onerror=alert("XSS")>',
      '<svg onload=alert("XSS")>',
      '<iframe src="javascript:alert(\'XSS\')">',
      '<body onload=alert("XSS")>'
    ];

    const requests = payloads.map((payload, index) => {
      return {
        method: 'GET',
        url: baseUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive'
        },
        description: `Script Injection XSS PoC ${index + 1}`,
        payload: payload,
        expectedResult: 'Alert popup with "XSS" message should appear',
        note: 'This requires the payload to be injected into the page content'
      };
    });

    return {
      type: 'Script Injection XSS',
      requests: requests
    };
  }

  private generateHiddenInputPoC(vuln: any, baseUrl: string): any {
    const payloads = [
      '<script>alert("XSS")</script>',
      '"><script>alert("XSS")</script>',
      '"><img src=x onerror=alert("XSS")>',
      '\'><img src=x onerror=alert("XSS")>'
    ];

    const requests = payloads.map((payload, index) => {
      return {
        method: 'POST',
        url: baseUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Connection': 'keep-alive'
        },
        description: `Hidden Input XSS PoC ${index + 1}`,
        payload: payload,
        expectedResult: 'Alert popup with "XSS" message should appear when hidden input is processed',
        note: 'Hidden inputs are often processed by server-side scripts'
      };
    });

    return {
      type: 'Hidden Input XSS',
      requests: requests
    };
  }

  private generateGenericPoC(vuln: any, baseUrl: string): any {
    return {
      type: 'Generic XSS',
      requests: [{
        method: 'GET',
        url: baseUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive'
        },
        description: 'Generic XSS PoC',
        payload: '<script>alert("XSS")</script>',
        expectedResult: 'Alert popup with "XSS" message should appear',
        note: 'Manual testing required based on vulnerability context'
      }]
    };
  }

  private async scanXSS(args: {
    sessionId?: string;
    scanScripts?: boolean;
    scanAttributes?: boolean;
    scanUrls?: boolean;
    scanForms?: boolean;
    generatePoC?: boolean;
    outputFile?: string;
  }) {
    const {
      sessionId = 'default',
      scanScripts = true,
      scanAttributes = true,
      scanUrls = true,
      scanForms = true,
      generatePoC = true,
      outputFile
    } = args;

    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const vulnerabilities: any[] = [];
    const scanResults = {
      timestamp: new Date().toISOString(),
      url: session.page.url(),
      sessionId,
      scanSettings: { scanScripts, scanAttributes, scanUrls, scanForms, generatePoC },
      vulnerabilities: vulnerabilities,
      proofOfConcepts: [] as any[],
      summary: {
        total: 0,
        high: 0,
        medium: 0,
        low: 0
      }
    };

    // XSS patterns to detect
    const xssPatterns = {
      scriptInjection: [
        /<script[^>]*>.*?<\/script>/gi,
        /javascript:/gi,
        /on\w+\s*=/gi,
        /eval\s*\(/gi,
        /document\.write\s*\(/gi,
        /innerHTML\s*=/gi,
        /outerHTML\s*=/gi,
        /insertAdjacentHTML\s*\(/gi
      ],
      dangerousAttributes: [
        /on\w+\s*=/gi,
        /javascript:/gi,
        /vbscript:/gi,
        /data:/gi
      ],
      dangerousFunctions: [
        /eval\s*\(/gi,
        /Function\s*\(/gi,
        /setTimeout\s*\(/gi,
        /setInterval\s*\(/gi,
        /document\.write\s*\(/gi,
        /document\.writeln\s*\(/gi,
        /innerHTML\s*=/gi,
        /outerHTML\s*=/gi
      ]
    };

    try {
      // Scan using JavaScript execution
      const scanResult = await session.page.evaluate(({ patterns, settings }: { patterns: any, settings: any }) => {
        const results: any = {
          vulnerabilities: [],
          summary: { total: 0, high: 0, medium: 0, low: 0 }
        };

        // Helper function to check for XSS patterns
        const checkForXSS = (content: string, type: string, location: string, severity: string = 'medium') => {
          if (!content) return;

          for (const pattern of patterns.scriptInjection) {
            if (pattern.test(content)) {
              results.vulnerabilities.push({
                type: 'script_injection',
                severity,
                location,
                pattern: pattern.source,
                content: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
                description: 'Potential script injection detected'
              });
              results.summary.total++;
              if (severity === 'high') results.summary.high++;
              else if (severity === 'medium') results.summary.medium++;
              else results.summary.low++;
            }
          }
        };

        // Scan inline scripts
        if (settings.scanScripts) {
          const scripts = document.querySelectorAll('script');
          scripts.forEach((script, index) => {
            if (script.innerHTML) {
              checkForXSS(script.innerHTML, 'inline_script', `script[${index}]`, 'high');
            }
            if (script.src) {
              checkForXSS(script.src, 'external_script', `script[${index}].src`, 'medium');
            }
          });
        }

        // Scan HTML attributes
        if (settings.scanAttributes) {
          const allElements = document.querySelectorAll('*');
          allElements.forEach((element, elementIndex) => {
            for (const attr of element.attributes) {
              const attrValue = attr.value;
              const attrName = attr.name;

              // Check for dangerous attributes
              for (const pattern of patterns.dangerousAttributes) {
                if (pattern.test(attrName) || pattern.test(attrValue)) {
                  results.vulnerabilities.push({
                    type: 'dangerous_attribute',
                    severity: 'high',
                    location: `${element.tagName.toLowerCase()}[${elementIndex}].${attrName}`,
                    pattern: pattern.source,
                    content: attrValue,
                    description: `Dangerous attribute detected: ${attrName}`
                  });
                  results.summary.total++;
                  results.summary.high++;
                }
              }
            }
          });
        }

        // Scan URL parameters
        if (settings.scanUrls) {
          const urlParams = new URLSearchParams(window.location.search);

          urlParams.forEach((value, key) => {
            checkForXSS(value, 'url_parameter', `URL param: ${key}`, 'medium');
          });

          // Check hash fragment
          if (window.location.hash) {
            checkForXSS(window.location.hash, 'url_hash', 'URL hash fragment', 'medium');
          }
        }

        // Scan form inputs
        if (settings.scanForms) {
          const forms = document.querySelectorAll('form');
          forms.forEach((form, formIndex) => {
            const inputs = form.querySelectorAll('input, textarea, select');
            inputs.forEach((input, inputIndex) => {
              const inputElement = input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
              const inputValue = inputElement.value;
              const inputName = inputElement.name;
              const inputType = inputElement.type;

              // Check for reflected XSS in form values
              if (inputValue) {
                checkForXSS(inputValue, 'form_input', `form[${formIndex}] input[${inputIndex}] (${inputName})`, 'medium');
              }

              // Check for dangerous input types or attributes
              if (inputType === 'hidden' && inputValue.includes('<script')) {
                results.vulnerabilities.push({
                  type: 'hidden_script_injection',
                  severity: 'high',
                  location: `form[${formIndex}] input[${inputIndex}] (${inputName})`,
                  content: inputValue,
                  description: 'Script injection in hidden input field'
                });
                results.summary.total++;
                results.summary.high++;
              }
            });
          });
        }

        // Scan for dangerous JavaScript functions in all scripts
        if (settings.scanScripts) {
          const allScripts = document.querySelectorAll('script');
          allScripts.forEach((script, index) => {
            if (script.innerHTML) {
              for (const pattern of patterns.dangerousFunctions) {
                if (pattern.test(script.innerHTML)) {
                  results.vulnerabilities.push({
                    type: 'dangerous_function',
                    severity: 'medium',
                    location: `script[${index}]`,
                    pattern: pattern.source,
                    content: script.innerHTML.substring(0, 200) + (script.innerHTML.length > 200 ? '...' : ''),
                    description: `Dangerous JavaScript function detected: ${pattern.source}`
                  });
                  results.summary.total++;
                  results.summary.medium++;
                }
              }
            }
          });
        }

        return results;
      }, { patterns: xssPatterns, settings: { scanScripts, scanAttributes, scanUrls, scanForms } });

      // Merge results
      scanResults.vulnerabilities = scanResult.vulnerabilities;
      scanResults.summary = scanResult.summary;

      // Generate Proof of Concepts if requested
      if (generatePoC && scanResult.vulnerabilities.length > 0) {
        scanResults.proofOfConcepts = this.generateXSSPoCs(scanResult.vulnerabilities, session.page.url());
      }

      // Save to file if specified
      if (outputFile) {
        const absolutePath = path.resolve(outputFile);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, JSON.stringify(scanResults, null, 2));
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              action: 'scan_xss',
              sessionId,
              scanResults,
              message: `XSS scan completed. Found ${scanResults.summary.total} potential vulnerabilities.`
            }, null, 2),
          },
        ],
      };

    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              action: 'scan_xss',
              error: error instanceof Error ? error.message : 'Unknown error',
              sessionId
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  }

  private async interactiveXSSScan(args: {
    sessionId?: string;
    scanScripts?: boolean;
    scanAttributes?: boolean;
    scanUrls?: boolean;
    scanForms?: boolean;
    autoTestPoC?: boolean;
    waitForAlert?: number;
    outputFile?: string;
  }) {
    const {
      sessionId = 'default',
      scanScripts = true,
      scanAttributes = true,
      scanUrls = true,
      scanForms = true,
      autoTestPoC = true,
      waitForAlert = 3000,
      outputFile
    } = args;

    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const scanResults = {
      timestamp: new Date().toISOString(),
      url: session.page.url(),
      sessionId,
      scanSettings: { scanScripts, scanAttributes, scanUrls, scanForms, autoTestPoC, waitForAlert },
      vulnerabilities: [] as any[],
      testedVulnerabilities: [] as any[],
      confirmedXSS: [] as any[],
      summary: {
        total: 0,
        tested: 0,
        confirmed: 0,
        high: 0,
        medium: 0,
        low: 0
      }
    };

    // XSS patterns to detect
    const xssPatterns = {
      scriptInjection: [
        /<script[^>]*>.*?<\/script>/gi,
        /javascript:/gi,
        /on\w+\s*=/gi,
        /eval\s*\(/gi,
        /document\.write\s*\(/gi,
        /innerHTML\s*=/gi,
        /outerHTML\s*=/gi,
        /insertAdjacentHTML\s*\(/gi
      ],
      dangerousAttributes: [
        /on\w+\s*=/gi,
        /javascript:/gi,
        /vbscript:/gi,
        /data:/gi
      ],
      dangerousFunctions: [
        /eval\s*\(/gi,
        /Function\s*\(/gi,
        /setTimeout\s*\(/gi,
        /setInterval\s*\(/gi,
        /document\.write\s*\(/gi,
        /document\.writeln\s*\(/gi,
        /innerHTML\s*=/gi,
        /outerHTML\s*=/gi
      ]
    };

    try {
      // First, scan for vulnerabilities
      const scanResult = await session.page.evaluate(({ patterns, settings }: { patterns: any, settings: any }) => {
        const results: any = {
          vulnerabilities: [],
          summary: { total: 0, high: 0, medium: 0, low: 0 }
        };

        // Helper function to check for XSS patterns
        const checkForXSS = (content: string, type: string, location: string, severity: string = 'medium') => {
          if (!content) return;

          for (const pattern of patterns.scriptInjection) {
            if (pattern.test(content)) {
              results.vulnerabilities.push({
                type: 'script_injection',
                severity,
                location,
                pattern: pattern.source,
                content: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
                description: 'Potential script injection detected'
              });
              results.summary.total++;
              if (severity === 'high') results.summary.high++;
              else if (severity === 'medium') results.summary.medium++;
              else results.summary.low++;
            }
          }
        };

        // Scan inline scripts
        if (settings.scanScripts) {
          const scripts = document.querySelectorAll('script');
          scripts.forEach((script, index) => {
            if (script.innerHTML) {
              checkForXSS(script.innerHTML, 'inline_script', `script[${index}]`, 'high');
            }
            if (script.src) {
              checkForXSS(script.src, 'external_script', `script[${index}].src`, 'medium');
            }
          });
        }

        // Scan HTML attributes
        if (settings.scanAttributes) {
          const allElements = document.querySelectorAll('*');
          allElements.forEach((element, elementIndex) => {
            for (const attr of element.attributes) {
              const attrValue = attr.value;
              const attrName = attr.name;

              // Check for dangerous attributes
              for (const pattern of patterns.dangerousAttributes) {
                if (pattern.test(attrName) || pattern.test(attrValue)) {
                  results.vulnerabilities.push({
                    type: 'dangerous_attribute',
                    severity: 'high',
                    location: `${element.tagName.toLowerCase()}[${elementIndex}].${attrName}`,
                    pattern: pattern.source,
                    content: attrValue,
                    description: `Dangerous attribute detected: ${attrName}`
                  });
                  results.summary.total++;
                  results.summary.high++;
                }
              }
            }
          });
        }

        // Scan URL parameters
        if (settings.scanUrls) {
          const urlParams = new URLSearchParams(window.location.search);

          urlParams.forEach((value, key) => {
            checkForXSS(value, 'url_parameter', `URL param: ${key}`, 'medium');
          });

          // Check hash fragment
          if (window.location.hash) {
            checkForXSS(window.location.hash, 'url_hash', 'URL hash fragment', 'medium');
          }
        }

        // Scan form inputs
        if (settings.scanForms) {
          const forms = document.querySelectorAll('form');
          forms.forEach((form, formIndex) => {
            const inputs = form.querySelectorAll('input, textarea, select');
            inputs.forEach((input, inputIndex) => {
              const inputElement = input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
              const inputValue = inputElement.value;
              const inputName = inputElement.name;
              const inputType = inputElement.type;

              // Check for reflected XSS in form values
              if (inputValue) {
                checkForXSS(inputValue, 'form_input', `form[${formIndex}] input[${inputIndex}] (${inputName})`, 'medium');
              }

              // Check for dangerous input types or attributes
              if (inputType === 'hidden' && inputValue.includes('<script')) {
                results.vulnerabilities.push({
                  type: 'hidden_script_injection',
                  severity: 'high',
                  location: `form[${formIndex}] input[${inputIndex}] (${inputName})`,
                  content: inputValue,
                  description: 'Script injection in hidden input field'
                });
                results.summary.total++;
                results.summary.high++;
              }
            });
          });
        }

        // Scan for dangerous JavaScript functions in all scripts
        if (settings.scanScripts) {
          const allScripts = document.querySelectorAll('script');
          allScripts.forEach((script, index) => {
            if (script.innerHTML) {
              for (const pattern of patterns.dangerousFunctions) {
                if (pattern.test(script.innerHTML)) {
                  results.vulnerabilities.push({
                    type: 'dangerous_function',
                    severity: 'medium',
                    location: `script[${index}]`,
                    pattern: pattern.source,
                    content: script.innerHTML.substring(0, 200) + (script.innerHTML.length > 200 ? '...' : ''),
                    description: `Dangerous JavaScript function detected: ${pattern.source}`
                  });
                  results.summary.total++;
                  results.summary.medium++;
                }
              }
            }
          });
        }

        return results;
      }, { patterns: xssPatterns, settings: { scanScripts, scanAttributes, scanUrls, scanForms } });

      // Merge scan results
      scanResults.vulnerabilities = scanResult.vulnerabilities;
      scanResults.summary.total = scanResult.summary.total;
      scanResults.summary.high = scanResult.summary.high;
      scanResults.summary.medium = scanResult.summary.medium;
      scanResults.summary.low = scanResult.summary.low;

      // If autoTestPoC is enabled and vulnerabilities found, test them
      if (autoTestPoC && scanResult.vulnerabilities.length > 0) {
        for (const vuln of scanResult.vulnerabilities) {
          const testResult = await this.testVulnerabilityPoC(session, vuln, waitForAlert);
          scanResults.testedVulnerabilities.push(testResult);
          scanResults.summary.tested++;

          if (testResult.alertDetected) {
            scanResults.confirmedXSS.push(testResult);
            scanResults.summary.confirmed++;

            // Return immediately when alert is detected for user interaction
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: true,
                    action: 'interactive_xss_scan',
                    sessionId,
                    alertDetected: true,
                    confirmedVulnerability: testResult,
                    message: `🚨 XSS VULNERABILITY CONFIRMED! Alert popup detected for: ${vuln.type} at ${vuln.location}`,
                    userAction: 'Please check the browser for the alert popup and confirm if you want to continue scanning for more vulnerabilities.',
                    remainingVulnerabilities: scanResult.vulnerabilities.length - scanResults.summary.tested
                  }, null, 2),
                },
              ],
            };
          }
        }
      }

      // Save to file if specified
      if (outputFile) {
        const absolutePath = path.resolve(outputFile);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, JSON.stringify(scanResults, null, 2));
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              action: 'interactive_xss_scan',
              sessionId,
              scanResults,
              message: `Interactive XSS scan completed. Found ${scanResults.summary.total} vulnerabilities, tested ${scanResults.summary.tested}, confirmed ${scanResults.summary.confirmed} XSS vulnerabilities.`
            }, null, 2),
          },
        ],
      };

    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              action: 'interactive_xss_scan',
              error: error instanceof Error ? error.message : 'Unknown error',
              sessionId
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  }

  private async testVulnerabilityPoC(session: BrowserSession, vuln: any, waitForAlert: number): Promise<any> {
    const testResult = {
      vulnerability: vuln,
      tested: true,
      alertDetected: false,
      testMethod: '',
      payload: '',
      timestamp: new Date().toISOString()
    };

    try {
      // Set up alert detection
      const alertPromise = session.page.waitForEvent('dialog', { timeout: waitForAlert }).then(() => {
        return true;
      }).catch(() => false);

      // Generate and test payload based on vulnerability type
      switch (vuln.type) {
        case 'url_parameter': {
          testResult.testMethod = 'URL Parameter Injection';
          testResult.payload = '<script>alert("XSS Confirmed")</script>';

          const currentUrl = new URL(session.page.url());
          const paramName = vuln.location.replace('URL param: ', '');
          currentUrl.searchParams.set(paramName, testResult.payload);

          await session.page.goto(currentUrl.toString());
          break;
        }

        case 'form_input': {
          testResult.testMethod = 'Form Input Injection';
          testResult.payload = '"><script>alert("XSS Confirmed")</script>';

          // Find and fill the form
          const inputName = vuln.location.match(/\(([^)]+)\)/)?.[1] || 'input';
          await session.page.fill(`[name="${inputName}"]`, testResult.payload);
          await session.page.press(`[name="${inputName}"]`, 'Enter');
          break;
        }

        case 'dangerous_attribute':
          testResult.testMethod = 'Attribute Injection';
          testResult.payload = 'javascript:alert("XSS Confirmed")';

          // Try to inject into href or src attributes
          await session.page.evaluate((payload) => {
            const links = document.querySelectorAll('a[href]');
            if (links.length > 0) {
              links[0].setAttribute('href', payload);
            }
          }, testResult.payload);
          break;

        case 'script_injection':
        case 'hidden_script_injection':
          testResult.testMethod = 'Script Injection';
          testResult.payload = '<script>alert("XSS Confirmed")</script>';

          // Inject script into page
          await session.page.evaluate((payload) => {
            const div = document.createElement('div');
            div.innerHTML = payload;
            document.body.appendChild(div);
          }, testResult.payload);
          break;

        default:
          testResult.testMethod = 'Generic Injection';
          testResult.payload = '<script>alert("XSS Confirmed")</script>';

          await session.page.evaluate((payload) => {
            const div = document.createElement('div');
            div.innerHTML = payload;
            document.body.appendChild(div);
          }, testResult.payload);
      }

      // Wait for alert
      const alertResult = await alertPromise;
      testResult.alertDetected = alertResult;

      return testResult;

    } catch {
      testResult.alertDetected = false;
      testResult.testMethod = 'Error during testing';
      return testResult;
    }
  }

  private async fetchJavaScriptFiles(args: {
    sessionId?: string;
    downloadPath: string;
    includeInlineScripts?: boolean;
    includeExternalScripts?: boolean;
    includeDynamicScripts?: boolean;
    filterUrl?: string;
    preserveStructure?: boolean;
    generateManifest?: boolean;
  }) {
    const {
      sessionId = 'default',
      downloadPath,
      includeInlineScripts = true,
      includeExternalScripts = true,
      includeDynamicScripts = true,
      filterUrl,
      preserveStructure = true,
      generateManifest = true
    } = args;

    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const absolutePath = path.resolve(downloadPath);
    await fs.mkdir(absolutePath, { recursive: true });

    const downloadedFiles: Array<{
      url: string;
      localPath: string;
      type: 'external' | 'inline' | 'dynamic';
      size: number;
      timestamp: string;
    }> = [];

    try {
      // Get all JavaScript files and scripts from the page
      const scriptData = await session.page.evaluate(({
        includeInlineScripts,
        includeExternalScripts,
        includeDynamicScripts,
        filterUrl
      }: {
        includeInlineScripts: boolean;
        includeExternalScripts: boolean;
        includeDynamicScripts: boolean;
        filterUrl?: string;
      }) => {
        const scripts: Array<{
          url: string;
          content: string;
          type: 'external' | 'inline' | 'dynamic';
          filename: string;
        }> = [];

        // Get external scripts
        if (includeExternalScripts) {
          const externalScripts = document.querySelectorAll('script[src]');
          externalScripts.forEach((script, index) => {
            const src = script.getAttribute('src');
            if (src) {
              // Apply URL filter if provided
              if (filterUrl && !new RegExp(filterUrl).test(src)) {
                return;
              }

              const url = new URL(src, window.location.href).href;
              const filename = src.split('/').pop() || `script_${index}.js`;
              
              scripts.push({
                url,
                content: '', // Will be fetched separately
                type: 'external',
                filename
              });
            }
          });
        }

        // Get inline scripts
        if (includeInlineScripts) {
          const inlineScripts = document.querySelectorAll('script:not([src])');
          inlineScripts.forEach((script, index) => {
            const content = script.textContent || '';
            if (content.trim()) {
              scripts.push({
                url: window.location.href,
                content,
                type: 'inline',
                filename: `inline_script_${index}.js`
              });
            }
          });
        }

        // Get dynamically loaded scripts (from performance API)
        if (includeDynamicScripts) {
          const performanceEntries = performance.getEntriesByType('resource');
          performanceEntries.forEach((entry: any) => {
            if (entry.name && entry.name.endsWith('.js')) {
              // Apply URL filter if provided
              if (filterUrl && !new RegExp(filterUrl).test(entry.name)) {
                return;
              }

              const filename = entry.name.split('/').pop() || 'dynamic_script.js';
              
              scripts.push({
                url: entry.name,
                content: '', // Will be fetched separately
                type: 'dynamic',
                filename
              });
            }
          });
        }

        return scripts;
      }, { includeInlineScripts, includeExternalScripts, includeDynamicScripts, filterUrl });

      // Download external and dynamic scripts
      for (const script of scriptData) {
        try {
          let content = script.content;
          let localPath: string;

          if (script.type === 'external' || script.type === 'dynamic') {
            // Fetch external script content
            const response = await session.page.goto(script.url, { waitUntil: 'networkidle' });
            if (response && response.ok()) {
              content = await response.text();
            } else {
              console.warn(`Failed to fetch script: ${script.url}`);
              continue;
            }
          }

          // Determine local file path
          if (preserveStructure && script.type !== 'inline') {
            const url = new URL(script.url);
            const pathParts = url.pathname.split('/').filter(part => part);
            const filename = pathParts.pop() || script.filename;
            const dirPath = pathParts.join('/');
            
            if (dirPath) {
              const fullDirPath = path.join(absolutePath, url.hostname, dirPath);
              await fs.mkdir(fullDirPath, { recursive: true });
              localPath = path.join(fullDirPath, filename);
            } else {
              localPath = path.join(absolutePath, url.hostname, filename);
            }
          } else {
            localPath = path.join(absolutePath, script.filename);
          }

          // Save the script content
          await fs.writeFile(localPath, content, 'utf8');
          
          downloadedFiles.push({
            url: script.url,
            localPath,
            type: script.type,
            size: content.length,
            timestamp: new Date().toISOString()
          });

        } catch (error) {
          console.error(`Error downloading script ${script.url}:`, error);
        }
      }

      // Generate manifest file
      if (generateManifest) {
        const manifest = {
          timestamp: new Date().toISOString(),
          pageUrl: session.page.url(),
          sessionId,
          settings: {
            includeInlineScripts,
            includeExternalScripts,
            includeDynamicScripts,
            filterUrl,
            preserveStructure
          },
          summary: {
            totalFiles: downloadedFiles.length,
            externalScripts: downloadedFiles.filter(f => f.type === 'external').length,
            inlineScripts: downloadedFiles.filter(f => f.type === 'inline').length,
            dynamicScripts: downloadedFiles.filter(f => f.type === 'dynamic').length,
            totalSize: downloadedFiles.reduce((sum, f) => sum + f.size, 0)
          },
          files: downloadedFiles
        };

        const manifestPath = path.join(absolutePath, 'javascript_manifest.json');
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              action: 'fetch_javascript_files',
              sessionId,
              downloadPath: absolutePath,
              summary: {
                totalFiles: downloadedFiles.length,
                externalScripts: downloadedFiles.filter(f => f.type === 'external').length,
                inlineScripts: downloadedFiles.filter(f => f.type === 'inline').length,
                dynamicScripts: downloadedFiles.filter(f => f.type === 'dynamic').length,
                totalSize: downloadedFiles.reduce((sum, f) => sum + f.size, 0)
              },
              files: downloadedFiles.map(f => ({
                url: f.url,
                localPath: f.localPath,
                type: f.type,
                size: f.size
              })),
              manifestGenerated: generateManifest
            }, null, 2),
          },
        ],
      };

    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              action: 'fetch_javascript_files',
              error: error instanceof Error ? error.message : 'Unknown error',
              sessionId
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  }

  private async cleanup() {
    // Don't close browsers automatically - let them stay open
    // But close any open network log streams
    console.log('Cleaning up sessions but keeping browsers open...');

    for (const session of this.sessions.values()) {
      if (session.networkLogStream) {
        try {
          session.networkLogStream.end();
        } catch (error) {
          console.error('Error closing network log stream:', error);
        }
      }
    }

    this.sessions.clear();
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("MCP Browser server running on stdio");
  }
}

const server = new MCPBrowserServer();
server.run().catch(console.error);