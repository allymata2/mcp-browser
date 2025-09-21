# Contributing to MCP Browser

Thank you for your interest in contributing to MCP Browser! This document provides guidelines for contributing to the project.

## 🚀 Getting Started

### Prerequisites
- Node.js 18 or higher
- Git
- Basic understanding of TypeScript and Playwright

### Development Setup
1. Fork the repository
2. Clone your fork: `git clone https://github.com/yourusername/mcp-browser.git`
3. Install dependencies: `npm install`
4. Install Playwright browsers: `npm run install-browsers`
5. Build the project: `npm run build`

## 📝 How to Contribute

### Reporting Issues
- Use the provided issue templates
- Search existing issues before creating new ones
- Provide detailed reproduction steps
- Include environment information

### Suggesting Features
- Use the feature request template
- Describe the use case and benefits
- Consider implementation complexity
- Check existing feature requests

### Code Contributions

#### 1. **Create a Feature Branch**
```bash
git checkout -b feature/your-feature-name
```

#### 2. **Make Your Changes**
- Follow the existing code style
- Add tests for new functionality
- Update documentation as needed
- Ensure all tests pass

#### 3. **Commit Your Changes**
```bash
git commit -m "Add: brief description of changes"
```

#### 4. **Push and Create Pull Request**
```bash
git push origin feature/your-feature-name
```

## 🎯 Areas for Contribution

### High Priority
- **Security Features**: New vulnerability detection methods
- **Performance**: Optimize browser automation
- **Documentation**: Improve examples and guides
- **Testing**: Add comprehensive test coverage

### Medium Priority
- **New Tools**: Additional browser automation capabilities
- **UI Improvements**: Better error messages and logging
- **Platform Support**: Cross-platform compatibility
- **Integration**: Support for other MCP clients

### Low Priority
- **Code Refactoring**: Improve code organization
- **Dependencies**: Update and optimize dependencies
- **CI/CD**: Improve build and deployment processes

## 📋 Code Style Guidelines

### TypeScript
- Use strict type checking
- Prefer interfaces over types for object shapes
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

### Error Handling
- Use try-catch blocks appropriately
- Provide meaningful error messages
- Log errors with context
- Handle edge cases gracefully

### Testing
- Write unit tests for new functions
- Test error conditions
- Use descriptive test names
- Maintain good test coverage

## 🔒 Security Considerations

### When Adding Security Features
- Follow responsible disclosure practices
- Test thoroughly before release
- Consider potential misuse
- Document security implications

### Code Security
- Validate all inputs
- Sanitize user-provided data
- Use secure coding practices
- Review for potential vulnerabilities

## 📚 Documentation

### README Updates
- Update feature lists
- Add usage examples
- Update installation instructions
- Keep changelog current

### Code Documentation
- Add JSDoc comments
- Explain complex logic
- Document API changes
- Provide usage examples

## 🏷️ Release Process

### Version Numbering
- **Major** (1.0.0): Breaking changes
- **Minor** (0.2.0): New features
- **Patch** (0.1.1): Bug fixes

### Release Checklist
- [ ] Update version in package.json
- [ ] Update CHANGELOG.md
- [ ] Run all tests
- [ ] Build successfully
- [ ] Update documentation
- [ ] Create release notes

## 🤝 Community Guidelines

### Be Respectful
- Use welcoming and inclusive language
- Be respectful of differing viewpoints
- Accept constructive criticism gracefully
- Focus on what is best for the community

### Be Professional
- Keep discussions on-topic
- Provide constructive feedback
- Help others learn and grow
- Follow GitHub's community guidelines

## 📞 Getting Help

### Questions and Support
- Create a GitHub issue for questions
- Use discussions for general topics
- Check existing documentation first
- Be specific about your problem

### Contact
- GitHub Issues: For bugs and feature requests
- GitHub Discussions: For questions and ideas
- Email: [your-email@example.com] (for security issues)

## 📄 License

By contributing to MCP Browser, you agree that your contributions will be licensed under the same Non-Commercial License that covers the project.

---

**Thank you for contributing to MCP Browser! 🚀**
