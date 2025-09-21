# MCP Browser

[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](https://github.com/badchars/mcp-browser)
[![License](https://img.shields.io/badge/license-Non--Commercial-red.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/playwright-1.40.0-orange.svg)](https://playwright.dev/)

A powerful Model Context Protocol (MCP) server that provides advanced browser automation capabilities using Playwright. This server enables AI assistants to control web browsers programmatically through a standardized MCP interface, with specialized features for **JavaScript analysis** and **XSS vulnerability scanning**.

> 🔒 **Perfect for Security Researchers, Penetration Testers, and Web Application Analysts**

## 🚀 Key Features

### 🔍 **Security Analysis & XSS Scanning**
- **Interactive XSS Scanner**: Automatic detection and testing of XSS vulnerabilities
- **Comprehensive XSS Detection**: Scans inline scripts, external scripts, HTML attributes, URL parameters, and form inputs
- **Proof of Concept Generation**: Automatic PoC HTTP requests for confirmed vulnerabilities
- **Alert Detection**: Real-time alert popup detection during XSS testing
- **Detailed Vulnerability Reports**: JSON reports with severity levels and remediation suggestions

### 📁 **JavaScript Files Analysis**
- **Complete JS Fetching**: Download all JavaScript files (external, inline, dynamic)
- **Smart File Organization**: Preserve directory structure from URLs
- **Manifest Generation**: Detailed JSON manifest with file metadata
- **URL Filtering**: Regex-based filtering for targeted analysis
- **Performance API Integration**: Detect dynamically loaded scripts

### 🌐 **Advanced Browser Automation**
- **Multi-browser Support**: Chromium, Firefox, and WebKit browsers
- **Session Management**: Multiple browser sessions with unique IDs
- **Navigation**: Navigate to URLs with configurable wait conditions
- **Element Interaction**: Click, type, and interact with web elements
- **Screenshots**: Capture full page or element screenshots
- **Text Extraction**: Extract text content from web elements
- **Form Automation**: Fill out forms with multiple fields
- **JavaScript Execution**: Execute custom JavaScript on pages
- **Mobile Emulation**: Emulate mobile devices and orientations
- **PDF Generation**: Create PDFs from web pages
- **File Downloads**: Download files from web pages
- **Network Interception**: Monitor and mock network requests
- **Performance Metrics**: Collect page performance data

## Installation

1. Clone the repository:

```bash
git clone https://github.com/badchars/mcp-browser.git
cd mcp-browser
```

2. Install dependencies:

```bash
npm install
```

3. Install Playwright browsers:

```bash
npm run install-browsers
```

## Usage

### Building the Project

First, build the TypeScript project:

```bash
npm run build
```

This creates the `dist/index.js` file that will be used by the MCP server.

### Available Tools

#### Browser Navigation

- `browser_navigate`: Navigate to a URL with configurable wait conditions
- `browser_get_page_info`: Get current page information (URL, title, viewport)

#### Element Interaction

- `browser_click`: Click on elements using CSS selectors
- `browser_type`: Type text into form fields
- `browser_wait_for_element`: Wait for elements to appear
- `browser_fill_form`: Fill out forms with multiple fields

#### Content Extraction

- `browser_extract_text`: Extract text content from elements
- `browser_screenshot`: Take screenshots of pages or elements

#### Page Manipulation

- `browser_scroll`: Scroll pages in different directions
- `browser_execute_script`: Execute custom JavaScript
- `browser_mobile_emulate`: Emulate mobile devices

#### File Operations

- `browser_download_file`: Download files from web pages
- `browser_create_pdf`: Generate PDFs from web pages
- `browser_fetch_javascript_files`: Fetch and download all JavaScript files loaded by the web application

#### Network Control

- `browser_intercept_requests`: Monitor and mock network requests

#### Session Management

- `browser_close_session`: Close browser sessions

## Configuration

### MCP Server Configuration

Add the following to your MCP client configuration file:

#### Production Configuration

```json
{
  "mcpServers": {
    "mcp-browser": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "NODE_ENV": "production"
      },
      "description": "MCP Browser server for headless browser automation with Playwright"
    }
  }
}
```

**Important**: Make sure to run `npm run build` before using this configuration.

#### Development Configuration

```json
{
  "mcpServers": {
    "mcp-browser": {
      "command": "npx",
      "args": ["tsx", "index.ts"],
      "env": {
        "NODE_ENV": "development"
      },
      "description": "MCP Browser server for headless browser automation with Playwright (Development Mode)"
    }
  }
}
```

### Browser Types

- `chromium`: Default browser (recommended)
- `firefox`: Mozilla Firefox
- `webkit`: Safari engine

### Session Management

- Default session ID: `default`
- Multiple sessions supported with unique IDs
- Sessions persist until explicitly closed

### Viewport Configuration

- Default: 1280x720
- Customizable per session
- Mobile emulation includes device-specific viewports

## 🔒 Security Analysis Use Cases

### XSS Vulnerability Scanning
Perfect for penetration testers and security researchers:

```json
{
  "name": "browser_interactive_xss_scan",
  "arguments": {
    "sessionId": "security_test",
    "scanScripts": true,
    "scanAttributes": true,
    "scanUrls": true,
    "scanForms": true,
    "autoTestPoC": true,
    "waitForAlert": 3000,
    "outputFile": "./xss_scan_results.json"
  }
}
```

### JavaScript Code Analysis
Ideal for reverse engineering and code review:

```json
{
  "name": "browser_fetch_javascript_files",
  "arguments": {
    "downloadPath": "./js_analysis",
    "includeInlineScripts": true,
    "includeExternalScripts": true,
    "includeDynamicScripts": true,
    "preserveStructure": true,
    "generateManifest": true,
    "filterUrl": ".*\\.js$"
  }
}
```

### Network Traffic Monitoring
Monitor and analyze web application behavior:

```json
{
  "name": "browser_log_network_requests",
  "arguments": {
    "filePath": "./network_analysis.json",
    "includeHeaders": true,
    "includeBody": false,
    "filterUrl": ".*api.*"
  }
}
```

## Examples

### Basic Navigation

```json
{
  "name": "browser_navigate",
  "arguments": {
    "url": "https://example.com",
    "waitFor": "load",
    "browser": "chromium"
  }
}
```

### Element Interaction

```json
{
  "name": "browser_click",
  "arguments": {
    "selector": "#submit-button",
    "waitFor": 1000
  }
}
```

### Form Filling

```json
{
  "name": "browser_fill_form",
  "arguments": {
    "fields": {
      "#username": "myuser",
      "#password": "mypassword"
    },
    "submitSelector": "#login-button"
  }
}
```

### Screenshot Capture

```json
{
  "name": "browser_screenshot",
  "arguments": {
    "path": "./screenshot.png",
    "fullPage": true
  }
}
```

### Mobile Emulation

```json
{
  "name": "browser_mobile_emulate",
  "arguments": {
    "device": "iPhone 12",
    "orientation": "portrait"
  }
}
```

### JavaScript Files Fetching

```json
{
  "name": "browser_fetch_javascript_files",
  "arguments": {
    "downloadPath": "./downloaded_scripts",
    "includeInlineScripts": true,
    "includeExternalScripts": true,
    "includeDynamicScripts": true,
    "preserveStructure": true,
    "generateManifest": true
  }
}
```

## Development

### Building for Production

```bash
npm run build
```

### Running in Development Mode

```bash
npm run dev
```

**Note**: This is for development only. For production use, always build the project first and use the production MCP server configuration.

### TypeScript Configuration

The project uses TypeScript with strict type checking. Configuration is in `tsconfig.json`.

### Linting

ESLint is configured with TypeScript support:

```bash
npx eslint index.ts
```

## Architecture

### Core Components

- **MCPBrowserServer**: Main server class handling MCP protocol
- **BrowserSession**: Manages individual browser sessions
- **Tool Handlers**: Individual handlers for each browser operation

### Session Management

- Sessions are stored in a Map with unique IDs
- Each session contains browser, context, and page instances
- Sessions are automatically cleaned up on server shutdown

### Error Handling

- Comprehensive error handling for all browser operations
- Graceful degradation when operations fail
- Detailed error messages returned to clients

## Dependencies

- **@modelcontextprotocol/sdk**: MCP protocol implementation
- **playwright**: Browser automation framework
- **typescript**: Type safety and compilation
- **tsx**: TypeScript execution in development

## Browser Support

### Supported Devices for Mobile Emulation

- iPhone 12/13/14
- iPad
- Samsung Galaxy S21
- Pixel 5

### Supported Orientations

- Portrait
- Landscape

## Security Considerations

- Browser sessions run in headless mode
- No persistent cookies or storage between sessions
- Network requests can be intercepted and modified
- JavaScript execution is sandboxed within the browser context

## Troubleshooting

### Common Issues

1. **Browser Installation**: Ensure Playwright browsers are installed with `npm run install-browsers`
2. **Permission Errors**: Check file system permissions for screenshot and download paths
3. **Network Issues**: Verify internet connectivity for navigation operations
4. **Memory Usage**: Close unused sessions to free up resources

### Debug Mode

Enable debug logging by setting environment variables or modifying the server configuration.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

Non-Commercial License - see [LICENSE](LICENSE) file for details.

**Important**: This software is free for personal, educational, and open source use. Commercial use is strictly prohibited without explicit permission from the author. For commercial licensing inquiries, please contact the author.

## Support

For issues and questions, please open an issue on the [GitHub repository](https://github.com/badchars/mcp-browser/issues).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Changelog

### v0.2.0

- **🔍 NEW**: Advanced XSS Vulnerability Scanning
  - Interactive XSS scanner with automatic PoC testing
  - Comprehensive detection across scripts, attributes, URLs, and forms
  - Real-time alert detection and vulnerability confirmation
  - Detailed JSON reports with severity levels
- **📁 NEW**: JavaScript Files Analysis & Fetching
  - Complete JavaScript file downloading (external, inline, dynamic)
  - Smart directory structure preservation from URLs
  - Manifest generation with detailed metadata
  - URL filtering and Performance API integration
- **🔒 Enhanced**: Security-focused features and documentation
- **📚 Improved**: Comprehensive usage examples and security use cases

### v0.1.0

- Initial release
- Basic browser automation capabilities
- XSS scanning functionality
- Network request logging
- Multi-browser support (Chromium, Firefox, WebKit)
