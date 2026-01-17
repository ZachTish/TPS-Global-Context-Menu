# TPS Global Context Menu

**Define a single reusable context menu for note links across your vault, and keep certain "inline" menus persistent in reading/editing views.**

![Obsidian Plugin](https://img.shields.io/badge/dynamic/json-blue?label=Obsidian%20Plugin&query=version)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Build](https://img.shields.io/github/workflows/CI/TPS-Global-Context-Menu)

## ✨ Features

### 🎯 Context Menu Integration
- **File Context Menu**: Adds TPS actions to native right-click file menus
- **Multi-Select Menu**: Batch operations on multiple selected files
- **Editor Context Menu**: Access TPS features while editing notes
- **Inline Menu System**: Persistent menus that survive view changes
- **Smart Filtering**: Context-aware menu options based on file type

### 🔄 Persistent Menu Management
- **Auto-Refresh**: Menus update automatically on layout changes
- **File Change Detection**: Menus refresh when files are modified
- **Frontmatter Integration**: Menus respond to metadata changes
- **Performance Optimized**: Debounced updates for mobile compatibility

### 📋 Bulk Operations
- **Multi-File Operations**: Batch rename, tag, and organize operations
- **Recurrence Checking**: Identify and manage recurring task patterns
- **Status Management**: Bulk update of file statuses and properties
- **Quick Actions**: Right-click access to common operations

### 🎨 File Automation
- **Smart Naming**: Automatic filename generation based on templates
- **Tag Management**: Quick tag addition and removal
- **Folder Organization**: Automatic file organization and placement
- **Template Integration**: Create files from predefined templates

### 🌐 Special Integration
- **Calendar Embed Support**: Special handling for embedded calendar events
- **Sync Embed Recognition**: Context-aware menu for synchronized content
- **Multi-Vault Support**: Works across different vault configurations
- **Compatibility Layer**: Handles different Obsidian versions gracefully

## 🚀 Installation

### Via BRAT (Recommended for Testing)
1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) in Obsidian
2. Go to Settings → Community Plugins → Add BRAT plugin
3. Add this repository URL: `https://github.com/ZachTish/TPS-Global-Context-Menu`
4. Enable "TPS Global Context Menu" in your installed plugins

