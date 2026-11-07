const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('agentsnowcrab', { version: '0.1.0' });
