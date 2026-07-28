#!/usr/bin/env node

process.env.ACE_INSTALL_ROOT = process.env.ACE_INSTALL_ROOT || require('path').resolve(__dirname, '..');

require('../dist/cli.js');