### Via Release (Stable)
1. Download the latest [release](https://github.com/ZachTish/TPS-Global-Context-Menu/releases)
2. Extract the contents to your vault's plugins folder
3. Restart Obsidian and enable the plugin
4. Access TPS features through right-click context menus

## 📖 Usage

### Basic Setup

1. **Enable Plugin**: Go to Settings → Community Plugins and enable "TPS Global Context Menu"
2. **Configure Options**: Access plugin settings to customize behavior
3. **Test Menus**: Right-click on files to see TPS options
4. **Customize Features**: Adjust persistent menus and automation rules

### Context Menu Access

#### File Menu Operations
Right-click on any file in File Explorer or editor to access:

- **Quick Actions**: Create related notes, duplicate, rename
- **Bulk Operations**: Multi-select files for batch operations
- **Organization**: Move to folders, add tags, update status
- **Advanced Features**: Set recurrences, schedule reminders

#### Editor Menu Features
While editing a note, access additional TPS features:

- **Insert Templates**: Quick insertion of predefined content
- **Link Creation**: Easy linking to other vault files
- **Format Options**: Text formatting and structure tools
- **Reference Management**: Quick access to reference materials

### Persistent Menus
Create menus that stay visible across different views:

#### Inline Menus
```yaml
---
tpsmenu:
  - type: quick-links
    files:
      - Related-Project.md
      - Reference-Material.md
    title: "Quick Access"
---
```

#### Context-Aware Menus
- **File Type Detection**: Different menus for different file types
- **Folder-Based Options**: Menu items based on folder location
- **Status-Driven Actions**: Dynamic options based on file properties
- **Custom Rules**: Define your own menu criteria

### Automation Features

#### File Naming Service
```yaml
# Automatic naming patterns
name-format: "YYYY-MM-DD - {title}"
folder-structure: "/Projects/{type}/{date}/"
template-file: "Templates/Project Template.md"
---
```

#### Recurrence Service
```yaml
# Recurring task patterns
recurrence-pattern:
  frequency: "weekly"
  days: ["monday", "wednesday", "friday"]
  auto-complete: true
  reminder-offset: -60  # minutes
---
```

## ⚙️ Settings

### Menu Configuration
- **Enable/Disable**: Turn specific menu types on/off
- **Display Options**: Control menu appearance and behavior
- **Persistence Rules**: Define when menus should be persistent
- **Performance Settings**: Debounce timing and refresh frequency

### Automation Settings
- **File Naming**: Configure naming templates and patterns
- **Bulk Operations**: Set up batch operation preferences
- **Recurrence Rules**: Define recurring task management
- **Integration Options**: Connect with other TPS plugins

### Advanced Settings
- **Logging**: Enable debug logging for troubleshooting
- **Compatibility**: Version-specific behavior controls
- **Performance**: Mobile optimization settings
- **Experimental**: Beta features and testing options

## 🎯 Use Cases

### **Project Management**
- Quick access to project-related files
- Bulk operations on project deliverables
- Automated file naming and organization
- Recurring task scheduling

### **Knowledge Management**
- Context-aware menus for research materials
- Quick linking between related concepts
- Template-based content creation
- Automatic tagging and categorization

### **Productivity Workflows**
- Persistent menus for frequently used actions
- Bulk operations for multiple files
- Automated reminders and scheduling
- Cross-vault reference management

## 🔧 Technical Details

### Architecture
- **Plugin Architecture**: Modular design with service separation
- **Menu System**: Dynamic menu generation and management
- **Event Handling**: Comprehensive Obsidian event integration
- **Performance Layer**: Debounced updates and mobile optimizations

### Integration Points
- **File System**: Deep integration with Obsidian's file operations
- **Editor System**: Context menu integration with text editor
- **Settings System**: Persistent configuration management
- **Compatibility Layer**: Cross-version compatibility handling

### Performance Features
- **Debounced Updates**: Optimized event handling
- **Lazy Loading**: Menu content loaded on demand
- **Memory Management**: Efficient resource usage patterns
- **Mobile Optimization**: Touch-friendly interaction patterns

## 📋 Commands

### Menu Commands
- **Toggle Persistent Menus**: Show/hide inline menus
- **Refresh All Menus**: Force refresh all menu instances
- **Open Settings**: Quick access to plugin configuration
- **Bulk Operations**: Access bulk edit and organize features

### Utility Commands
- **Create from Template**: Quick file creation with templates
- **Bulk Tag Management**: Add/remove tags from multiple files
- **Recurrence Manager**: Handle recurring task patterns
- **File Organization**: Automatic folder and naming operations

## 🐛 Troubleshooting

### Common Issues

#### Context Menus Not Appearing
- Ensure plugin is enabled in Settings → Community Plugins
- Check that file types are supported in plugin settings
- Try restarting Obsidian with Ctrl+R (or Cmd+R on Mac)
- Verify menu configuration isn't overly restrictive

#### Persistent Menus Disappearing
- Check persistence settings in plugin configuration
- Ensure menu definitions are properly formatted in frontmatter
- Look for console errors by enabling debug logging
- Verify that files haven't been moved or renamed

#### Performance Issues
- Increase debounce timing in performance settings
- Enable mobile optimizations if using touch devices
- Reduce number of persistent menus
- Disable unused automation features

#### Bulk Operations Failing
- Check file permissions for target directories
- Ensure files aren't locked by other applications
- Verify frontmatter syntax is correct
- Test operations on smaller file selections first

### Debug Mode
Enable logging to troubleshoot:
- Menu creation and rendering events
- File operation processing
- Automation service execution
- Performance metrics and timing
- Error messages and stack traces

## 📋 Changelog

### v1.0.0 (2024-01-17)
- ✅ Initial release
- ✅ Context menu integration across file types
- ✅ Persistent inline menu system
- ✅ Bulk operations and automation features
- ✅ File naming and organization services
- ✅ Recurrence management capabilities

## 🔧 Development

### Building from Source
```bash
# Clone the repository
git clone https://github.com/ZachTish/TPS-Global-Context-Menu.git
cd TPS-Global-Context-Menu

# Install dependencies
npm install

# Build the plugin
npm run build

# Watch for changes during development
npm run dev
```

### Contributing
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'feat: Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request against the `develop` branch

### Development Guidelines
When contributing to this plugin, follow these principles:

1. **Performance First**: Prioritize mobile and touch device compatibility
2. **Modular Design**: Keep services separate and testable
3. **Menu Safety**: Ensure context menus don't break native functionality
4. **Backward Compatibility**: Maintain support for older Obsidian versions
5. **User Experience**: Design with productivity and ease of use in mind

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## 🔗 Links

- **Repository**: https://github.com/ZachTish/TPS-Global-Context-Menu
- **Issues**: https://github.com/ZachTish/TPS-Global-Context-Menu/issues
- **Discussions**: https://github.com/ZachTish/TPS-Global-Context-Menu/discussions
- **Releases**: https://github.com/ZachTish/TPS-Global-Context-Menu/releases

---

**Made with ❤️ for the Obsidian community**