'use strict';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

const paint = (c, s) => `${c}${s}${C.reset}`;
const ok = (s) => `${paint(C.green, '✔')} ${s}`;
const warn = (s) => `${paint(C.yellow, '!')} ${s}`;
const bad = (s) => `${paint(C.red, '✖')} ${s}`;
const dim = (s) => paint(C.dim, s);

const BANNER = `
${paint(C.cyan, '  ██╗  ██╗ █████╗ ███████╗██████╗     ██████╗  ██████╗  ██████╗ ██╗     ')}
${paint(C.cyan, '  ██║ ██╔╝██╔══██╗██╔════╝██╔══██╗    ██╔══██╗██╔═══██╗██╔═══██╗██║     ')}
${paint(C.cyan, '  █████╔╝ ███████║█████╗  ██████╔╝    ██████╔╝██║   ██║██║   ██║██║     ')}
${paint(C.cyan, '  ██╔═██╗ ██╔══██║██╔══╝  ██╔══██╗    ██╔═══╝ ██║   ██║██║   ██║██║     ')}
${paint(C.cyan, '  ██║  ██╗██║  ██║███████╗██║  ██║    ██║     ╚██████╔╝╚██████╔╝███████╗')}
${paint(C.cyan, '  ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝    ╚═╝      ╚═════╝  ╚═════╝ ╚══════╝')}
${dim('  bulk Kaer accounts → API keys → 9Router · zero dependencies · node ≥ 18')}
`;

module.exports = { C, paint, ok, warn, bad, dim, BANNER };
