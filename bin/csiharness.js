#!/usr/bin/env node

process.env.CSIHARNESS_INSTALL_ROOT = process.env.CSIHARNESS_INSTALL_ROOT || require('path').resolve(__dirname, '..');

require('../dist/cli.js');
