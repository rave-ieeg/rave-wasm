const { Menu, MenuItem } = require('electron');

/**
 * Add context menu to a BrowserWindow
 * @param {BrowserWindow} window - The window to add context menu to
 * @param {Function} createNewWindowCallback - Callback to create new window with URL
 */
function addContextMenu(window, createNewWindowCallback) {
  window.webContents.on('context-menu', (event, params) => {
    const menu = new Menu();

    // If right-clicking on a link, add link-specific options
    if (params.linkURL) {
      menu.append(new MenuItem({
        label: 'Open Link in New Window',
        click: () => {
          if (createNewWindowCallback) {
            createNewWindowCallback(params.linkURL);
          }
        }
      }));

      menu.append(new MenuItem({
        label: 'Copy Link Address',
        click: () => {
          const { clipboard } = require('electron');
          clipboard.writeText(params.linkURL);
        }
      }));

      menu.append(new MenuItem({ type: 'separator' }));
    }

    // Add refresh option
    menu.append(new MenuItem({
      label: 'Refresh',
      accelerator: 'CmdOrCtrl+R',
      click: () => {
        window.webContents.reload();
      }
    }));

    // Add back option if available
    if (window.webContents.navigationHistory.canGoBack()) {
      menu.append(new MenuItem({
        label: 'Back',
        accelerator: 'CmdOrCtrl+Left',
        click: () => {
          window.webContents.navigationHistory.goBack();
        }
      }));
    }

    // Add forward option if available
    if (window.webContents.navigationHistory.canGoForward()) {
      menu.append(new MenuItem({
        label: 'Forward',
        accelerator: 'CmdOrCtrl+Right',
        click: () => {
          window.webContents.navigationHistory.goForward();
        }
      }));
    }

    // Add separator
    menu.append(new MenuItem({ type: 'separator' }));

    // Add DevTools option
    menu.append(new MenuItem({
      label: 'Inspect Element',
      accelerator: 'CmdOrCtrl+Shift+I',
      click: () => {
        window.webContents.inspectElement(params.x, params.y);
      }
    }));

    // Add toggle DevTools option
    menu.append(new MenuItem({
      label: 'Toggle Developer Tools',
      accelerator: 'CmdOrCtrl+Alt+I',
      click: () => {
        window.webContents.toggleDevTools();
      }
    }));

    menu.append(new MenuItem({ type: 'separator' }));

    // Add close option
    menu.append(new MenuItem({
      label: 'Close Window',
      accelerator: 'CmdOrCtrl+W',
      click: () => {
        window.close();
      }
    }));

    // Only show the menu if the page didn't handle the context menu
    // (params.editFlags indicates the page didn't prevent default)
    if (!params.isEditable && params.mediaType === 'none' || params.linkURL) {
      menu.popup();
    }
  });
}

module.exports = { addContextMenu };
